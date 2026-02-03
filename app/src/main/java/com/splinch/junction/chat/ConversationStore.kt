package com.splinch.junction.chat

interface ConversationStore {
    suspend fun loadSession(): ChatSession?
    suspend fun saveSession(session: ChatSession)
    suspend fun appendMessage(sessionId: String, message: ChatMessage)
    suspend fun clear()
    fun messagesFlow(sessionId: String): kotlinx.coroutines.flow.Flow<List<ChatMessage>>
}

class InMemoryConversationStore : ConversationStore {
    private var session: ChatSession? = null
    private val messagesFlow = kotlinx.coroutines.flow.MutableStateFlow<List<ChatMessage>>(emptyList())

    override suspend fun loadSession(): ChatSession? = session

    override suspend fun saveSession(session: ChatSession) {
        this.session = session
        messagesFlow.value = session.messages
    }

    override suspend fun appendMessage(sessionId: String, message: ChatMessage) {
        val updated = session?.copy(messages = session?.messages.orEmpty() + message)
        session = updated
        messagesFlow.value = updated?.messages.orEmpty()
    }

    override suspend fun clear() {
        session = null
        messagesFlow.value = emptyList()
    }

    override fun messagesFlow(sessionId: String): kotlinx.coroutines.flow.Flow<List<ChatMessage>> {
        return messagesFlow
    }
}
