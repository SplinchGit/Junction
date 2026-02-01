package com.splinch.junction.chat

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.UUID

class ChatManager(
    private val store: ConversationStore = InMemoryConversationStore(),
    private val backend: ChatBackend = BackendFactory.create(),
    private val messageHandler: MessageHandler = MessageHandler(),
    private val now: () -> Instant = { Instant.now() }
) {
    private var session: ChatSession = store.loadSession() ?: newSession()
    private val _messages = MutableStateFlow(session.messages)
    val messages: StateFlow<List<ChatMessage>> = _messages.asStateFlow()

    suspend fun sendUserMessage(raw: String) {
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

        val userMessage = ChatMessage(
            sender = Sender.USER,
            content = processed.content
        )
        appendMessage(userMessage)

        val response = backend.generateResponse(session, userMessage)
        appendMessage(response)
    }

    fun clearSession() {
        session = newSession()
        store.clear()
        store.saveSession(session)
        _messages.value = session.messages
        appendSystemMessage("Session cleared")
    }

    private fun handleCommand(command: CommandResult) {
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

    private fun appendMessage(message: ChatMessage) {
        session = session.copy(messages = session.messages + message)
        store.saveSession(session)
        _messages.value = session.messages
    }

    private fun appendSystemMessage(content: String) {
        appendMessage(ChatMessage(sender = Sender.SYSTEM, content = content))
    }

    private fun buildStatsText(): String {
        val total = session.messages.size
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
        for (msg in session.messages) {
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
        session.messages.forEachIndexed { index, msg ->
            builder.append("{")
            builder.append("\"id\":\"${msg.id}\",")
            builder.append("\"timestamp\":\"${DateTimeFormatter.ISO_INSTANT.format(msg.timestamp)}\",")
            builder.append("\"sender\":\"${msg.sender}\",")
            builder.append("\"content\":\"")
            builder.append(msg.content.replace("\\", "\\\\").replace("\"", "\\\""))
            builder.append("\"")
            builder.append("}")
            if (index < session.messages.size - 1) builder.append(",")
        }
        builder.append("]}")
        return builder.toString()
    }

    private fun newSession(): ChatSession {
        return ChatSession(
            sessionId = UUID.randomUUID().toString(),
            startedAt = now(),
            messages = emptyList()
        )
    }
}
