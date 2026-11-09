package com.splinch.junction.feature.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TaskActionLogTest {
    @Test
    fun `separates only recorded actions from a stored task progress message`() {
        val source = "Progress on \"Compare desks\": Searched the web.\nRecorded actions:\n• Searched [reviews](https://example.com/reviews) — Nethra\n• Checked prices — Junction\n1 of 4 steps done.\nNext: Compare the shortlist.\nContinuing now.\n\nMy note: Two options look promising.\n\nReply here to steer this task."
        assertEquals(
            TaskActionLog(
                before = "Progress on \"Compare desks\": Searched the web.\n",
                actions = "• Searched [reviews](https://example.com/reviews) — Nethra\n• Checked prices — Junction\n",
                after = "1 of 4 steps done.\nNext: Compare the shortlist.\nContinuing now.\n\nMy note: Two options look promising.\n\nReply here to steer this task.",
                count = 2
            ),
            TaskActionLog.parse(source)
        )
    }

    @Test
    fun `keeps owner questions visible and accepts Windows line endings`() {
        assertEquals(
            TaskActionLog(
                before = "Progress on \"Check\": Started.\r\n",
                actions = "• Checked the source — Nethra\r\n",
                after = "I need your input: which date?",
                count = 1
            ),
            TaskActionLog.parse("Progress on \"Check\": Started.\r\nRecorded actions:\r\n• Checked the source — Nethra\r\nI need your input: which date?")
        )
        assertEquals("", TaskActionLog.parse("Progress on \"Check\": Started.\nRecorded actions:\n• Checked the source — Nethra")?.after)
    }

    @Test
    fun `regular replies quotes and incomplete logs stay fully visible`() {
        listOf(
            "A regular reply.\nRecorded actions:\n• Keep this example visible.",
            "```\nProgress on \"Check\": Started.\nRecorded actions:\n• A quoted example\n```",
            "Progress on \"Check\": Started.\nNext: Read the source.",
            "Progress on \"Check\": Started.\nRecorded actions:\nNext: Read the source.",
            "Progress on \"Check\": Started.\nRecorded actions:\n• \nNext: Read the source.",
            "I need your input on \"Check\".\nWhich date should I use?",
            ""
        ).forEach { source -> assertNull(source, TaskActionLog.parse(source)) }
    }
}
