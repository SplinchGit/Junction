package com.splinch.junction.feature.voice

import android.content.Context
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import com.splinch.junction.assistant.conversation.ChatMessage
import com.splinch.junction.assistant.tools.ToolDefinition
import com.splinch.junction.data.preference.UserPrefsRepository
import com.splinch.junction.data.preference.VoicePrefs
import com.splinch.junction.data.secret.KeyStorage
import com.splinch.junction.data.sync.firebase.AuthManager
import com.splinch.junction.feature.voice.local.AndroidVoiceEngine
import com.splinch.junction.feature.voice.local.AzureNeuralVoice
import com.splinch.junction.feature.voice.local.LocalVoiceListener
import com.splinch.junction.feature.voice.local.LocalVoiceSession
import com.splinch.junction.feature.voice.model.SpeechVoice
import com.splinch.junction.feature.voice.model.TtsIdentity
import com.splinch.junction.feature.voice.model.VoiceCallClock
import com.splinch.junction.feature.voice.model.VoiceCallStatus
import com.splinch.junction.feature.voice.model.VoiceTrace
import com.splinch.junction.feature.voice.realtime.RealtimeConnectionState
import com.splinch.junction.feature.voice.realtime.RealtimeEventListener
import com.splinch.junction.feature.voice.realtime.RealtimeSessionManager
import com.splinch.junction.feature.voice.realtime.ToolCall
import com.splinch.junction.feature.voice.service.VoiceCallController
import com.splinch.junction.feature.voice.service.VoiceCallService
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
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
    /** A tagged utterance (an approval disclosure) finished playing in full. */
    fun onTaggedSpeechCompleted(tag: String) {}
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

    @Volatile private var voicePrefs = VoicePrefs()
    private val _ttsIdentity = MutableStateFlow<TtsIdentity?>(null)
    /** The engine, voice, locale and network use of the most recent utterance. */
    val ttsIdentity: StateFlow<TtsIdentity?> = _ttsIdentity.asStateFlow()

    private val deviceEngine = AndroidVoiceEngine(
        appContext,
        cloudVoiceProvider = { resolveCloudVoice() },
        deviceVoicePreference = { voicePrefs.deviceVoice },
        onIdentity = { _ttsIdentity.value = it }
    )
    private val localVoice = LocalVoiceSession(
        listener = this,
        engine = deviceEngine,
        scope = voiceScope
    )

    private val callClock = VoiceCallClock { "call_" + UUID.randomUUID().toString().take(8) }
    private val _callStatus = MutableStateFlow(VoiceCallStatus())
    /** Connecting / active / reconnecting / ended, with a monotonic start for the timer. */
    val callStatus: StateFlow<VoiceCallStatus> = _callStatus.asStateFlow()
    private var clearEndedJob: Job? = null

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

    init {
        scope.launch {
            prefs.voicePrefsFlow.collect { value ->
                val deviceChanged = value.deviceVoice != voicePrefs.deviceVoice
                voicePrefs = value
                if (deviceChanged) deviceEngine.refreshDeviceVoice()
            }
        }
    }

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
            callEnded()
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
        clearEndedJob?.cancel()
        publishCall(callClock.idle())
        publishCall(callClock.connecting())
        setSpeechMode(true)
        setMicEnabled(true)
        if (backend == VoiceBackend.REALTIME && realtime.isConnected()) publishCall(callClock.active(SystemClock.elapsedRealtime()))
    }

    suspend fun endCall() {
        setMicEnabled(false)
        setSpeechMode(false)
        callEnded()
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

    /** Speaks [text], after any reply still playing when [afterCurrent]; completion is reported with [tag]. */
    fun speakTagged(text: String, tag: String, afterCurrent: Boolean) {
        if (afterCurrent) localVoice.speakAfterCurrent(text, tag) else localVoice.speak(text, tag)
    }

    fun endLocalTurn(reason: String, sayOutLoud: String? = null) {
        if (!isLocalCall()) return
        if (sayOutLoud != null) localVoice.speak(sayOutLoud) else localVoice.onTurnEnded(reason)
    }

    fun isLocalCall(): Boolean =
        backend == VoiceBackend.LOCAL && _speechModeEnabled.value && _micEnabled.value

    /** The live local call's session ID, or null when no owner-started local call is running. */
    fun activeLocalCallSession(): String? = if (isLocalCall()) _callStatus.value.sessionId else null

    fun isRealtimeConnected(): Boolean = realtime.isConnected()

    fun installedDeviceVoices(): List<SpeechVoice> = deviceEngine.installedVoices()

    suspend fun setVoicePrefs(value: VoicePrefs) = prefs.setVoicePrefs(value)

    /**
     * Plays a short sample so the owner can compare voices. Refused during a call so it can
     * never land in a live microphone. A cloud preview sends the sample text to Azure.
     */
    fun previewVoice(option: VoicePrefs, cloud: Boolean, sample: String = PREVIEW_SAMPLE): Boolean {
        if (_micEnabled.value) return false
        if (cloud) {
            val key = KeyStorage(appContext).getApiKey(AzureNeuralVoice.KEY_ID)
            if (key.isBlank()) return false
            val voice = AzureNeuralVoice(appContext, key, voice = option.azureVoice, outputFormat = VoicePrefs.AZURE_QUALITY[option.azureQuality] ?: AzureNeuralVoice.DEFAULT_FORMAT)
            scope.launch { voice.speak(sample) }
            return true
        }
        // A throwaway engine leaves the call's engine untouched.
        var engine: TextToSpeech? = null
        engine = TextToSpeech(appContext) { status ->
            val tts = engine ?: return@TextToSpeech
            if (status != TextToSpeech.SUCCESS) { tts.shutdown(); return@TextToSpeech }
            runCatching {
                val chosen = option.deviceVoice
                if (chosen.isNotBlank() && chosen != VoicePrefs.DEVICE_BEST_OFFLINE) tts.voices?.firstOrNull { it.name == chosen }?.let { tts.voice = it }
                tts.speak(sample, TextToSpeech.QUEUE_FLUSH, null, "preview")
            }
            scope.launch { delay(10_000); runCatching { tts.shutdown() } }
        }
        return true
    }

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

    private fun publishCall(status: VoiceCallStatus) { _callStatus.value = status }

    /** Stops the timer exactly once, shows the final duration briefly, then clears it. */
    private fun callEnded() {
        val before = _callStatus.value
        publishCall(callClock.ended(SystemClock.elapsedRealtime()))
        if (before == _callStatus.value) return
        com.splinch.junction.assistant.runtime.TurnSessionContext.current = null
        listener.onVoiceCallEnded()
        clearEndedJob?.cancel()
        clearEndedJob = scope.launch { delay(ENDED_DISPLAY_MS); publishCall(callClock.idle()) }
    }

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
        val choice = voicePrefs
        return AzureNeuralVoice(appContext, key, voice = choice.azureVoice, outputFormat = VoicePrefs.AZURE_QUALITY[choice.azureQuality] ?: AzureNeuralVoice.DEFAULT_FORMAT)
    }

    override fun onConnectionState(state: RealtimeConnectionState) {
        _connectionState.value = state
        if (backend != VoiceBackend.REALTIME || !_micEnabled.value) return
        val now = SystemClock.elapsedRealtime()
        when (state) {
            RealtimeConnectionState.CONNECTED -> publishCall(callClock.active(now))
            RealtimeConnectionState.CONNECTING -> publishCall(callClock.reconnecting(now))
            RealtimeConnectionState.FAILED, RealtimeConnectionState.DISCONNECTED -> {
                _micEnabled.value = false
                _speechModeEnabled.value = false
                VoiceCallService.stop(appContext)
                callEnded()
            }
            else -> Unit
        }
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
        // The call becomes active when the recogniser first actually listens.
        if (listening && _micEnabled.value) publishCall(callClock.active(SystemClock.elapsedRealtime()))
    }

    override fun onSpeakingStateChanged(speaking: Boolean) {
        _localSpeaking.value = speaking
    }

    override fun onSpeechCompleted(tag: String?) {
        if (tag != null) listener.onTaggedSpeechCompleted(tag)
    }

    override fun onHandsFreeEnded() {
        callEnded()
        _micEnabled.value = false
        _speechModeEnabled.value = false
        VoiceTrace.mic(false)
        _localListening.value = false
        VoiceCallService.stop(appContext)
    }

    private companion object {
        const val ENDED_DISPLAY_MS = 4_000L
        const val PREVIEW_SAMPLE = "Hello, it's Nethra. This is how I'll sound when I read your replies aloud."
    }
}
