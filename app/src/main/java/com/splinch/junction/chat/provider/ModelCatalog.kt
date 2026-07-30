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
                ModelEntry("claude-opus-4-8", "Claude Opus 4.8", "$$$ Most capable", "Highly autonomous, strong on long agentic work and knowledge tasks.", 5.0, 25.0, supportsVision = true, supportsAdaptiveThinking = true),
                ModelEntry("claude-opus-5", "Claude Opus 5", "$$$ Most capable", "Deep reasoning and long-horizon agentic work, same price as 4.8.", 5.0, 25.0, supportsVision = true, supportsAdaptiveThinking = true),
                ModelEntry("claude-fable-5", "Claude Fable 5", "$$$$ Frontier", "Anthropic's most capable model. Thinking is always on, so replies take longer.", 10.0, 50.0, supportsVision = true, supportsAdaptiveThinking = true)
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

                // Anthropic
                ModelEntry("anthropic/claude-sonnet-5", "Claude Sonnet 5", "$$ Balanced", "Near-flagship quality at Sonnet cost — a strong everyday default.", 2.0, 10.0, supportsVision = true),
                ModelEntry("anthropic/claude-opus-4.8", "Claude Opus 4.8", "$$$ Most capable", "Highly autonomous, strong on long agentic work and knowledge tasks.", 5.0, 25.0, supportsVision = true),
                ModelEntry("anthropic/claude-opus-5", "Claude Opus 5", "$$$ Most capable", "Deep reasoning and long-horizon agentic work, same price as 4.8.", 5.0, 25.0, supportsVision = true),
                ModelEntry("anthropic/claude-fable-5", "Claude Fable 5", "$$$$ Frontier", "Anthropic's most capable model, for the hardest reasoning. Priciest option.", 10.0, 50.0, supportsVision = true),
                ModelEntry("anthropic/claude-haiku-4.5", "Claude Haiku 4.5", "$ Cheap", "Fast and inexpensive Claude — good for quick voice replies.", 1.0, 5.0, supportsVision = true),

                // OpenAI
                ModelEntry("openai/gpt-5.6-terra", "GPT-5.6 Terra", "$$ Balanced", "OpenAI's current flagship, no separate OpenAI billing needed.", 1.25, 7.50, supportsVision = true),
                ModelEntry("openai/gpt-5.4-mini", "GPT-5.4 Mini", "$ Cheap", "Small, fast OpenAI model for routine turns.", 0.25, 2.0, supportsVision = true),

                // Google
                ModelEntry("google/gemini-3.1-pro-preview", "Gemini 3.1 Pro", "$$ Balanced", "Google's flagship — 1M context, handles audio and video as well as images.", 2.0, 12.0, supportsVision = true),
                ModelEntry("google/gemini-2.5-flash", "Gemini 2.5 Flash", "$ Cheap", "Google's fast, low-cost workhorse.", 0.15, 0.60, supportsVision = true),

                // xAI
                ModelEntry("x-ai/grok-4.5", "Grok 4.5", "$$ Balanced", "xAI's flagship, 500K context.", 2.0, 6.0, supportsVision = true),
                ModelEntry("x-ai/grok-4.20", "Grok 4.20", "$$ Balanced", "Enormous 2M-token context — good for very long material.", 1.25, 2.50, supportsVision = true),

                // DeepSeek
                ModelEntry("deepseek/deepseek-v4-pro", "DeepSeek V4 Pro", "$ Cheap", "Very cheap for a 1M-context model.", 0.43, 0.87),
                ModelEntry("deepseek/deepseek-r1", "DeepSeek R1", "$ Cheap", "Reasoning-focused and still inexpensive.", 0.70, 2.50),

                // Mistral
                ModelEntry("mistralai/mistral-medium-3-5", "Mistral Medium 3.5", "$$ Balanced", "Mistral's current flagship.", 1.50, 7.50, supportsVision = true),

                // Meta
                ModelEntry("meta-llama/llama-4-maverick", "Llama 4 Maverick", "$ Cheap", "Strong open-weight model, 1M context, very cheap.", 0.20, 0.80, supportsVision = true),

                // Others worth having
                ModelEntry("moonshotai/kimi-k3", "Kimi K3", "$$ Balanced", "Moonshot's flagship, 1M context.", 3.0, 15.0, supportsVision = true),
                ModelEntry("qwen/qwen3.7-max", "Qwen 3.7 Max", "$$ Balanced", "Alibaba's flagship, 1M context.", 1.48, 4.42)
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
