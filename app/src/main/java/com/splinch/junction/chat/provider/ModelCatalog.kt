package com.splinch.junction.chat.provider

/**
 * Single source of truth for every provider and model Junction knows about —
 * display metadata (wizard/Settings pickers), routing (base URL), and cost
 * estimation all read from here instead of being scattered across
 * ProviderRegistry's per-provider `when` branches, provider class defaults,
 * and a separate substring-matched pricing table.
 */
data class ModelEntry(
    val id: String,
    val displayName: String,
    val costTier: String,
    val blurb: String,
    val inputPerMillionUsd: Double,
    val outputPerMillionUsd: Double,
    val supportsVision: Boolean = false,
    /**
     * True for Anthropic models on the adaptive-thinking API surface (Claude 4.6
     * and later). Those models think by default and count thinking against
     * max_tokens, so requests need extra output headroom; older ones reject the
     * `thinking: {type: "adaptive"}` / `output_config.effort` fields outright,
     * which is why this can't just be assumed.
     */
    val supportsAdaptiveThinking: Boolean = false
)

data class ProviderDefinition(
    val id: String,
    val displayName: String,
    val recommendationTag: String,
    val recommendationDetail: String,
    val apiKeyUrl: String?,
    val baseUrl: String,
    val requiresBaseUrl: Boolean = false,
    val models: List<ModelEntry> = emptyList(),
    val defaultModelId: String = ""
)

object ModelCatalog {
    val providers: List<ProviderDefinition> = listOf(
        ProviderDefinition(
            id = "anthropic",
            displayName = "Anthropic",
            recommendationTag = "Recommended",
            recommendationDetail = "Best balance of quality and cost for everyday use.",
            apiKeyUrl = "https://console.anthropic.com/settings/keys",
            baseUrl = "https://api.anthropic.com/v1",
            defaultModelId = "claude-sonnet-5",
            models = listOf(
                ModelEntry("claude-haiku-4-5", "Claude Haiku 4.5", "$ Cheap", "Fastest and cheapest Claude — good for quick voice replies.", 1.0, 5.0, supportsVision = true),
                ModelEntry("claude-sonnet-5", "Claude Sonnet 5", "$$ Balanced", "Near-flagship quality at Sonnet cost — the best everyday default.", 3.0, 15.0, supportsVision = true, supportsAdaptiveThinking = true),
                ModelEntry("claude-opus-5", "Claude Opus 5", "$$$ Most capable", "Anthropic's flagship — deep reasoning and long agentic work.", 5.0, 25.0, supportsVision = true, supportsAdaptiveThinking = true)
            )
        ),
        ProviderDefinition(
            id = "openai",
            displayName = "OpenAI",
            recommendationTag = "Most capable",
            recommendationDetail = "Widest tool support and strong reasoning for complex tasks.",
            apiKeyUrl = "https://platform.openai.com/api-keys",
            baseUrl = "https://api.openai.com/v1",
            defaultModelId = "gpt-4.1-mini",
            models = listOf(
                ModelEntry("gpt-4.1-mini", "GPT-4.1 Mini", "$ Cheap", "Fast, inexpensive, good default.", 0.40, 1.60, supportsVision = true),
                ModelEntry("gpt-4.1", "GPT-4.1", "$$ Balanced", "More capable than Mini, still efficient.", 2.0, 8.0, supportsVision = true),
                ModelEntry("gpt-4o", "GPT-4o", "$$ Balanced", "Multimodal flagship, strong all-rounder.", 2.5, 10.0, supportsVision = true)
            )
        ),
        ProviderDefinition(
            id = "deepseek",
            displayName = "DeepSeek",
            recommendationTag = "Cheapest",
            recommendationDetail = "Lowest cost per token — good for high-volume use.",
            apiKeyUrl = "https://platform.deepseek.com/api_keys",
            baseUrl = "https://api.deepseek.com/v1",
            defaultModelId = "deepseek-chat",
            models = listOf(
                ModelEntry("deepseek-chat", "DeepSeek Chat", "$ Cheapest", "Lowest cost per token — great for high-volume use.", 0.27, 1.10),
                ModelEntry("deepseek-reasoner", "DeepSeek Reasoner", "$ Cheap", "Chain-of-thought reasoning, still inexpensive.", 0.55, 2.19)
            )
        ),
        ProviderDefinition(
            id = "mistral",
            displayName = "Mistral",
            recommendationTag = "Efficient",
            recommendationDetail = "Strong open-weight models at a competitive price.",
            apiKeyUrl = "https://console.mistral.ai/api-keys",
            baseUrl = "https://api.mistral.ai/v1",
            defaultModelId = "mistral-small-latest",
            models = listOf(
                ModelEntry("mistral-small-latest", "Mistral Small", "$ Cheap", "Efficient default for everyday tasks.", 0.20, 0.60),
                ModelEntry("mistral-large-latest", "Mistral Large", "$$ Balanced", "Mistral's flagship reasoning model.", 2.0, 6.0)
            )
        ),
        ProviderDefinition(
            id = "groq",
            displayName = "Groq",
            recommendationTag = "Fastest",
            recommendationDetail = "Open models served on Groq's hardware — extremely low latency.",
            apiKeyUrl = "https://console.groq.com/keys",
            baseUrl = "https://api.groq.com/openai/v1",
            defaultModelId = "llama-3.1-8b-instant",
            models = listOf(
                ModelEntry("llama-3.1-8b-instant", "Llama 3.1 8B (Instant)", "$ Cheapest", "Extremely fast — near-instant responses.", 0.05, 0.08),
                ModelEntry("llama-3.3-70b-versatile", "Llama 3.3 70B", "$ Cheap", "Bigger open model, still fast on Groq's hardware.", 0.59, 0.79)
            )
        ),
        ProviderDefinition(
            id = "xai",
            displayName = "xAI",
            recommendationTag = "Frontier",
            recommendationDetail = "Grok models from xAI.",
            apiKeyUrl = "https://console.x.ai",
            baseUrl = "https://api.x.ai/v1",
            defaultModelId = "grok-4-fast",
            models = listOf(
                ModelEntry("grok-4-fast", "Grok 4 Fast", "$ Cheap", "xAI's fast, inexpensive default.", 0.20, 0.50, supportsVision = true),
                ModelEntry("grok-4", "Grok 4", "$$$ Most capable", "xAI's flagship reasoning model.", 3.0, 15.0, supportsVision = true)
            )
        ),
        ProviderDefinition(
            id = "gemini",
            displayName = "Google Gemini",
            recommendationTag = "Long context",
            recommendationDetail = "Google's Gemini models via their OpenAI-compatible endpoint.",
            apiKeyUrl = "https://aistudio.google.com/apikey",
            baseUrl = "https://generativelanguage.googleapis.com/v1beta/openai",
            defaultModelId = "gemini-2.5-flash",
            models = listOf(
                ModelEntry("gemini-2.5-flash", "Gemini 2.5 Flash", "$ Cheap", "Google's fast, low-cost default.", 0.15, 0.60, supportsVision = true),
                ModelEntry("gemini-2.5-pro", "Gemini 2.5 Pro", "$$ Balanced", "Google's most capable model, strong at long context.", 1.25, 5.0, supportsVision = true)
            )
        ),
        ProviderDefinition(
            id = "openrouter",
            displayName = "OpenRouter",
            recommendationTag = "Most choice",
            recommendationDetail = "One key, many underlying models — including Claude, without a separate Anthropic account.",
            apiKeyUrl = "https://openrouter.ai/keys",
            baseUrl = "https://openrouter.ai/api/v1",
            defaultModelId = "openrouter/auto",
            // Prices are OpenRouter's published per-million rates (verified against
            // its /v1/models endpoint), so the spend estimate stays honest whichever
            // underlying model the owner picks.
            models = listOf(
                ModelEntry("openrouter/auto", "Auto (best match)", "$$ Varies", "Lets OpenRouter pick the best available model for your prompt.", 1.0, 3.0, supportsVision = true),
                ModelEntry("anthropic/claude-sonnet-5", "Claude Sonnet 5", "$$ Balanced", "Strong all-rounder — the best balance of quality and cost for everyday use.", 2.0, 10.0, supportsVision = true),
                ModelEntry("anthropic/claude-opus-5", "Claude Opus 5", "$$$ Most capable", "Anthropic's flagship — best for hard reasoning and long agentic tasks.", 5.0, 25.0, supportsVision = true),
                ModelEntry("anthropic/claude-haiku-4.5", "Claude Haiku 4.5", "$ Cheap", "Fast and inexpensive Claude — good for quick voice replies.", 1.0, 5.0, supportsVision = true),
                ModelEntry("openai/gpt-5.6-terra", "GPT-5.6 Terra", "$$ Balanced", "OpenAI's current flagship, via your OpenRouter key — no separate OpenAI billing.", 1.25, 7.50, supportsVision = true)
            )
        ),
        ProviderDefinition(
            id = "custom",
            displayName = "Custom",
            recommendationTag = "Advanced",
            recommendationDetail = "Point at any OpenAI-compatible endpoint you run or trust.",
            apiKeyUrl = null,
            baseUrl = "",
            requiresBaseUrl = true
        )
    )

    fun providerById(id: String): ProviderDefinition? = providers.find { it.id == id }

    fun modelById(providerId: String, modelId: String): ModelEntry? =
        providerById(providerId)?.models?.find { it.id == modelId }

    /**
     * Best-effort match by reported model string, for cost estimation when the
     * value came back from the API (e.g. a custom/free-text model) rather than
     * being selected from this catalog directly.
     */
    fun findModelByReportedName(reported: String?): ModelEntry? {
        if (reported.isNullOrBlank()) return null
        val lower = reported.lowercase()
        providers.forEach { provider ->
            provider.models.forEach { model ->
                if (lower == model.id.lowercase() || lower.contains(model.id.lowercase())) return model
            }
        }
        return null
    }

    // Conservative blended rate for a reported model this catalog doesn't recognise
    // (e.g. a custom/free-text endpoint) -- an estimate for the owner's own budgeting,
    // never a billing-accurate figure.
    private val fallbackInputPerMillionUsd = 1.0
    private val fallbackOutputPerMillionUsd = 3.0

    fun estimateCostUsd(model: String?, tokensIn: Int?, tokensOut: Int?): Double? {
        if (tokensIn == null && tokensOut == null) return null
        val entry = findModelByReportedName(model)
        val inputRate = (entry?.inputPerMillionUsd ?: fallbackInputPerMillionUsd) / 1_000_000
        val outputRate = (entry?.outputPerMillionUsd ?: fallbackOutputPerMillionUsd) / 1_000_000
        return (tokensIn ?: 0) * inputRate + (tokensOut ?: 0) * outputRate
    }
}
