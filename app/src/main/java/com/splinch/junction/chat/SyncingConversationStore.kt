package com.splinch.junction.chat

import com.splinch.junction.data.ChatMessageEntity
import com.splinch.junction.sync.firebase.ChatSyncManager

class SyncingConversationStore(
    private val delegate: ConversationStore,
    private val syncManager: ChatSyncManager
) : ConversationStore {
    override suspend fun loadSession(): ChatSession? = delegate.loadSession()

    override suspend fun saveSession(session: ChatSession) {
        delegate.saveSession(session)
    }

    override suspend fun appendMessage(sessionId: String, message: ChatMessage) {
        delegate.appendMessage(sessionId, message)
        syncManager.onLocalMessageAppended(sessionId, message.toEntity(sessionId))
    }

    override suspend fun clear() {
        delegate.clear()
    }

    private fun ChatMessage.toEntity(sessionId: String): ChatMessageEntity {
        return ChatMessageEntity(
            id = id,
            sessionId = sessionId,
            timestamp = timestamp.toEpochMilli(),
            sender = sender.name,
            content = content
        )
    }
}
