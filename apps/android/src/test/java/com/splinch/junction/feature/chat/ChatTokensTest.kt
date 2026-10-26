package com.splinch.junction.feature.chat

import com.splinch.junction.assistant.conversation.ChatMessage
import com.splinch.junction.assistant.conversation.Sender
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ChatTokensTest {
    private fun chat(count: Int, telemetry: String? = null) = List(count) { index ->
        ChatMessage(sender = if (index % 2 == 0) Sender.USER else Sender.ASSISTANT, content = "y".repeat(900), telemetry = if (index == count - 1) telemetry else null)
    }

    @Test
    fun `matches the Windows header line for a PC-hosted chat`() {
        // Same input and expected text as apps/windows/scripts/appearance-ui-smoke.js.
        assertEquals(
            "≈5.2k tokens in this chat · Nethra on your PC reads the latest ≈1.0k (4 of 20 messages) · last reply's prompt 2,411 of 8,192",
            ChatTokens.line(chat(20, "qwen3:30b · 22.1 tok/s · 300 out · 2,411 in · 14.2 s total"))
        )
    }

    @Test
    fun `chats with other providers only show their size`() {
        assertEquals("≈5.2k tokens in this chat", ChatTokens.line(chat(20)))
    }

    @Test
    fun `an empty chat shows nothing`() {
        assertNull(ChatTokens.line(emptyList()))
    }
}
