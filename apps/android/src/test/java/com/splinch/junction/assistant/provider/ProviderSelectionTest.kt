package com.splinch.junction.assistant.provider

import org.junit.Assert.assertEquals
import org.junit.Test

class ProviderSelectionTest {
    @Test
    fun `switching provider resets a stale model to that provider default`() {
        val selection = ProviderSelection("openai", "gpt-5.6-sol").selectProvider("openrouter")
        assertEquals("openrouter", selection.providerId)
        assertEquals("nvidia/nemotron-3-ultra-550b-a55b:free", selection.modelId)
    }

    @Test
    fun `selecting a model keeps the provider and exact model`() {
        val selection = ProviderSelection("openai", "gpt-5.6-luna").selectModel("gpt-5.6-sol")
        assertEquals("openai", selection.providerId)
        assertEquals("gpt-5.6-sol", selection.modelId)
    }
}
