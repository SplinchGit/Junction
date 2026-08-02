package com.splinch.junction.assistant.conversation

import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Owns the current session, message persistence, collection, trimming, and exports. */
class ConversationCoordinator(
    private val store: ConversationStore,
    private val scope: CoroutineScope,
    private val now: () -> Instant = { Instant.now() }
) {
    private var session = newSession()
    private var messagesJob: Job? = null

    private val _messages = MutableStateFlow(emptyList<ChatMessage>())
    val messages: StateFlow<List<ChatMessage>> = _messages.asStateFlow()

    private val _sessionId = MutableStateFlow(session.sessionId)
    val sessionId: StateFlow<String> = _sessionId.asStateFlow()

    val currentSession: ChatSession
        get() = session

    suspend fun initialize(): ChatSession {
        session = store.loadSession() ?: newSession().also { store.saveSession(it) }
        _sessionId.value = session.sessionId
        startCollection()
        return session
    }

    suspend fun append(message: ChatMessage) {
        store.appendMessage(session.sessionId, message)
        // Room's Flow re-queries only after its invalidation tracker fires, which lands
        // a beat after this write returns. Callers that read `messages` immediately
        // after append (building the next provider request) would otherwise see a
        // stale list missing the message just sent -- e.g. ending on the prior
        // assistant turn, which Anthropic rejects as an unsupported prefill.
        _messages.value = _messages.value.filterNot { it.id == message.id } + message
    }

    /** Upserts a message with the same id, used to attach the cached image summary. */
    suspend fun upsert(message: ChatMessage) {
        store.appendMessage(session.sessionId, message)
        _messages.value = _messages.value.map { if (it.id == message.id) message else it }
    }

    suspend fun clear(): ChatSession {
        store.clear()
        session = newSession()
        store.saveSession(session)
        _sessionId.value = session.sessionId
        startCollection()
        return session
    }

    suspend fun setSpeechMode(enabled: Boolean) {
        session = session.copy(speechModeEnabled = enabled)
        store.saveSession(session)
    }

    suspend fun setAgentToolsEnabled(enabled: Boolean) {
        session = session.copy(agentToolsEnabled = enabled)
        store.saveSession(session)
    }

    suspend fun trim(keepRecent: Int): String {
        val safeKeep = keepRecent.coerceAtLeast(0)
        val before = _messages.value.size
        if (before <= safeKeep) {
            return "Nothing to trim — the conversation is $before message(s) long."
        }
        store.trimMessages(session.sessionId, safeKeep)
        return "Trimmed ${before - safeKeep} older message(s), kept the most recent $safeKeep."
    }

    fun statsText(): String {
        val started = DateTimeFormatter.ISO_INSTANT.format(session.startedAt)
        return "Session: ${session.sessionId}\nStarted: $started\nMessages: ${_messages.value.size}"
    }

    fun export(format: String): String = when (format.lowercase()) {
        "text" -> textExport()
        "json" -> jsonExport()
        else -> "Unsupported export format: $format"
    }

    private fun textExport(): String {
        val builder = StringBuilder()
        builder.append("Chat Session: ${session.sessionId}\n")
        builder.append("Started: ${DateTimeFormatter.ISO_INSTANT.format(session.startedAt)}\n")
        builder.append("====================================\n")
        for (message in _messages.value) {
            builder.append("[${DateTimeFormatter.ISO_INSTANT.format(message.timestamp)}] ${message.sender}:\n")
            builder.append(message.content).append("\n\n")
        }
        return builder.toString().trim()
    }

    private fun jsonExport(): String {
        val builder = StringBuilder()
        builder.append("{")
        builder.append("\"sessionId\":\"${session.sessionId}\",")
        builder.append("\"startedAt\":\"${DateTimeFormatter.ISO_INSTANT.format(session.startedAt)}\",")
        builder.append("\"messages\":[")
        _messages.value.forEachIndexed { index, message ->
            builder.append("{")
            builder.append("\"id\":\"${message.id}\",")
            builder.append("\"timestamp\":\"${DateTimeFormatter.ISO_INSTANT.format(message.timestamp)}\",")
            builder.append("\"sender\":\"${message.sender}\",")
            builder.append("\"content\":\"")
            builder.append(message.content.replace("\\", "\\\\").replace("\"", "\\\""))
            builder.append("\"")
            builder.append("}")
            if (index < _messages.value.size - 1) builder.append(",")
        }
        builder.append("]}")
        return builder.toString()
    }

    private fun startCollection() {
        messagesJob?.cancel()
        messagesJob = scope.launch {
            store.messagesFlow(session.sessionId).collect { _messages.value = it }
        }
    }

    private fun newSession(): ChatSession = ChatSession(
        sessionId = UUID.randomUUID().toString(),
        startedAt = now(),
        messages = emptyList(),
        speechModeEnabled = false,
        agentToolsEnabled = true
    )
}
