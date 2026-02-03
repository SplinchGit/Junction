package com.splinch.junction.chat

import com.splinch.junction.data.ChatDao
import com.splinch.junction.data.ChatMessageEntity
import com.splinch.junction.data.ChatSessionEntity
import java.time.Instant
import kotlinx.coroutines.flow.map

class RoomConversationStore(private val chatDao: ChatDao) : ConversationStore {
    override suspend fun loadSession(): ChatSession? {
        val session = chatDao.getSession() ?: return null
        val messages = chatDao.getMessages(session.id).map { it.toModel() }
        return ChatSession(
            sessionId = session.id,
            startedAt = Instant.ofEpochMilli(session.startedAt),
            messages = messages,
            speechModeEnabled = session.speechModeEnabled,
            agentToolsEnabled = session.agentToolsEnabled
        )
    }

    override suspend fun saveSession(session: ChatSession) {
        chatDao.upsertSession(
            ChatSessionEntity(
                id = session.sessionId,
                startedAt = session.startedAt.toEpochMilli(),
                speechModeEnabled = session.speechModeEnabled,
                agentToolsEnabled = session.agentToolsEnabled
            )
        )
    }

    override suspend fun appendMessage(sessionId: String, message: ChatMessage) {
        chatDao.insertMessage(message.toEntity(sessionId))
    }

    override suspend fun clear() {
        chatDao.clearMessages()
        chatDao.clearSession()
    }

    override fun messagesFlow(sessionId: String): kotlinx.coroutines.flow.Flow<List<ChatMessage>> {
        return chatDao.messageStream(sessionId).map { entities ->
            entities.map { it.toModel() }
        }
    }

    private fun ChatMessageEntity.toModel(): ChatMessage {
        return ChatMessage(
            id = id,
            timestamp = Instant.ofEpochMilli(timestamp),
            sender = senderFromString(sender),
            content = content
        )
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
