package com.splinch.junction.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface ChatDao {
    @Query("SELECT * FROM chat_sessions LIMIT 1")
    suspend fun getSession(): ChatSessionEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertSession(session: ChatSessionEntity)

    @Query("SELECT * FROM chat_messages WHERE sessionId = :sessionId ORDER BY timestamp ASC")
    suspend fun getMessages(sessionId: String): List<ChatMessageEntity>

    @Query("SELECT * FROM chat_messages WHERE sessionId = :sessionId ORDER BY timestamp ASC")
    fun messageStream(sessionId: String): Flow<List<ChatMessageEntity>>

    @Query("SELECT * FROM chat_messages WHERE id = :id LIMIT 1")
    suspend fun getMessageById(id: String): ChatMessageEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMessage(message: ChatMessageEntity)

    @Query("DELETE FROM chat_messages")
    suspend fun clearMessages()

    @Query("DELETE FROM chat_sessions")
    suspend fun clearSession()

    @Query("UPDATE chat_sessions SET speechModeEnabled = :enabled WHERE id = :id")
    suspend fun updateSpeechMode(id: String, enabled: Boolean)

    @Query("UPDATE chat_sessions SET agentToolsEnabled = :enabled WHERE id = :id")
    suspend fun updateAgentToolsEnabled(id: String, enabled: Boolean)
}
