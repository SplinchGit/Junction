package com.splinch.junction.chat.realtime

import android.content.Context
import android.media.AudioManager
import android.util.Log
import com.splinch.junction.chat.ChatMessage
import com.splinch.junction.chat.Sender
import com.splinch.junction.settings.UserPrefsRepository
import com.splinch.junction.sync.firebase.AuthManager
import java.nio.ByteBuffer
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.tasks.await
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.DataChannel
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.PeerConnectionFactory.InitializationOptions
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.PeerConnection.IceServer
import org.webrtc.PeerConnection.RTCConfiguration
import org.webrtc.DataChannel.Init
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.PeerConnection.Observer

enum class RealtimeConnectionState {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    FAILED
}

data class ToolCall(
    val callId: String,
    val name: String,
    val arguments: String
)

interface RealtimeEventListener {
    fun onConnectionState(state: RealtimeConnectionState)
    fun onTextDelta(itemId: String, delta: String)
    fun onTextDone(itemId: String, text: String)
    fun onToolCall(call: ToolCall)
    fun onResponseDone()
    fun onError(message: String)
}

class RealtimeSdpService(
    private val prefs: UserPrefsRepository,
    private val authManager: AuthManager,
    private val httpClient: OkHttpClient = OkHttpClient()
) {
    suspend fun exchangeSdp(offerSdp: String): Result<String> {
        val clientSecretEndpoint = prefs.realtimeClientSecretEndpointFlow.first()
        if (clientSecretEndpoint.isNotBlank()) {
            return exchangeWithClientSecret(offerSdp, clientSecretEndpoint)
        }
        val endpoint = prefs.realtimeEndpointFlow.first()
        if (endpoint.isBlank()) {
            return Result.failure(IllegalStateException("Realtime endpoint is not configured"))
        }
        val user = authManager.currentUser()
            ?: return Result.failure(IllegalStateException("Sign in required"))
        val token = user.getIdToken(true).await().token
            ?: return Result.failure(IllegalStateException("Failed to fetch auth token"))

        return withContext(Dispatchers.IO) {
            val body = offerSdp.toRequestBody("application/sdp".toMediaType())
            val request = Request.Builder()
                .url(endpoint)
                .post(body)
                .addHeader("Authorization", "Bearer $token")
                .build()
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    return@withContext Result.failure(
                        IllegalStateException("Realtime SDP exchange failed (${response.code})")
                    )
                }
                val answer = response.body?.string().orEmpty().trim()
                if (answer.isBlank()) {
                    Result.failure(IllegalStateException("Empty SDP answer"))
                } else {
                    Result.success(answer)
                }
            }
        }
    }

    private suspend fun exchangeWithClientSecret(
        offerSdp: String,
        clientSecretEndpoint: String
    ): Result<String> {
        val user = authManager.currentUser()
            ?: return Result.failure(IllegalStateException("Sign in required"))
        val token = user.getIdToken(true).await().token
            ?: return Result.failure(IllegalStateException("Failed to fetch auth token"))

        return withContext(Dispatchers.IO) {
            val authRequest = Request.Builder()
                .url(clientSecretEndpoint)
                .post("{}".toRequestBody("application/json".toMediaType()))
                .addHeader("Authorization", "Bearer $token")
                .build()
            val clientSecret = httpClient.newCall(authRequest).execute().use { response ->
                if (!response.isSuccessful) {
                    return@withContext Result.failure(
                        IllegalStateException("Client secret request failed (${response.code})")
                    )
                }
                val payload = response.body?.string().orEmpty()
                parseClientSecret(payload)
            }
            if (clientSecret.isBlank()) {
                return@withContext Result.failure(IllegalStateException("Missing client secret"))
            }

            val callBody = offerSdp.toRequestBody("application/sdp".toMediaType())
            val callRequest = Request.Builder()
                .url(OPENAI_REALTIME_CALLS_URL)
                .post(callBody)
                .addHeader("Authorization", "Bearer $clientSecret")
                .build()
            httpClient.newCall(callRequest).execute().use { response ->
                if (!response.isSuccessful) {
                    return@withContext Result.failure(
                        IllegalStateException("OpenAI SDP exchange failed (${response.code})")
                    )
                }
                val body = response.body?.string().orEmpty().trim()
                val answer = parseAnswer(body)
                if (answer.isBlank()) {
                    Result.failure(IllegalStateException("Empty SDP answer"))
                } else {
                    Result.success(answer)
                }
            }
        }
    }

    private fun parseClientSecret(payload: String): String {
        return try {
            val json = JSONObject(payload)
            val secret = json.optJSONObject("client_secret")
            when {
                secret != null -> secret.optString("value")
                json.has("value") -> json.optString("value")
                json.has("client_secret") -> json.optString("client_secret")
                else -> ""
            }.trim()
        } catch (_: Exception) {
            ""
        }
    }

    private fun parseAnswer(payload: String): String {
        if (payload.isBlank()) return ""
        return try {
            val json = JSONObject(payload)
            json.optString("answer")
                .ifBlank { json.optString("sdp") }
                .ifBlank { json.optJSONObject("data")?.optString("answer").orEmpty() }
                .ifBlank { payload }
                .trim()
        } catch (_: Exception) {
            payload.trim()
        }
    }

    private companion object {
        private const val OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls"
    }
}

class RealtimeSessionManager(
    private val context: Context,
    private val prefs: UserPrefsRepository,
    private val authManager: AuthManager,
    private val listener: RealtimeEventListener
) : Observer, SdpObserver, DataChannel.Observer {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val sdpService = RealtimeSdpService(prefs, authManager)
    private val lock = Any()

    private var peerConnectionFactory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var dataChannel: DataChannel? = null
    private var localAudioSource: AudioSource? = null
    private var localAudioTrack: AudioTrack? = null
    private var audioManager: AudioManager? = null
    private var awaitingIce = CompletableDeferred<Unit>()
    private var dataChannelOpen = CompletableDeferred<Unit>()
    private var keepAlive = false
    private var manualDisconnect = false
    private var audioEnabled = false

    suspend fun connect(keepAlive: Boolean, enableAudio: Boolean): Boolean {
        synchronized(lock) {
            if (peerConnection != null) return false
            this.keepAlive = keepAlive
            this.audioEnabled = enableAudio
            manualDisconnect = false
        }
        listener.onConnectionState(RealtimeConnectionState.CONNECTING)
        return try {
            withContext(Dispatchers.IO) {
                initPeerConnection(enableAudio)
                val offer = createOffer()
                val answer = sdpService.exchangeSdp(offer.description).getOrThrow()
                setRemoteDescription(SessionDescription(SessionDescription.Type.ANSWER, answer))
            }
            listener.onConnectionState(RealtimeConnectionState.CONNECTED)
            true
        } catch (ex: CancellationException) {
            throw ex
        } catch (ex: Exception) {
            Log.e(TAG, "Realtime connection failed", ex)
            teardown()
            listener.onConnectionState(RealtimeConnectionState.FAILED)
            listener.onError(ex.message ?: "Realtime connection failed")
            false
        } catch (ex: Throwable) {
            Log.e(TAG, "Realtime connection failed", ex)
            teardown()
            listener.onConnectionState(RealtimeConnectionState.FAILED)
            listener.onError(ex.message ?: "Realtime connection failed")
            false
        }
    }

    fun isConnected(): Boolean = peerConnection != null

    fun disconnect() {
        manualDisconnect = true
        teardown()
        listener.onConnectionState(RealtimeConnectionState.DISCONNECTED)
    }

    fun setMicEnabled(enabled: Boolean) {
        localAudioTrack?.setEnabled(enabled)
    }

    suspend fun seedConversation(history: List<ChatMessage>) {
        awaitDataChannel()
        history.takeLast(20).forEach { message ->
            sendConversationItem(message)
        }
    }

    suspend fun sendUserText(text: String) {
        awaitDataChannel()
        val event = JSONObject()
        event.put("type", "conversation.item.create")
        val item = JSONObject()
        item.put("type", "message")
        item.put("role", "user")
        val content = JSONArray()
        val entry = JSONObject()
        entry.put("type", "input_text")
        entry.put("text", text)
        content.put(entry)
        item.put("content", content)
        event.put("item", item)
        sendEvent(event)
    }

    suspend fun requestResponse() {
        awaitDataChannel()
        val event = JSONObject()
        event.put("type", "response.create")
        sendEvent(event)
    }

    suspend fun cancelResponse() {
        awaitDataChannel()
        val event = JSONObject()
        event.put("type", "response.cancel")
        sendEvent(event)
    }

    suspend fun sendToolResult(callId: String, output: String) {
        awaitDataChannel()
        val event = JSONObject()
        event.put("type", "conversation.item.create")
        val item = JSONObject()
        item.put("type", "function_call_output")
        item.put("call_id", callId)
        item.put("output", output)
        event.put("item", item)
        sendEvent(event)
        requestResponse()
    }

    override fun onMessage(buffer: DataChannel.Buffer?) {
        if (buffer == null) return
        val data = ByteArray(buffer.data.remaining())
        buffer.data.get(data)
        val text = String(data, Charsets.UTF_8)
        val json = runCatching { JSONObject(text) }.getOrNull() ?: return
        handleEvent(json)
    }

    override fun onBufferedAmountChange(previousAmount: Long) = Unit

    override fun onStateChange() {
        if (dataChannel?.state() == DataChannel.State.OPEN) {
            if (!dataChannelOpen.isCompleted) {
                dataChannelOpen.complete(Unit)
            }
        }
    }

    override fun onSignalingChange(state: PeerConnection.SignalingState?) = Unit

    override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
        if (state == PeerConnection.IceConnectionState.DISCONNECTED ||
            state == PeerConnection.IceConnectionState.FAILED
        ) {
            listener.onConnectionState(RealtimeConnectionState.DISCONNECTED)
            if (!manualDisconnect && keepAlive) {
                scope.launch {
                    delay(800)
                    reconnect()
                }
            } else {
                teardown()
            }
        }
    }

    override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {
        if (state == PeerConnection.IceGatheringState.COMPLETE && !awaitingIce.isCompleted) {
            awaitingIce.complete(Unit)
        }
    }

    override fun onIceCandidate(candidate: org.webrtc.IceCandidate?) = Unit

    override fun onIceCandidatesRemoved(candidates: Array<out org.webrtc.IceCandidate>?) = Unit

    override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit

    override fun onAddStream(stream: MediaStream?) = Unit

    override fun onRemoveStream(stream: MediaStream?) = Unit

    override fun onDataChannel(channel: DataChannel?) {
        channel?.registerObserver(this)
        dataChannel = channel
    }

    override fun onRenegotiationNeeded() = Unit

    override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) = Unit

    override fun onCreateSuccess(sessionDescription: SessionDescription?) {
        if (sessionDescription == null) return
        peerConnection?.setLocalDescription(this, sessionDescription)
    }

    override fun onSetSuccess() = Unit

    override fun onCreateFailure(error: String?) {
        listener.onError(error ?: "Failed to create SDP offer")
    }

    override fun onSetFailure(error: String?) {
        listener.onError(error ?: "Failed to apply SDP")
    }

    private suspend fun awaitDataChannel() {
        if (dataChannelOpen.isCompleted) return
        dataChannelOpen.await()
    }

    private suspend fun createOffer(): SessionDescription = suspendCancellableCoroutine { cont ->
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"))
        }
        peerConnection?.createOffer(object : SdpObserver {
            override fun onCreateSuccess(desc: SessionDescription?) {
                if (desc == null) {
                    cont.resumeWith(Result.failure(IllegalStateException("Empty offer")))
                    return
                }
                peerConnection?.setLocalDescription(object : SdpObserver {
                    override fun onSetSuccess() {
                        scope.launch {
                            awaitIceGathering()
                            cont.resumeWith(Result.success(desc))
                        }
                    }

                    override fun onSetFailure(error: String?) {
                        cont.resumeWith(Result.failure(IllegalStateException(error ?: "Failed to set local SDP")))
                    }

                    override fun onCreateSuccess(p0: SessionDescription?) = Unit

                    override fun onCreateFailure(p0: String?) = Unit
                }, desc)
            }

            override fun onCreateFailure(error: String?) {
                cont.resumeWith(Result.failure(IllegalStateException(error ?: "Failed to create offer")))
            }

            override fun onSetSuccess() = Unit

            override fun onSetFailure(error: String?) = Unit
        }, constraints)
    }

    private suspend fun setRemoteDescription(description: SessionDescription) =
        suspendCancellableCoroutine<Unit> { cont ->
            peerConnection?.setRemoteDescription(object : SdpObserver {
                override fun onSetSuccess() {
                    cont.resumeWith(Result.success(Unit))
                }

                override fun onSetFailure(error: String?) {
                    cont.resumeWith(Result.failure(IllegalStateException(error ?: "Failed to set remote SDP")))
                }

                override fun onCreateSuccess(p0: SessionDescription?) = Unit

                override fun onCreateFailure(p0: String?) = Unit
            }, description)
        }

    private suspend fun awaitIceGathering() {
        if (!awaitingIce.isCompleted) {
            awaitingIce.await()
        }
    }

    private fun initPeerConnection(enableAudio: Boolean) {
        if (peerConnectionFactory == null) {
            val eglBase = EglBase.create()
            PeerConnectionFactory.initialize(
                InitializationOptions.builder(context).createInitializationOptions()
            )
            peerConnectionFactory = PeerConnectionFactory.builder()
                .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
                .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
                .createPeerConnectionFactory()
        }

        val iceServers = listOf(
            IceServer.builder("stun:stun.l.google.com:19302").createIceServer()
        )

        val config = RTCConfiguration(iceServers)
        peerConnection = peerConnectionFactory?.createPeerConnection(config, this)

        val init = Init()
        dataChannel = peerConnection?.createDataChannel("oai-events", init)?.also {
            it.registerObserver(this)
        }

        if (enableAudio) {
            localAudioSource = peerConnectionFactory?.createAudioSource(MediaConstraints())
            localAudioTrack = peerConnectionFactory?.createAudioTrack("JUNCTION_AUDIO", localAudioSource)
            localAudioTrack?.setEnabled(false)
            val stream = peerConnectionFactory?.createLocalMediaStream("JUNCTION_STREAM")
            if (stream != null && localAudioTrack != null) {
                stream.addTrack(localAudioTrack)
                peerConnection?.addStream(stream)
            }
        }

        audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        audioManager?.mode = AudioManager.MODE_IN_COMMUNICATION
        audioManager?.isSpeakerphoneOn = true
        awaitingIce = CompletableDeferred()
        dataChannelOpen = CompletableDeferred()
    }

    private fun sendConversationItem(message: ChatMessage) {
        val event = JSONObject()
        event.put("type", "conversation.item.create")
        val item = JSONObject()
        item.put("type", "message")
        item.put("role", message.sender.name.lowercase())
        val content = JSONArray()
        val entry = JSONObject()
        val contentType = if (message.sender == Sender.USER) "input_text" else "output_text"
        entry.put("type", contentType)
        entry.put("text", message.content)
        content.put(entry)
        item.put("content", content)
        event.put("item", item)
        sendEvent(event)
    }

    private fun handleEvent(json: JSONObject) {
        when (json.optString("type")) {
            "response.output_text.delta" -> {
                val itemId = json.optString("item_id")
                val delta = json.optString("delta").ifBlank { json.optString("text") }
                if (itemId.isNotBlank() && delta.isNotBlank()) {
                    listener.onTextDelta(itemId, delta)
                }
            }
            "response.output_text.done" -> {
                val itemId = json.optString("item_id")
                val text = json.optString("text").ifBlank { json.optString("final") }
                if (itemId.isNotBlank()) {
                    listener.onTextDone(itemId, text)
                }
            }
            "response.done" -> {
                val response = json.optJSONObject("response")
                val output = response?.optJSONArray("output") ?: response?.optJSONArray("output_items")
                if (output != null) {
                    for (i in 0 until output.length()) {
                        val item = output.optJSONObject(i) ?: continue
                        if (item.optString("type") == "function_call") {
                            val callId = item.optString("call_id")
                            val name = item.optString("name")
                            val args = item.optString("arguments")
                            if (callId.isNotBlank() && name.isNotBlank()) {
                                listener.onToolCall(ToolCall(callId, name, args))
                            }
                        }
                    }
                }
                listener.onResponseDone()
            }
            "error" -> {
                val error = json.optJSONObject("error")?.optString("message")
                    ?: json.optString("message")
                if (!error.isNullOrBlank()) {
                    listener.onError(error)
                    if (keepAlive && error.contains("expired", ignoreCase = true)) {
                        scope.launch { reconnect() }
                    }
                }
            }
        }
    }

    private fun sendEvent(event: JSONObject) {
        val channel = dataChannel ?: return
        if (channel.state() != DataChannel.State.OPEN) return
        val bytes = event.toString().toByteArray(Charsets.UTF_8)
        val buffer = DataChannel.Buffer(ByteBuffer.wrap(bytes), false)
        channel.send(buffer)
    }

    private suspend fun reconnect() {
        teardown()
        delay(300)
        connect(keepAlive = true, enableAudio = audioEnabled)
    }

    private fun teardown() {
        dataChannel?.unregisterObserver()
        dataChannel?.close()
        dataChannel = null
        localAudioTrack?.dispose()
        localAudioSource?.dispose()
        localAudioTrack = null
        localAudioSource = null
        peerConnection?.close()
        peerConnection = null
        audioManager?.mode = AudioManager.MODE_NORMAL
        audioManager?.isSpeakerphoneOn = false
    }

    private companion object {
        private const val TAG = "RealtimeSessionManager"
    }
}
