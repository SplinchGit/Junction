package com.splinch.junction.data.database.chat

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "chat_sessions")
data class ChatSessionEntity(
    @PrimaryKey val id: String,
    val startedAt: Long,
    val speechModeEnabled: Boolean = false,
    val agentToolsEnabled: Boolean = true
)

@Entity(tableName = "chat_messages")
data class ChatMessageEntity(
    @PrimaryKey val id: String,
    val sessionId: String,
    val timestamp: Long,
    val sender: String,
    val content: String,
    val provenance: String = "UNTRUSTED",
    val sourceRef: String? = null,
    // Absolute path to an app-private, pre-downscaled JPEG -- never a raw
    // content:// URI, since the Photo Picker only grants temporary read
    // access to those.
    val imagePath: String? = null,
    /** Cached one-line description, so replays cost text not image bytes. */
    val imageSummary: String? = null,
    /** Friendly provider/model label ("Claude Sonnet 5") for an ASSISTANT message. */
    val modelLabel: String? = null
)
