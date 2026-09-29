package com.splinch.junction.assistant.provider

data class ProviderSelection(val providerId: String, val modelId: String) {
    fun selectProvider(id: String): ProviderSelection =
        ProviderSelection(id, ModelCatalog.normalizeModelId(id, modelId))

    fun selectModel(id: String): ProviderSelection =
        copy(modelId = ModelCatalog.normalizeModelId(providerId, id))
}
