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
    private val syncManager: ChatSyncManager,
    private val lanDelete: (suspend (String) -> Boolean)? = null
) : ConversationStore {
    override suspend fun loadSession(): ChatSession? = delegate.loadSession()

    override suspend fun saveSession(session: ChatSession) {
        delegate.saveSession(session)
        runCatching { syncManager.enqueueSession(
            com.splinch.junction.data.database.chat.ChatSessionEntity(
                id = session.sessionId,
                startedAt = session.startedAt.toEpochMilli(),
                speechModeEnabled = session.speechModeEnabled,
                agentToolsEnabled = session.agentToolsEnabled,
                title = session.title,
                sharedUpdatedAt = session.sharedUpdatedAt
            )
        ) }
    }

    override suspend fun appendMessage(sessionId: String, message: ChatMessage) {
        delegate.appendMessage(sessionId, message)
        syncManager.enqueueMessage(sessionId, message.toEntity(sessionId))
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

    override suspend fun loadSessionById(sessionId: String): ChatSession? = delegate.loadSessionById(sessionId)

    override fun sessionSummariesFlow(): kotlinx.coroutines.flow.Flow<List<ChatSessionSummary>> =
        delegate.sessionSummariesFlow()

    override suspend fun renameSession(sessionId: String, title: String) {
        delegate.renameSession(sessionId, title)
        syncManager.enqueueRename(sessionId, title)
    }

    override suspend fun deleteSession(sessionId: String) {
        if (lanDelete?.invoke(sessionId) != true) syncManager.tombstoneConversation(sessionId)
        delegate.deleteSession(sessionId)
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
