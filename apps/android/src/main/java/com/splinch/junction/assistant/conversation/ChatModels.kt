package com.splinch.junction.assistant.conversation

import com.splinch.junction.assistant.context.*
import com.splinch.junction.assistant.conversation.*
import com.splinch.junction.assistant.planning.*
import com.splinch.junction.assistant.provider.*
import com.splinch.junction.assistant.runtime.*
import com.splinch.junction.assistant.tools.*
import com.splinch.junction.assistant.trust.*

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
    val imagePath: String? = null,
    /** Cached one-line description, so replays cost text not image bytes. */
    val imageSummary: String? = null,
    /** Friendly "Claude Sonnet 5" / "GPT-5.6 Sol" label for an ASSISTANT message, so a fallback mid-conversation is visible at a glance instead of only showing up as a system-message aside. */
    val modelLabel: String? = null
)

data class ChatSession(
    val sessionId: String,
    val startedAt: Instant,
    val messages: List<ChatMessage> = emptyList(),
    val speechModeEnabled: Boolean = false,
    val agentToolsEnabled: Boolean = true,
    val title: String? = null
)

/** Lightweight row for the chat shelf -- no message list, so listing many sessions stays cheap. */
data class ChatSessionSummary(
    val sessionId: String,
    val title: String?,
    val startedAt: Instant,
    val preview: String?
)
