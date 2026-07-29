package com.splinch.junction.settings

data class ProviderConfig(
    val providerId: String = "anthropic",   // "anthropic", "openai", "deepseek", or custom
    val apiKey: String = "",
    val workhorseModel: String = "",
    val frontierModel: String = "",
    val baseUrl: String = ""               // for custom OpenAI-compatible endpoints
)
