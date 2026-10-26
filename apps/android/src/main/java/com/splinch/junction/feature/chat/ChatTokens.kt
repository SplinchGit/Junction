package com.splinch.junction.feature.chat

import com.splinch.junction.assistant.conversation.ChatMessage
import com.splinch.junction.assistant.conversation.Sender
import java.util.Locale
import kotlin.math.ceil

/**
 * How long a chat is getting, and, for replies from Nethra on the PC, how much of it the PC
 * model actually reads. Mirrors the Windows header line (apps/windows/renderer/chat-tokens.js),
 * which mirrors canonicalHistory in apps/windows/src/assistant-context.js. Counts are estimates
 * (about 3.5 characters per token); the last prompt size is the PC's measured count.
 */
object ChatTokens {
    private const val HISTORY_CHARS = 3500
    private const val HISTORY_MESSAGES = 12
    private const val MESSAGE_CHARS = 2000
    private const val CONTEXT_TOKENS = 8192
    private val PROMPT = Regex("""([\d,]+) in\b""")

    data class Summary(val total: Int, val messages: Int, val seenMessages: Int, val seenTokens: Int, val lastPromptTokens: Int?)

    private fun estimate(chars: Int) = ceil(chars / 3.5).toInt()

    fun summary(messages: List<ChatMessage>): Summary {
        val items = messages.filter { it.sender != Sender.SYSTEM && it.content.isNotBlank() }.map { it to it.content.trim().length }
        var remaining = HISTORY_CHARS
        var seenMessages = 0
        var seenChars = 0
        for (index in items.indices.reversed()) {
            if (remaining <= 0 || seenMessages >= HISTORY_MESSAGES) break
            val length = minOf(items[index].second, remaining, MESSAGE_CHARS)
            seenMessages++; seenChars += length; remaining -= length
        }
        // Telemetry only arrives on replies run by Nethra on the PC; its "N in" is the measured prompt.
        val lastPrompt = items.map { it.first }.lastOrNull { it.sender == Sender.ASSISTANT && it.telemetry != null }
            ?.telemetry?.let { PROMPT.find(it)?.groupValues?.get(1)?.replace(",", "")?.toIntOrNull() }
        return Summary(items.sumOf { estimate(it.second) }, items.size, seenMessages, estimate(seenChars), lastPrompt)
    }

    private fun compact(value: Int) = if (value >= 1000) String.format(Locale.US, "%.1fk", value / 1000.0) else value.toString()

    /** One line for the chat header, or null for an empty chat. */
    fun line(messages: List<ChatMessage>): String? {
        val summary = summary(messages)
        if (summary.messages == 0) return null
        val parts = mutableListOf("≈${compact(summary.total)} tokens in this chat")
        val fromPc = messages.lastOrNull { it.sender == Sender.ASSISTANT }?.telemetry != null
        if (fromPc) parts.add(
            if (summary.seenMessages < summary.messages) "Nethra on your PC reads the latest ≈${compact(summary.seenTokens)} (${summary.seenMessages} of ${summary.messages} messages)"
            else "Nethra on your PC reads all of it"
        )
        summary.lastPromptTokens?.let { parts.add("last reply's prompt ${String.format(Locale.US, "%,d", it)} of ${String.format(Locale.US, "%,d", CONTEXT_TOKENS)}") }
        return parts.joinToString(" · ")
    }
}
