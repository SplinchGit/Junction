package com.splinch.junction.chat

interface ConversationStore {
    fun loadSession(): ChatSession?
    fun saveSession(session: ChatSession)
    fun clear()
}

class InMemoryConversationStore : ConversationStore {
    private var session: ChatSession? = null

    override fun loadSession(): ChatSession? = session

    override fun saveSession(session: ChatSession) {
        this.session = session
    }

    override fun clear() {
        session = null
    }
}
