package com.splinch.junction.chat

import com.splinch.junction.settings.SettingsRepository
import kotlinx.coroutines.flow.first

class BackendProvider(private val settingsRepository: SettingsRepository) {
    suspend fun getBackend(): ChatBackend {
        val useBackend = settingsRepository.useHttpBackendFlow.first()
        val baseUrl = settingsRepository.apiBaseUrlFlow.first()
        return if (useBackend && baseUrl.isNotBlank()) {
            HttpBackend(baseUrl)
        } else {
            StubBackend()
        }
    }
}

object BackendFactory {
    fun provider(settingsRepository: SettingsRepository): BackendProvider {
        return BackendProvider(settingsRepository)
    }
}
