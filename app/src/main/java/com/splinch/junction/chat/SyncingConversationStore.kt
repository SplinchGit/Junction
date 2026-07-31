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

    // Local-only, matching clear() above: trimming shortens what this device
    // keeps and sends as context. It is not a remote delete, so no sync call.
    override suspend fun trimMessages(sessionId: String, keepRecent: Int) {
        delegate.trimMessages(sessionId, keepRecent)
    }

    override fun messagesFlow(sessionId: String): kotlinx.coroutines.flow.Flow<List<ChatMessage>> {
        return delegate.messagesFlow(sessionId)
    }

    private fun ChatMessage.toEntity(sessionId: String): ChatMessageEntity {
        return ChatMessageEntity(
            id = id,
            sessionId = sessionId,
            timestamp = timestamp.toEpochMilli(),
            sender = sender.name,
            content = content,
            provenance = provenance.name,
            sourceRef = sourceRef
        )
    }
}
