package com.splinch.junction.assistant.conversation

import com.splinch.junction.assistant.context.*
import com.splinch.junction.assistant.conversation.*
import com.splinch.junction.assistant.planning.*
import com.splinch.junction.assistant.provider.*
import com.splinch.junction.assistant.runtime.*
import com.splinch.junction.assistant.tools.*
import com.splinch.junction.assistant.trust.*

import com.splinch.junction.data.database.chat.ChatMessageEntity
import com.splinch.junction.data.sync.firebase.ChatSyncManager

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
