package com.splinch.junction.chat

import com.splinch.junction.data.ChatDao
import com.splinch.junction.data.ChatMessageEntity
import com.splinch.junction.data.ChatSessionEntity
import java.time.Instant

class RoomConversationStore(private val chatDao: ChatDao) : ConversationStore {
    override suspend fun loadSession(): ChatSession? {
        val session = chatDao.getSession() ?: return null
        val messages = chatDao.getMessages(session.id).map { it.toModel() }
        return ChatSession(
            sessionId = session.id,
            startedAt = Instant.ofEpochMilli(session.startedAt),
            messages = messages
        )
    }

    override suspend fun saveSession(session: ChatSession) {
        chatDao.upsertSession(
            ChatSessionEntity(
                id = session.sessionId,
                startedAt = session.startedAt.toEpochMilli()
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

    private fun ChatMessageEntity.toModel(): ChatMessage {
        return ChatMessage(
            id = id,
            timestamp = Instant.ofEpochMilli(timestamp),
            sender = Sender.valueOf(sender),
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
