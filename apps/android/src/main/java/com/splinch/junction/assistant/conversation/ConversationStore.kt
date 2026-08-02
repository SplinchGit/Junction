package com.splinch.junction.assistant.conversation

import com.splinch.junction.assistant.context.*
import com.splinch.junction.assistant.conversation.*
import com.splinch.junction.assistant.planning.*
import com.splinch.junction.assistant.provider.*
import com.splinch.junction.assistant.runtime.*
import com.splinch.junction.assistant.tools.*
import com.splinch.junction.assistant.trust.*

interface ConversationStore {
    suspend fun loadSession(): ChatSession?
    suspend fun saveSession(session: ChatSession)
    suspend fun appendMessage(sessionId: String, message: ChatMessage)
    suspend fun clear()

    /** Drops all but the [keepRecent] newest messages, leaving the session running. */
    suspend fun trimMessages(sessionId: String, keepRecent: Int)
    fun messagesFlow(sessionId: String): kotlinx.coroutines.flow.Flow<List<ChatMessage>>

    /** Chat shelf support: multiple concurrent sessions/projects. */
    suspend fun loadSessionById(sessionId: String): ChatSession?
    fun sessionSummariesFlow(): kotlinx.coroutines.flow.Flow<List<ChatSessionSummary>>
    suspend fun renameSession(sessionId: String, title: String)
    suspend fun deleteSession(sessionId: String)
}

class InMemoryConversationStore : ConversationStore {
    private var session: ChatSession? = null
    private val sessions = linkedMapOf<String, ChatSession>()
    private val messagesFlow = kotlinx.coroutines.flow.MutableStateFlow<List<ChatMessage>>(emptyList())
    private val summariesFlow = kotlinx.coroutines.flow.MutableStateFlow<List<ChatSessionSummary>>(emptyList())

    override suspend fun loadSession(): ChatSession? = session

    override suspend fun saveSession(session: ChatSession) {
        this.session = session
        sessions[session.sessionId] = session
        messagesFlow.value = session.messages
        publishSummaries()
    }

    override suspend fun appendMessage(sessionId: String, message: ChatMessage) {
        val target = sessions[sessionId] ?: session
        val updated = target?.copy(messages = target.messages + message) ?: return
        sessions[sessionId] = updated
        if (session?.sessionId == sessionId) {
            session = updated
            messagesFlow.value = updated.messages
        }
        publishSummaries()
    }

    override suspend fun clear() {
        session = null
        sessions.clear()
        messagesFlow.value = emptyList()
        publishSummaries()
    }

    override suspend fun trimMessages(sessionId: String, keepRecent: Int) {
        val target = sessions[sessionId] ?: return
        val kept = target.messages.takeLast(keepRecent)
        sessions[sessionId] = target.copy(messages = kept)
        if (session?.sessionId == sessionId) {
            session = sessions[sessionId]
            messagesFlow.value = kept
        }
    }

    override fun messagesFlow(sessionId: String): kotlinx.coroutines.flow.Flow<List<ChatMessage>> {
        return messagesFlow
    }

    override suspend fun loadSessionById(sessionId: String): ChatSession? = sessions[sessionId]

    override fun sessionSummariesFlow(): kotlinx.coroutines.flow.Flow<List<ChatSessionSummary>> = summariesFlow

    override suspend fun renameSession(sessionId: String, title: String) {
        sessions[sessionId]?.let { sessions[sessionId] = it.copy(title = title) }
        if (session?.sessionId == sessionId) session = sessions[sessionId]
        publishSummaries()
    }

    override suspend fun deleteSession(sessionId: String) {
        sessions.remove(sessionId)
        if (session?.sessionId == sessionId) session = null
        publishSummaries()
    }

    private fun publishSummaries() {
        summariesFlow.value = sessions.values.map { s ->
            ChatSessionSummary(s.sessionId, s.title, s.startedAt, s.messages.lastOrNull()?.content)
        }.sortedByDescending { it.startedAt }
    }
}
