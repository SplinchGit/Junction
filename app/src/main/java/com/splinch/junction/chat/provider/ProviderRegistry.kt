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
        return buildProvider(config)
    }

    suspend fun getWorkhorseProvider(): LlmProvider? = getActiveProvider()

    suspend fun getFrontierProvider(): LlmProvider? {
        val config = prefs.providerConfigFlow.first()
        val base = buildProvider(config) ?: return null
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
     */
    fun getFallbackProvider(excludeId: String): LlmProvider? {
        val candidates = listOf("anthropic", "openai", "deepseek")
            .filter { it != excludeId && isHealthy(it) }
        for (candidateId in candidates) {
            val apiKey = keyStorage.getApiKey(candidateId)
            if (apiKey.isBlank()) continue
            android.util.Log.i("ProviderRegistry", "Falling back to provider '$candidateId'")
            return buildProviderById(candidateId, apiKey)
        }
        return null
    }

    private fun buildProviderById(providerId: String, apiKey: String): LlmProvider = when (providerId) {
        "anthropic" -> AnthropicProvider(id = "anthropic", apiKey = apiKey)
        "openai" -> OpenAiCompatibleProvider(
            id = "openai",
            apiKey = apiKey,
            workhorseModel = "gpt-4.1-mini",
            baseUrl = "https://api.openai.com/v1"
        )
        "deepseek" -> OpenAiCompatibleProvider(
            id = "deepseek",
            apiKey = apiKey,
            workhorseModel = "deepseek-chat",
            baseUrl = "https://api.deepseek.com/v1"
        )
        else -> OpenAiCompatibleProvider(id = providerId, apiKey = apiKey, workhorseModel = "gpt-4.1-mini")
    }

    private fun buildProvider(config: ProviderConfig): LlmProvider? {
        val apiKey = keyStorage.getApiKey(config.providerId)
        if (apiKey.isBlank()) return null
        return when (config.providerId) {
            "anthropic" -> AnthropicProvider(
                id = "anthropic",
                apiKey = apiKey,
                workhorseModel = config.workhorseModel.ifBlank { "claude-haiku-4-5-20251001" },
                frontierModel = config.frontierModel.ifBlank { null } ?: "claude-sonnet-4-6"
            )
            "openai" -> OpenAiCompatibleProvider(
                id = "openai",
                apiKey = apiKey,
                workhorseModel = config.workhorseModel.ifBlank { "gpt-4.1-mini" },
                frontierModel = config.frontierModel.ifBlank { null },
                baseUrl = "https://api.openai.com/v1"
            )
            "deepseek" -> OpenAiCompatibleProvider(
                id = "deepseek",
                apiKey = apiKey,
                workhorseModel = config.workhorseModel.ifBlank { "deepseek-chat" },
                frontierModel = config.frontierModel.ifBlank { null },
                baseUrl = "https://api.deepseek.com/v1"
            )
            else -> OpenAiCompatibleProvider(
                id = config.providerId,
                apiKey = apiKey,
                workhorseModel = config.workhorseModel.ifBlank { "gpt-4.1-mini" },
                frontierModel = config.frontierModel.ifBlank { null },
                baseUrl = config.baseUrl.ifBlank { "https://api.openai.com/v1" }
            )
        }
    }
}
