package com.splinch.junction.assistant.runtime

import org.junit.Assert.*
import org.junit.Test

class AssistantPromptTest {
    @Test fun localPromptIsCompactAndCapabilityAccurate() {
        val prompt = AssistantPrompt.forProvider("local")
        assertTrue(prompt.length < 1800)
        assertTrue(prompt.contains("paired PC"))
        assertFalse(prompt.contains("Gmail"))
        assertTrue(prompt.contains("do not modify"))
    }
    @Test fun actionPromptPreservesTrustAndHonesty() {
        val prompt = AssistantPrompt.forProvider("openai")
        assertTrue(prompt.contains("UNTRUSTED"))
        assertTrue(prompt.contains("tool result"))
        assertTrue(prompt.contains("approval"))
        assertTrue(prompt.contains("authorship"))
    }

    @Test fun androidCapabilityContextDistinguishesProductFromCurrentChat() {
        val context = AssistantPrompt.androidCapabilityContext(
            exposedToolNames = listOf("remember_fact", "read_screen")
        )

        assertTrue(context.contains("Codex integration and persistent foreman infrastructure exist"))
        assertTrue(context.contains("not exposed in this chat"))
        assertTrue(context.contains("read_screen, remember_fact"))
        assertTrue(context.contains("web search"))
        assertTrue(context.contains("Do not claim that an unlisted tool is available"))
    }

    @Test fun androidCapabilityContextDoesNotDenyExposedCodexControl() {
        val context = AssistantPrompt.androidCapabilityContext(
            exposedToolNames = listOf("schedule_codex")
        )

        assertFalse(context.contains("Codex scheduling and usage-limit management are not exposed"))
        assertTrue(context.contains("schedule_codex"))
    }
}
