package com.splinch.junction.assistant.provider

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelCatalogTest {

    @Test
    fun `OpenAI catalog uses the current GPT family for every role`() {
        val openAi = ModelCatalog.providerById("openai")!!

        assertEquals("gpt-5.6-luna", openAi.defaultModelId)
        assertEquals(
            listOf("gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"),
            openAi.models.map { it.id }
        )
    }

    @Test
    fun `provider ids are unique and non-blank`() {
        val ids = ModelCatalog.providers.map { it.id }
        assertTrue(ids.all { it.isNotBlank() })
        assertEquals(ids.size, ids.toSet().size)
    }

    @Test
    fun `every provider except custom has an https key url and at least one model`() {
        ModelCatalog.providers.filter { it.id != "custom" }.forEach { provider ->
            assertTrue(
                "expected ${provider.id} to have an https apiKeyUrl",
                provider.apiKeyUrl?.startsWith("https://") == true
            )
            assertTrue("expected ${provider.id} to have at least one model", provider.models.isNotEmpty())
            assertTrue(
                "expected ${provider.id}'s defaultModelId to be one of its own models",
                provider.models.any { it.id == provider.defaultModelId }
            )
        }
    }

    @Test
    fun `every model within a provider has a unique id`() {
        ModelCatalog.providers.forEach { provider ->
            val ids = provider.models.map { it.id }
            assertEquals("duplicate model id within ${provider.id}", ids.size, ids.toSet().size)
        }
    }

    @Test
    fun `custom provider has no key url and requires a base url`() {
        val custom = ModelCatalog.providerById("custom")!!
        assertNull(custom.apiKeyUrl)
        assertTrue(custom.requiresBaseUrl)
    }

    @Test
    fun `providerById and modelById return null for unknown ids`() {
        assertNull(ModelCatalog.providerById("does-not-exist"))
        assertNull(ModelCatalog.modelById("anthropic", "does-not-exist"))
        assertNull(ModelCatalog.modelById("does-not-exist", "anything"))
    }

    @Test
    fun `estimateCostUsd matches a known model and falls back for unknown ones`() {
        val known = ModelCatalog.estimateCostUsd("claude-haiku-4-5", 1_000_000, 1_000_000)
        assertEquals(1.0 + 5.0, known!!, 0.0001)

        val unknown = ModelCatalog.estimateCostUsd("some-model-nobody-heard-of", 1_000_000, 1_000_000)
        assertEquals(1.0 + 3.0, unknown!!, 0.0001)

        assertNull(ModelCatalog.estimateCostUsd(null, null, null))
    }

    @Test
    fun `findModelByReportedName matches by substring`() {
        val match = ModelCatalog.findModelByReportedName("claude-haiku-4-5-extra-suffix")
        assertEquals("claude-haiku-4-5", match?.id)
        assertNull(ModelCatalog.findModelByReportedName(null))
        assertNull(ModelCatalog.findModelByReportedName(""))
    }
}
