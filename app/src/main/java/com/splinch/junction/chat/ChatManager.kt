package com.splinch.junction.chat

import android.content.Context
import com.splinch.junction.BuildConfig
import com.splinch.junction.chat.realtime.RealtimeConnectionState
import com.splinch.junction.chat.realtime.RealtimeEventListener
import com.splinch.junction.chat.realtime.RealtimeSessionManager
import com.splinch.junction.chat.realtime.ToolCall
import com.splinch.junction.feed.FeedRepository
import com.splinch.junction.scheduler.Scheduler
import com.splinch.junction.settings.UserPrefsRepository
import com.splinch.junction.sync.firebase.AuthManager
import com.splinch.junction.update.UpdateChecker
import com.splinch.junction.update.UpdateInfo
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import org.json.JSONObject

class ChatManager(
    context: Context,
    private val store: ConversationStore,
    private val feedRepository: FeedRepository,
    private val prefs: UserPrefsRepository,
    private val authManager: AuthManager,
    private val updateState: MutableStateFlow<UpdateInfo?>,
    private val messageHandler: MessageHandler = MessageHandler(),
    private val now: () -> Instant = { Instant.now() }
) : RealtimeEventListener {
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val realtime = RealtimeSessionManager(appContext, prefs, authManager, this)

    private var session: ChatSession = newSession()
    private var messagesJob: kotlinx.coroutines.Job? = null
    private var chatVisible = false
    private var disconnectAfterResponse = false

    private val _messages = MutableStateFlow(emptyList<ChatMessage>())
    val messages: StateFlow<List<ChatMessage>> = _messages.asStateFlow()

    private val _sessionId = MutableStateFlow(session.sessionId)
    val sessionId: StateFlow<String> = _sessionId.asStateFlow()

    private val _streamingAssistant = MutableStateFlow<StreamingAssistantMessage?>(null)
    val streamingAssistant: StateFlow<StreamingAssistantMessage?> = _streamingAssistant.asStateFlow()

    private val _pendingToolCalls = MutableStateFlow<List<PendingToolCall>>(emptyList())
    val pendingToolCalls: StateFlow<List<PendingToolCall>> = _pendingToolCalls.asStateFlow()

    private val _connectionState = MutableStateFlow(RealtimeConnectionState.DISCONNECTED)
    val connectionState: StateFlow<RealtimeConnectionState> = _connectionState.asStateFlow()

    private val _speechModeEnabled = MutableStateFlow(false)
    val speechModeEnabled: StateFlow<Boolean> = _speechModeEnabled.asStateFlow()

    private val _agentToolsEnabled = MutableStateFlow(true)
    val agentToolsEnabled: StateFlow<Boolean> = _agentToolsEnabled.asStateFlow()

    private val _micEnabled = MutableStateFlow(false)
    val micEnabled: StateFlow<Boolean> = _micEnabled.asStateFlow()

    private val _lastUndo = MutableStateFlow<UndoAction?>(null)
    val lastUndo: StateFlow<UndoAction?> = _lastUndo.asStateFlow()

    suspend fun initialize() {
        val loaded = store.loadSession()
        session = loaded ?: newSession().also { store.saveSession(it) }
        _sessionId.value = session.sessionId
        _speechModeEnabled.value = session.speechModeEnabled
        _agentToolsEnabled.value = session.agentToolsEnabled
        startMessageCollection(session.sessionId)
    }

    fun setChatVisible(visible: Boolean) {
        chatVisible = visible
        if (visible && _speechModeEnabled.value) {
            scope.launch { ensureConnected(keepAlive = true, history = _messages.value) }
        } else if (!visible) {
            realtime.disconnect()
        }
    }

    suspend fun sendUserMessage(raw: String) {
        val user = authManager.currentUser()
        if (user == null) {
            appendSystemMessage("Sign in required to chat.")
            return
        }

        val processed = messageHandler.processMessage(raw, Sender.USER)
        val commandResult = processed.commandResult
        if (commandResult != null) {
            handleCommand(commandResult)
            return
        }

        val (isValid, error) = messageHandler.validateMessage(processed.content)
        if (!isValid) {
            appendSystemMessage(error ?: "Invalid message")
            return
        }

        val realtimeConfigured = prefs.realtimeEndpointFlow.first().isNotBlank() ||
            prefs.realtimeClientSecretEndpointFlow.first().isNotBlank()
        val backendEnabled = prefs.useHttpBackendFlow.first() &&
            prefs.apiBaseUrlFlow.first().isNotBlank()
        if (!realtimeConfigured && !backendEnabled) {
            appendSystemMessage("No backend configured. Add a realtime endpoint or enable the HTTP backend.")
            return
        }

        val userMessage = ChatMessage(
            sender = Sender.USER,
            content = processed.content
        )
        store.appendMessage(session.sessionId, userMessage)

        val history = _messages.value
        val keepAlive = _speechModeEnabled.value && chatVisible
        if (realtimeConfigured) {
            val connected = ensureConnected(keepAlive, history)
            if (connected) realtime.setMicEnabled(_micEnabled.value)
        }
        if (realtime.isConnected()) {
            disconnectAfterResponse = !keepAlive
            realtime.sendUserText(processed.content)
            realtime.requestResponse()
            return
        }

        val sent = sendViaBackend(userMessage)
        if (!sent) {
            val message = if (!realtimeConfigured) {
                "Realtime is not configured. Set a realtime endpoint or enable the HTTP backend."
            } else {
                "Realtime session unavailable."
            }
            appendSystemMessage(message)
        }
    }

    private suspend fun sendViaBackend(userMessage: ChatMessage): Boolean {
        val useBackend = prefs.useHttpBackendFlow.first()
        val baseUrl = prefs.apiBaseUrlFlow.first()
        if (!useBackend || baseUrl.isBlank()) return false
        val token = authManager.currentUser()
            ?.getIdToken(true)
            ?.await()
            ?.token
        if (token.isNullOrBlank()) {
            appendSystemMessage("Sign in required to use the HTTP backend.")
            return false
        }
        val backend = HttpBackend(
            baseUrl = baseUrl,
            authTokenProvider = { token }
        )
        val history = buildBackendHistory(userMessage)
        val sessionSnapshot = session.copy(messages = history)
        return try {
            val response = backend.generateResponse(sessionSnapshot, userMessage)
            store.appendMessage(session.sessionId, response)
            true
        } catch (ex: Exception) {
            appendSystemMessage(ex.message ?: "Backend request failed")
            false
        }
    }

    private fun buildBackendHistory(userMessage: ChatMessage): List<ChatMessage> {
        val current = _messages.value
        return if (current.lastOrNull()?.id == userMessage.id) {
            current
        } else {
            current + userMessage
        }
    }

    suspend fun clearSession() {
        realtime.disconnect()
        store.clear()
        session = newSession()
        store.saveSession(session)
        _sessionId.value = session.sessionId
        _speechModeEnabled.value = session.speechModeEnabled
        _agentToolsEnabled.value = session.agentToolsEnabled
        _pendingToolCalls.value = emptyList()
        _streamingAssistant.value = null
        _lastUndo.value = null
        startMessageCollection(session.sessionId)
        appendSystemMessage("Session cleared")
    }

    suspend fun setSpeechMode(enabled: Boolean) {
        if (enabled == _speechModeEnabled.value) return
        _speechModeEnabled.value = enabled
        session = session.copy(speechModeEnabled = enabled)
        store.saveSession(session)
        if (enabled && chatVisible) {
            realtime.disconnect()
            ensureConnected(keepAlive = true, history = _messages.value)
        } else if (!enabled) {
            _micEnabled.value = false
            realtime.setMicEnabled(false)
            realtime.disconnect()
        }
    }

    suspend fun setAgentToolsEnabled(enabled: Boolean) {
        if (enabled == _agentToolsEnabled.value) return
        _agentToolsEnabled.value = enabled
        session = session.copy(agentToolsEnabled = enabled)
        store.saveSession(session)
    }

    fun setMicEnabled(enabled: Boolean) {
        _micEnabled.value = enabled
        realtime.setMicEnabled(enabled)
    }

    suspend fun stopResponse() {
        _streamingAssistant.value = null
        if (!realtime.isConnected()) return
        realtime.cancelResponse()
    }

    suspend fun regenerateResponse() {
        val keepAlive = _speechModeEnabled.value && chatVisible
        ensureConnected(keepAlive, _messages.value)
        if (!realtime.isConnected()) {
            appendSystemMessage("Realtime session unavailable.")
            return
        }
        disconnectAfterResponse = !keepAlive
        realtime.requestResponse()
    }

    suspend fun applyToolCall(callId: String) {
        val call = _pendingToolCalls.value.firstOrNull { it.callId == callId } ?: return
        _pendingToolCalls.value = _pendingToolCalls.value.filterNot { it.callId == callId }
        val result = runCatching { applyToolCallInternal(call) }
            .getOrElse { ToolApplyResult("Failed to apply ${call.name}", errorOutput(it.message)) }

        if (result.confirmation.isNotBlank()) {
            appendSystemMessage(result.confirmation)
        }
        _lastUndo.value = result.undo
        if (realtime.isConnected()) {
            realtime.sendToolResult(call.callId, result.toolOutput)
        }
    }

    suspend fun cancelToolCall(callId: String) {
        val call = _pendingToolCalls.value.firstOrNull { it.callId == callId } ?: return
        _pendingToolCalls.value = _pendingToolCalls.value.filterNot { it.callId == callId }
        val output = JSONObject()
            .put("status", "cancelled")
            .put("message", "User cancelled ${call.name}")
            .toString()
        if (realtime.isConnected()) {
            realtime.sendToolResult(call.callId, output)
        }
        appendSystemMessage("Cancelled: ${call.summary}")
    }

    suspend fun undoLast() {
        val undo = _lastUndo.value ?: return
        val message = undo.action.invoke()
        _lastUndo.value = null
        appendSystemMessage(message)
    }

    override fun onConnectionState(state: RealtimeConnectionState) {
        _connectionState.value = state
    }

    override fun onTextDelta(itemId: String, delta: String) {
        val current = _streamingAssistant.value
        if (current == null || current.itemId != itemId) {
            _streamingAssistant.value = StreamingAssistantMessage(itemId = itemId, content = delta)
        } else {
            _streamingAssistant.value = current.copy(content = current.content + delta)
        }
    }

    override fun onTextDone(itemId: String, text: String) {
        val content = if (text.isNotBlank()) text else _streamingAssistant.value?.content.orEmpty()
        if (content.isNotBlank()) {
            scope.launch {
                store.appendMessage(
                    session.sessionId,
                    ChatMessage(sender = Sender.ASSISTANT, content = content)
                )
            }
        }
        _streamingAssistant.value = null
    }

    override fun onToolCall(call: ToolCall) {
        if (!_agentToolsEnabled.value) return
        val args = runCatching { JSONObject(call.arguments) }.getOrElse { JSONObject() }
        val summary = summarizeToolCall(call.name, args)
        val pending = PendingToolCall(call.callId, call.name, args, summary)
        _pendingToolCalls.value = _pendingToolCalls.value + pending
    }

    override fun onResponseDone() {
        if (disconnectAfterResponse && !_speechModeEnabled.value) {
            realtime.disconnect()
            disconnectAfterResponse = false
        }
    }

    override fun onError(message: String) {
        scope.launch { appendSystemMessage(message) }
    }

    private fun startMessageCollection(sessionId: String) {
        messagesJob?.cancel()
        messagesJob = scope.launch {
            store.messagesFlow(sessionId).collect { _messages.value = it }
        }
    }

    private suspend fun ensureConnected(keepAlive: Boolean, history: List<ChatMessage>): Boolean {
        val didConnect = realtime.connect(keepAlive, _speechModeEnabled.value)
        if (didConnect) {
            realtime.seedConversation(history)
        }
        return didConnect
    }

    private suspend fun handleCommand(command: CommandResult) {
        when (command) {
            is CommandResult.Help -> appendSystemMessage(command.text)
            is CommandResult.Clear -> clearSession()
            is CommandResult.Stats -> appendSystemMessage(buildStatsText())
            is CommandResult.Export -> appendSystemMessage(exportConversation(command.format))
            is CommandResult.MemorySearch -> appendSystemMessage("Memory search is not enabled yet")
            is CommandResult.Who -> appendSystemMessage("Participants: You, JunctionGPT")
            is CommandResult.Set -> appendSystemMessage("Setting '${command.option}' is not supported yet")
            is CommandResult.Error -> appendSystemMessage(command.message)
        }
    }

    private suspend fun appendSystemMessage(content: String) {
        store.appendMessage(
            session.sessionId,
            ChatMessage(sender = Sender.SYSTEM, content = content)
        )
    }

    private fun buildStatsText(): String {
        val total = _messages.value.size
        val started = DateTimeFormatter.ISO_INSTANT.format(session.startedAt)
        return "Session: ${session.sessionId}\nStarted: $started\nMessages: $total"
    }

    private fun exportConversation(format: String): String {
        return when (format.lowercase()) {
            "text" -> buildTextExport()
            "json" -> buildJsonExport()
            else -> "Unsupported export format: $format"
        }
    }

    private fun buildTextExport(): String {
        val builder = StringBuilder()
        builder.append("Chat Session: ${session.sessionId}\n")
        builder.append("Started: ${DateTimeFormatter.ISO_INSTANT.format(session.startedAt)}\n")
        builder.append("====================================\n")
        for (msg in _messages.value) {
            builder.append("[${DateTimeFormatter.ISO_INSTANT.format(msg.timestamp)}] ${msg.sender}:\n")
            builder.append(msg.content).append("\n\n")
        }
        return builder.toString().trim()
    }

    private fun buildJsonExport(): String {
        val builder = StringBuilder()
        builder.append("{")
        builder.append("\"sessionId\":\"${session.sessionId}\",")
        builder.append("\"startedAt\":\"${DateTimeFormatter.ISO_INSTANT.format(session.startedAt)}\",")
        builder.append("\"messages\":[")
        _messages.value.forEachIndexed { index, msg ->
            builder.append("{")
            builder.append("\"id\":\"${msg.id}\",")
            builder.append("\"timestamp\":\"${DateTimeFormatter.ISO_INSTANT.format(msg.timestamp)}\",")
            builder.append("\"sender\":\"${msg.sender}\",")
            builder.append("\"content\":\"")
            builder.append(msg.content.replace("\\", "\\\\").replace("\"", "\\\""))
            builder.append("\"")
            builder.append("}")
            if (index < _messages.value.size - 1) builder.append(",")
        }
        builder.append("]}")
        return builder.toString()
    }

    private suspend fun applyToolCallInternal(call: PendingToolCall): ToolApplyResult {
        return when (call.name) {
            "set_speech_mode" -> {
                val target = call.arguments.optString("conversationId")
                if (target.isNotBlank() && target != session.sessionId) {
                    return ToolApplyResult("", errorOutput("Unknown conversation"))
                }
                val enabled = call.arguments.optBoolean("enabled", false)
                val previous = _speechModeEnabled.value
                setSpeechMode(enabled)
                ToolApplyResult(
                    confirmation = "Speech mode ${if (enabled) "enabled" else "disabled"}.",
                    toolOutput = successOutput("speech_mode", enabled.toString()),
                    undo = UndoAction("Undo speech mode") {
                        setSpeechMode(previous)
                        "Reverted speech mode."
                    }
                )
            }
            "set_feed_filter" -> {
                val packageName = call.arguments.optString("packageName")
                if (packageName.isBlank()) {
                    return ToolApplyResult("", errorOutput("Missing packageName"))
                }
                val enabled = call.arguments.optBoolean("enabled", true)
                val previous = prefs.isPackageEnabled(packageName)
                prefs.setPackageEnabled(packageName, enabled)
                ToolApplyResult(
                    confirmation = "Feed filter updated for $packageName.",
                    toolOutput = successOutput("set_feed_filter", "$packageName=$enabled"),
                    undo = UndoAction("Undo feed filter") {
                        prefs.setPackageEnabled(packageName, previous)
                        "Reverted feed filter for $packageName."
                    }
                )
            }
            "archive_feed_item" -> {
                val id = call.arguments.optString("id")
                if (id.isBlank()) {
                    return ToolApplyResult("", errorOutput("Missing id"))
                }
                val previous = feedRepository.getEntityById(id)?.status
                feedRepository.archive(id)
                ToolApplyResult(
                    confirmation = "Archived feed item $id.",
                    toolOutput = successOutput("archive_feed_item", id),
                    undo = UndoAction("Undo archive") {
                        if (previous != null) {
                            feedRepository.updateStatus(id, previous)
                            "Restored feed item $id."
                        } else {
                            "No prior state for $id."
                        }
                    }
                )
            }
            "check_for_updates" -> {
                val update = UpdateChecker().checkForUpdate(BuildConfig.VERSION_NAME)
                updateState.value = update
                prefs.updateLastUpdateCheckAt(System.currentTimeMillis())
                val message = if (update != null) {
                    "Update available: ${update.version}."
                } else {
                    "No updates available."
                }
                ToolApplyResult(
                    confirmation = message,
                    toolOutput = successOutput("check_for_updates", message)
                )
            }
            "set_setting" -> {
                val key = call.arguments.optString("key")
                val value = call.arguments.opt("value")
                applySetting(key, value)
            }
            else -> {
                ToolApplyResult("", errorOutput("Unsupported tool: ${call.name}"))
            }
        }
    }

    private suspend fun applySetting(key: String, value: Any?): ToolApplyResult {
        return when (key) {
            "digest_interval_minutes" -> {
                val previous = prefs.digestIntervalMinutesFlow.first()
                val parsed = value.toString().toIntOrNull() ?: previous
                val safe = parsed.coerceAtLeast(15)
                prefs.setDigestIntervalMinutes(safe)
                Scheduler.scheduleFeedDigest(appContext, safe.toLong())
                ToolApplyResult(
                    confirmation = "Digest interval set to $safe minutes.",
                    toolOutput = successOutput(key, safe.toString()),
                    undo = UndoAction("Undo digest interval") {
                        prefs.setDigestIntervalMinutes(previous)
                        Scheduler.scheduleFeedDigest(appContext, previous.toLong())
                        "Reverted digest interval to $previous minutes."
                    }
                )
            }
            "use_http_backend" -> {
                val previous = prefs.useHttpBackendFlow.first()
                val enabled = value.toString().toBooleanStrictOrNull() ?: previous
                prefs.setUseHttpBackend(enabled)
                ToolApplyResult(
                    confirmation = "HTTP backend ${if (enabled) "enabled" else "disabled"}.",
                    toolOutput = successOutput(key, enabled.toString()),
                    undo = UndoAction("Undo HTTP backend") {
                        prefs.setUseHttpBackend(previous)
                        "Reverted HTTP backend setting."
                    }
                )
            }
            "api_base_url" -> {
                val previous = prefs.apiBaseUrlFlow.first()
                val url = value?.toString()?.trim().orEmpty()
                prefs.setApiBaseUrl(url)
                ToolApplyResult(
                    confirmation = "API base URL updated.",
                    toolOutput = successOutput(key, url),
                    undo = UndoAction("Undo API URL") {
                        prefs.setApiBaseUrl(previous)
                        "Reverted API base URL."
                    }
                )
            }
            "realtime_endpoint" -> {
                val previous = prefs.realtimeEndpointFlow.first()
                val url = value?.toString()?.trim().orEmpty()
                prefs.setRealtimeEndpoint(url)
                ToolApplyResult(
                    confirmation = "Realtime endpoint updated.",
                    toolOutput = successOutput(key, url),
                    undo = UndoAction("Undo realtime endpoint") {
                        prefs.setRealtimeEndpoint(previous)
                        "Reverted realtime endpoint."
                    }
                )
            }
            else -> {
                ToolApplyResult("", errorOutput("Unsupported setting: $key"))
            }
        }
    }

    private fun summarizeToolCall(name: String, args: JSONObject): String {
        return when (name) {
            "set_speech_mode" -> "Set speech mode to ${args.optBoolean("enabled", false)}"
            "set_feed_filter" -> "Set feed filter ${args.optString("packageName")} = ${args.optBoolean("enabled", true)}"
            "archive_feed_item" -> "Archive feed item ${args.optString("id")}" 
            "check_for_updates" -> "Check for updates"
            "set_setting" -> "Set ${args.optString("key")}"
            else -> name
        }
    }

    private fun successOutput(action: String, detail: String): String {
        return JSONObject()
            .put("status", "applied")
            .put("action", action)
            .put("detail", detail)
            .toString()
    }

    private fun errorOutput(message: String?): String {
        return JSONObject()
            .put("status", "error")
            .put("message", message ?: "Unknown error")
            .toString()
    }

    private fun newSession(): ChatSession {
        return ChatSession(
            sessionId = UUID.randomUUID().toString(),
            startedAt = now(),
            messages = emptyList(),
            speechModeEnabled = false,
            agentToolsEnabled = true
        )
    }
}
