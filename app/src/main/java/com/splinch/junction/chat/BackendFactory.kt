package com.splinch.junction.chat

import com.splinch.junction.settings.UserPrefsRepository
import kotlinx.coroutines.flow.first

class BackendProvider(private val settingsRepository: UserPrefsRepository) {
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
    fun provider(settingsRepository: UserPrefsRepository): BackendProvider {
        return BackendProvider(settingsRepository)
    }
}
