package com.splinch.junction.assistant.provider

import com.splinch.junction.data.preference.ProviderConfig
import com.splinch.junction.data.preference.UserPrefsRepository
import org.json.JSONObject

/**
 * Owns provider selection, temporary health routing, and frontier-lane state.
 * Provider implementations remain in their existing classes; this object only
 * decides which configured implementation the assistant runtime should use.
 */
class ProviderRouter(
    private val registry: ProviderRegistry,
    private val prefs: UserPrefsRepository
) {
    private var frontierRequestedForNextTurn = false

    suspend fun activeProvider(): LlmProvider? = registry.getActiveProvider()

    fun afterFailure(providerId: String, allowFallback: Boolean): LlmProvider? {
        registry.markUnhealthy(providerId)
        return if (allowFallback) registry.getFallbackProvider(providerId) else null
    }

    fun consumeFrontierRequest(explicitlyRequested: Boolean): Boolean {
        val useFrontier = explicitlyRequested || frontierRequestedForNextTurn
        frontierRequestedForNextTurn = false
        return useFrontier
    }

    fun requestFrontierForNextTurn() {
        frontierRequestedForNextTurn = true
    }

    suspend fun switchProvider(providerId: String, modelId: String = ""): String {
        val resolvedModelId = modelId.ifBlank {
            ModelCatalog.providerById(providerId)?.defaultModelId.orEmpty()
        }
        prefs.setProviderConfig(ProviderConfig(providerId = providerId, modelId = resolvedModelId))
        return switchAnnouncement(providerId, resolvedModelId)
    }

    fun switchAnnouncement(providerId: String, modelId: String): String {
        val provider = ModelCatalog.providerById(providerId)
        val model = provider?.models?.find { it.id == modelId }
            ?: provider?.models?.find { it.id == provider.defaultModelId }
        val providerName = provider?.displayName ?: providerId
        val modelName = model?.displayName ?: "its default model"
        return "Switched to $providerName ($modelName). Every message from here on uses this provider until you switch again."
    }

    fun cleanError(raw: String?): String {
        if (raw == null) return "Unknown error"
        val jsonStart = raw.indexOf('{')
        if (jsonStart == -1) return raw
        return runCatching {
            JSONObject(raw.substring(jsonStart)).optJSONObject("error")?.optString("message")
        }.getOrNull()?.takeIf { it.isNotBlank() } ?: raw
    }
}
