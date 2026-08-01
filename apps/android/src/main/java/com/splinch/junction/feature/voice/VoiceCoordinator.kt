package com.splinch.junction.feature.voice

import android.content.Context
import com.splinch.junction.assistant.conversation.ChatMessage
import com.splinch.junction.assistant.tools.ToolDefinition
import com.splinch.junction.data.preference.UserPrefsRepository
import com.splinch.junction.data.secret.KeyStorage
import com.splinch.junction.data.sync.firebase.AuthManager
import com.splinch.junction.feature.voice.local.AndroidVoiceEngine
import com.splinch.junction.feature.voice.local.AzureNeuralVoice
import com.splinch.junction.feature.voice.local.LocalVoiceListener
import com.splinch.junction.feature.voice.local.LocalVoiceSession
import com.splinch.junction.feature.voice.model.VoiceTrace
import com.splinch.junction.feature.voice.realtime.RealtimeConnectionState
import com.splinch.junction.feature.voice.realtime.RealtimeEventListener
import com.splinch.junction.feature.voice.realtime.RealtimeSessionManager
import com.splinch.junction.feature.voice.realtime.ToolCall
import com.splinch.junction.feature.voice.service.VoiceCallController
import com.splinch.junction.feature.voice.service.VoiceCallService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

enum class VoiceBackend { REALTIME, LOCAL }

interface VoiceCoordinatorListener {
    fun onRealtimeTextDelta(itemId: String, delta: String)
    fun onRealtimeTextDone(itemId: String, text: String)
    fun onRealtimeToolCall(call: ToolCall)
    fun onRealtimeResponseDone()
    fun onVoiceError(message: String)
    fun onLocalUtterance(text: String)
    fun onVoiceCallEnded()
}

/** Owns voice engines, backend switching, call state, and realtime connectivity. */
class VoiceCoordinator(
    context: Context,
    private val prefs: UserPrefsRepository,
    authManager: AuthManager,
    private val history: () -> List<ChatMessage>,
    private val toolDefinitions: () -> List<ToolDefinition>,
    private val listener: VoiceCoordinatorListener
) : RealtimeEventListener, LocalVoiceListener {
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val voiceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val realtime = RealtimeSessionManager(appContext, prefs, authManager, this)
    private val localVoice = LocalVoiceSession(
        listener = this,
        engine = AndroidVoiceEngine(appContext, cloudVoiceProvider = { resolveCloudVoice() }),
        scope = voiceScope
    )

    private var backend = VoiceBackend.LOCAL
    private var chatVisible = false
    private var disconnectAfterResponse = false

    private val _connectionState = MutableStateFlow(RealtimeConnectionState.DISCONNECTED)
    val connectionState: StateFlow<RealtimeConnectionState> = _connectionState.asStateFlow()

    private val _speechModeEnabled = MutableStateFlow(false)
    val speechModeEnabled: StateFlow<Boolean> = _speechModeEnabled.asStateFlow()

    private val _micEnabled = MutableStateFlow(false)
    val micEnabled: StateFlow<Boolean> = _micEnabled.asStateFlow()

    private val _backend = MutableStateFlow(VoiceBackend.LOCAL)
    val backendState: StateFlow<VoiceBackend> = _backend.asStateFlow()

    private val _localListening = MutableStateFlow(false)
    val localListening: StateFlow<Boolean> = _localListening.asStateFlow()

    private val _localSpeaking = MutableStateFlow(false)
    val localSpeaking: StateFlow<Boolean> = _localSpeaking.asStateFlow()

    fun initialize(speechModeEnabled: Boolean, backend: VoiceBackend) {
        _speechModeEnabled.value = speechModeEnabled
        this.backend = backend
        _backend.value = backend
        if (speechModeEnabled) localVoice.start()
    }

    fun setChatVisible(visible: Boolean) {
        chatVisible = visible
        if (visible && _speechModeEnabled.value && backend == VoiceBackend.REALTIME) {
            scope.launch { ensureConnected(keepAlive = true) }
        } else if (!visible) {
            realtime.disconnect()
        }
    }

    suspend fun trySendRealtimeText(text: String): Boolean {
        if (backend != VoiceBackend.REALTIME || !_speechModeEnabled.value) return false
        val configured = prefs.realtimeEndpointFlow.first().isNotBlank() ||
            prefs.realtimeClientSecretEndpointFlow.first().isNotBlank()
        if (!configured) return false
        val keepAlive = chatVisible
        if (ensureConnected(keepAlive)) realtime.setMicEnabled(_micEnabled.value)
        if (!realtime.isConnected()) return false
        disconnectAfterResponse = !keepAlive
        realtime.sendUserText(text)
        realtime.requestResponse()
        return true
    }

    suspend fun setBackend(backend: VoiceBackend) {
        if (backend == this.backend) return
        if (_speechModeEnabled.value) setSpeechMode(false)
        this.backend = backend
        _backend.value = backend
        prefs.setVoiceBackend(if (backend == VoiceBackend.LOCAL) "local" else "realtime")
    }

    suspend fun setSpeechMode(enabled: Boolean) {
        if (enabled == _speechModeEnabled.value) return
        VoiceTrace.speechMode(enabled)
        _speechModeEnabled.value = enabled
        if (enabled) {
            localVoice.start()
        } else {
            _micEnabled.value = false
            localVoice.stop()
            VoiceCallService.stop(appContext)
        }
        if (backend == VoiceBackend.LOCAL) return
        if (enabled && chatVisible) {
            realtime.disconnect()
            ensureConnected(keepAlive = true)
        } else if (!enabled) {
            _micEnabled.value = false
            realtime.setMicEnabled(false)
            realtime.disconnect()
        }
    }

    suspend fun startCall() {
        setSpeechMode(true)
        setMicEnabled(true)
    }

    suspend fun endCall() {
        setMicEnabled(false)
        setSpeechMode(false)
    }

    fun setMicEnabled(enabled: Boolean) {
        VoiceTrace.mic(enabled)
        _micEnabled.value = enabled
        if (enabled) startCallService() else VoiceCallService.stop(appContext)
        if (backend == VoiceBackend.LOCAL) {
            if (enabled) localVoice.startListening() else localVoice.stopListening()
            return
        }
        if (enabled && _speechModeEnabled.value && chatVisible && !realtime.isConnected()) {
            scope.launch {
                if (ensureConnected(keepAlive = true)) realtime.setMicEnabled(true)
            }
        } else {
            realtime.setMicEnabled(enabled)
        }
    }

    fun speak(text: String) = localVoice.speak(text)

    fun endLocalTurn(reason: String, sayOutLoud: String? = null) {
        if (!isLocalCall()) return
        if (sayOutLoud != null) localVoice.speak(sayOutLoud) else localVoice.onTurnEnded(reason)
    }

    fun isLocalCall(): Boolean =
        backend == VoiceBackend.LOCAL && _speechModeEnabled.value && _micEnabled.value

    fun isRealtimeConnected(): Boolean = realtime.isConnected()

    suspend fun sendToolResult(callId: String, output: String) {
        if (realtime.isConnected()) realtime.sendToolResult(callId, output)
    }

    suspend fun sendStatusResult(callId: String, status: String, message: String) {
        if (!realtime.isConnected()) return
        realtime.sendToolResult(callId, org.json.JSONObject().put("status", status).put("message", message).toString())
    }

    suspend fun stopResponse() {
        if (realtime.isConnected()) realtime.cancelResponse()
    }

    suspend fun regenerateResponse(): Boolean {
        val keepAlive = _speechModeEnabled.value && chatVisible
        ensureConnected(keepAlive)
        if (!realtime.isConnected()) return false
        disconnectAfterResponse = !keepAlive
        realtime.requestResponse()
        return true
    }

    fun disconnect() = realtime.disconnect()

    private suspend fun ensureConnected(keepAlive: Boolean): Boolean {
        val connected = realtime.connect(keepAlive, _speechModeEnabled.value)
        if (connected) {
            realtime.sendToolDefinitions(toolDefinitions())
            realtime.seedConversation(history())
        }
        return connected
    }

    private fun startCallService() {
        VoiceCallController.onHangUp = {
            scope.launch(Dispatchers.Main) {
                endCall()
                listener.onVoiceCallEnded()
            }
        }
        VoiceCallService.start(appContext)
    }

    private fun resolveCloudVoice(): AzureNeuralVoice? {
        val key = KeyStorage(appContext).getApiKey(AzureNeuralVoice.KEY_ID)
        if (key.isBlank()) return null
        return AzureNeuralVoice(appContext, key)
    }

    override fun onConnectionState(state: RealtimeConnectionState) {
        _connectionState.value = state
    }

    override fun onTextDelta(itemId: String, delta: String) = listener.onRealtimeTextDelta(itemId, delta)

    override fun onTextDone(itemId: String, text: String) = listener.onRealtimeTextDone(itemId, text)

    override fun onToolCall(call: ToolCall) = listener.onRealtimeToolCall(call)

    override fun onResponseDone() {
        listener.onRealtimeResponseDone()
        if (disconnectAfterResponse && !_speechModeEnabled.value) {
            realtime.disconnect()
            disconnectAfterResponse = false
        }
    }

    override fun onError(message: String) {
        val friendly = if (
            message.startsWith("Failed resolution of:") || message.contains("NoClassDefFoundError")
        ) {
            "Voice calling isn't available on this build."
        } else {
            message
        }
        listener.onVoiceError(friendly)
    }

    override fun onUserUtterance(text: String) {
        if (text.isBlank()) return
        VoiceTrace.dispatched()
        listener.onLocalUtterance(text)
    }

    override fun onListeningStateChanged(listening: Boolean) {
        _localListening.value = listening
    }

    override fun onSpeakingStateChanged(speaking: Boolean) {
        _localSpeaking.value = speaking
    }

    override fun onHandsFreeEnded() {
        _micEnabled.value = false
        VoiceTrace.mic(false)
        _localListening.value = false
        VoiceCallService.stop(appContext)
    }
}
