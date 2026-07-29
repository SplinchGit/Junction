package com.splinch.junction.chat.provider

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ProviderCatalogTest {

    @Test
    fun `ids are unique and non-blank`() {
        val ids = ProviderCatalog.entries.map { it.id }
        assertTrue(ids.all { it.isNotBlank() })
        assertEquals(ids.size, ids.toSet().size)
    }

    @Test
    fun `every non-custom entry has an https key url`() {
        ProviderCatalog.entries.filter { it.id != "custom" }.forEach { entry ->
            assertTrue(
                "expected ${entry.id} to have an https apiKeyUrl",
                entry.apiKeyUrl?.startsWith("https://") == true
            )
        }
    }

    @Test
    fun `custom entry has no key url and requires a base url`() {
        val custom = ProviderCatalog.byId("custom")!!
        assertEquals(null, custom.apiKeyUrl)
        assertTrue(custom.requiresBaseUrl)
    }

    @Test
    fun `byId returns null for unknown provider`() {
        assertEquals(null, ProviderCatalog.byId("does-not-exist"))
    }
}
