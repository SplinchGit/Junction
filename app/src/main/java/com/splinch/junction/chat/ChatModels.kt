package com.splinch.junction.chat

import java.time.Instant
import java.util.UUID

enum class Sender {
    USER,
    ASSISTANT,
    SYSTEM
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
    val messages: List<ChatMessage> = emptyList()
)
