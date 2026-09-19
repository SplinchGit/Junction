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
}
