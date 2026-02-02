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
    val metadata: Map<String, String> = emptyMap()
)

data class ChatSession(
    val sessionId: String,
    val startedAt: Instant,
    val messages: List<ChatMessage> = emptyList(),
    val speechModeEnabled: Boolean = false,
    val agentToolsEnabled: Boolean = true
)
