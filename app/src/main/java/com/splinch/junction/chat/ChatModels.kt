package com.splinch.junction.chat

import java.time.Instant
import java.util.UUID

enum class Sender {
    USER,
    ASSISTANT,
    SYSTEM
}

fun senderFromString(value: String?): Sender {
    val normalized = value?.trim()?.uppercase()
    return when (normalized) {
        "USER" -> Sender.USER
        "ASSISTANT", "MODEL" -> Sender.ASSISTANT
        "SYSTEM" -> Sender.SYSTEM
        else -> Sender.SYSTEM
    }
}

data class ChatMessage(
    val id: String = UUID.randomUUID().toString(),
    val timestamp: Instant = Instant.now(),
    val sender: Sender,
    val content: String,
    val provenance: Provenance = Provenance.OWNER,
    val sourceRef: String? = null,
    val metadata: Map<String, String> = emptyMap(),
    // Absolute path to an app-private, pre-downscaled JPEG attached to this message.
    val imagePath: String? = null
)

data class ChatSession(
    val sessionId: String,
    val startedAt: Instant,
    val messages: List<ChatMessage> = emptyList(),
    val speechModeEnabled: Boolean = false,
    val agentToolsEnabled: Boolean = true
)
