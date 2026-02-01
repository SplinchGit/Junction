package com.splinch.junction.chat

interface ConversationStore {
    suspend fun loadSession(): ChatSession?
    suspend fun saveSession(session: ChatSession)
    suspend fun appendMessage(sessionId: String, message: ChatMessage)
    suspend fun clear()
}

class InMemoryConversationStore : ConversationStore {
    private var session: ChatSession? = null

    override suspend fun loadSession(): ChatSession? = session

    override suspend fun saveSession(session: ChatSession) {
        this.session = session
    }

    override suspend fun appendMessage(sessionId: String, message: ChatMessage) {
        session = session?.copy(messages = session?.messages.orEmpty() + message)
    }

    override suspend fun clear() {
        session = null
    }
}
