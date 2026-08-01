package com.splinch.junction.data.preference

data class ProviderConfig(
    val providerId: String = "anthropic",   // see ModelCatalog.providers for the full list
    val apiKey: String = "",
    val modelId: String = "",              // selected from ModelCatalog.providerById(providerId).models; blank = provider default
    val workhorseModel: String = "",       // legacy free-text override, still honored if modelId is blank (custom provider path)
    val frontierModel: String = "",
    val baseUrl: String = ""               // for custom OpenAI-compatible endpoints
)
