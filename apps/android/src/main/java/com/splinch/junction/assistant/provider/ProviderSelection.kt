package com.splinch.junction.assistant.provider

data class ProviderSelection(val providerId: String, val modelId: String) {
    fun selectProvider(id: String): ProviderSelection =
        ProviderSelection(id, ModelCatalog.normalizeModelId(id, modelId))

    fun selectModel(id: String): ProviderSelection =
        copy(modelId = ModelCatalog.normalizeModelId(providerId, id))
}

data class ProviderSettingsDraft(
    val providerId: String,
    val modelId: String,
    val frontierModel: String,
    val apiKey: String,
    val baseUrl: String
) {
    fun selectProvider(id: String): ProviderSettingsDraft = copy(
        providerId = id,
        modelId = ModelCatalog.normalizeModelId(id, modelId),
        frontierModel = "",
        apiKey = "",
        baseUrl = ""
    )
}
