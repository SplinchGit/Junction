package com.splinch.junction.chat.provider

/**
 * Display metadata for the setup wizard and Settings' provider picker.
 *
 * This is presentation-only: [defaultWorkhorseModel] is a caption, never written
 * to [com.splinch.junction.settings.ProviderConfig] — leaving that field blank
 * lets ProviderRegistry.buildProvider()'s own `ifBlank { ... }` defaults apply,
 * so there's a single source of truth for actual model names.
 */
data class ProviderCatalogEntry(
    val id: String,
    val displayName: String,
    val recommendationTag: String,
    val recommendationDetail: String,
    val apiKeyUrl: String?,
    val defaultWorkhorseModel: String,
    val requiresBaseUrl: Boolean = false
)

object ProviderCatalog {
    val entries: List<ProviderCatalogEntry> = listOf(
        ProviderCatalogEntry(
            id = "anthropic",
            displayName = "Anthropic",
            recommendationTag = "Recommended",
            recommendationDetail = "Best balance of quality and cost for everyday use.",
            apiKeyUrl = "https://console.anthropic.com/settings/keys",
            defaultWorkhorseModel = "claude-haiku-4-5-20251001"
        ),
        ProviderCatalogEntry(
            id = "openai",
            displayName = "OpenAI",
            recommendationTag = "Most capable",
            recommendationDetail = "Widest tool support and strong reasoning for complex tasks.",
            apiKeyUrl = "https://platform.openai.com/api-keys",
            defaultWorkhorseModel = "gpt-4.1-mini"
        ),
        ProviderCatalogEntry(
            id = "deepseek",
            displayName = "DeepSeek",
            recommendationTag = "Cheapest",
            recommendationDetail = "Lowest cost per token — good for high-volume use.",
            apiKeyUrl = "https://platform.deepseek.com/api_keys",
            defaultWorkhorseModel = "deepseek-chat"
        ),
        ProviderCatalogEntry(
            id = "custom",
            displayName = "Custom",
            recommendationTag = "Advanced",
            recommendationDetail = "Point at any OpenAI-compatible endpoint you run or trust.",
            apiKeyUrl = null,
            defaultWorkhorseModel = "gpt-4.1-mini",
            requiresBaseUrl = true
        )
    )

    fun byId(id: String): ProviderCatalogEntry? = entries.find { it.id == id }
}
