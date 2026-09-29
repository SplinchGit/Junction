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

    @Test
    fun `switching provider clears credential url and frontier drafts`() {
        val draft = ProviderSettingsDraft("openai", "gpt-5.6-sol", "gpt-5.6-sol", "openai-secret", "https://custom.example/v1")
            .selectProvider("openrouter")
        assertEquals("openrouter", draft.providerId)
        assertEquals("nvidia/nemotron-3-ultra-550b-a55b:free", draft.modelId)
        assertEquals("", draft.frontierModel)
        assertEquals("", draft.apiKey)
        assertEquals("", draft.baseUrl)
    }

    @Test
    fun `switching to custom clears the previous providers model`() {
        val draft = ProviderSettingsDraft("openai", "gpt-5.6-sol", "", "", "")
            .selectProvider("custom")
        assertEquals("custom", draft.providerId)
        assertEquals("", draft.modelId)
    }
}
