package com.splinch.junction.data.database.chat

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

    /**
     * Deletes all but the [keepRecent] newest messages in a session, so a long
     * conversation can be shortened without ending it. Ordering matches
     * [getMessages]/[messageStream] (timestamp), with id as a tie-break so
     * messages written inside the same millisecond can't be trimmed
     * arbitrarily — otherwise a user turn could survive while the assistant
     * reply it belongs to was deleted.
     */
    @Query(
        """
        DELETE FROM chat_messages
        WHERE sessionId = :sessionId AND id NOT IN (
            SELECT id FROM chat_messages
            WHERE sessionId = :sessionId
            ORDER BY timestamp DESC, id DESC
            LIMIT :keepRecent
        )
        """
    )
    suspend fun trimMessages(sessionId: String, keepRecent: Int)

    @Query("DELETE FROM chat_sessions")
    suspend fun clearSession()

    @Query("UPDATE chat_sessions SET speechModeEnabled = :enabled WHERE id = :id")
    suspend fun updateSpeechMode(id: String, enabled: Boolean)

    @Query("UPDATE chat_sessions SET agentToolsEnabled = :enabled WHERE id = :id")
    suspend fun updateAgentToolsEnabled(id: String, enabled: Boolean)
}
