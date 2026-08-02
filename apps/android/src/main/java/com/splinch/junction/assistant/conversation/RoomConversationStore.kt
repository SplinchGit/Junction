package com.splinch.junction.assistant.conversation

import com.splinch.junction.assistant.context.*
import com.splinch.junction.assistant.conversation.*
import com.splinch.junction.assistant.planning.*
import com.splinch.junction.assistant.provider.*
import com.splinch.junction.assistant.runtime.*
import com.splinch.junction.assistant.tools.*
import com.splinch.junction.assistant.trust.*

import com.splinch.junction.data.database.chat.ChatDao
import com.splinch.junction.data.database.chat.ChatMessageEntity
import com.splinch.junction.data.database.chat.ChatSessionEntity
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

    override suspend fun trimMessages(sessionId: String, keepRecent: Int) {
        chatDao.trimMessages(sessionId, keepRecent)
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
            content = content,
            provenance = runCatching { Provenance.valueOf(provenance) }.getOrDefault(Provenance.UNTRUSTED),
            sourceRef = sourceRef,
            imagePath = imagePath,
            imageSummary = imageSummary,
            modelLabel = modelLabel
        )
    }

    private fun ChatMessage.toEntity(sessionId: String): ChatMessageEntity {
        return ChatMessageEntity(
            id = id,
            sessionId = sessionId,
            timestamp = timestamp.toEpochMilli(),
            sender = sender.name,
            content = content,
            provenance = provenance.name,
            sourceRef = sourceRef,
            imagePath = imagePath,
            imageSummary = imageSummary,
            modelLabel = modelLabel
        )
    }
}
