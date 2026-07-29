package com.splinch.junction.chat.provider

import android.content.Context
import com.splinch.junction.settings.KeyStorage
import com.splinch.junction.settings.ProviderConfig
import com.splinch.junction.settings.UserPrefsRepository
import kotlinx.coroutines.flow.first
import java.util.concurrent.ConcurrentHashMap

class ProviderRegistry(
    private val context: Context,
    private val prefs: UserPrefsRepository,
    private val keyStorage: KeyStorage = KeyStorage(context)
) {
    // Health tracking: providerIds that are temporarily deprioritised
    private val deprioritised = ConcurrentHashMap<String, Long>()

    suspend fun getActiveProvider(): LlmProvider? {
        val config = prefs.providerConfigFlow.first()
        val apiKey = keyStorage.getApiKey(config.providerId)
        if (apiKey.isBlank()) return null
        return buildProvider(config, apiKey)
    }

    suspend fun getWorkhorseProvider(): LlmProvider? = getActiveProvider()

    suspend fun getFrontierProvider(): LlmProvider? {
        val base = getActiveProvider() ?: return null
        return if (base.frontierModel != null) base else null
    }

    fun markUnhealthy(providerId: String) {
        deprioritised[providerId] = System.currentTimeMillis() + 60_000L
        android.util.Log.w("ProviderRegistry", "Deprioritising provider '$providerId' for 60s")
    }

    fun isHealthy(providerId: String): Boolean {
        val until = deprioritised[providerId] ?: return true
        return System.currentTimeMillis() > until
    }

    /**
     * §1.1 health-aware fallback: tries other providers the owner has already
     * stored a key for, skipping [excludeId] and anything still deprioritised.
     * "custom" is never a fallback target -- there's no sensible default base
     * URL to guess for an arbitrary endpoint.
     */
    fun getFallbackProvider(excludeId: String): LlmProvider? {
        val candidates = ModelCatalog.providers
            .map { it.id }
            .filter { it != excludeId && it != "custom" && isHealthy(it) }
        for (candidateId in candidates) {
            val apiKey = keyStorage.getApiKey(candidateId)
            if (apiKey.isBlank()) continue
            android.util.Log.i("ProviderRegistry", "Falling back to provider '$candidateId'")
            return buildProvider(ProviderConfig(providerId = candidateId), apiKey)
        }
        return null
    }

    /**
     * The single place that turns a provider id + stored key into a real
     * [LlmProvider]. Anthropic's Messages API has a genuinely different wire
     * shape (system prompt as a top-level field, SSE event names, auth header)
     * so it gets its own class; every other provider -- including "custom" --
     * speaks the OpenAI Chat Completions shape and only differs by base URL
     * and model name, both of which [ModelCatalog] already knows.
     */
    private fun buildProvider(config: ProviderConfig, apiKey: String): LlmProvider {
        val providerDef = ModelCatalog.providerById(config.providerId)
        val modelId = config.modelId.ifBlank { config.workhorseModel }
            .ifBlank { providerDef?.defaultModelId.orEmpty() }
        val frontierId = config.frontierModel.ifBlank { null }

        if (config.providerId == "anthropic") {
            return AnthropicProvider(
                apiKey = apiKey,
                workhorseModel = modelId.ifBlank { "claude-haiku-4-5-20251001" },
                frontierModel = frontierId ?: "claude-sonnet-4-6"
            )
        }

        val baseUrl = if (config.providerId == "custom") {
            config.baseUrl.ifBlank { "https://api.openai.com/v1" }
        } else {
            providerDef?.baseUrl?.ifBlank { null } ?: config.baseUrl.ifBlank { "https://api.openai.com/v1" }
        }

        return OpenAiCompatibleProvider(
            id = config.providerId,
            apiKey = apiKey,
            workhorseModel = modelId.ifBlank { "gpt-4.1-mini" },
            frontierModel = frontierId,
            baseUrl = baseUrl
        )
    }
}
