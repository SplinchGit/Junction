package com.splinch.junction.chat

import com.splinch.junction.settings.UserPrefsRepository

class BackendProvider(@Suppress("UNUSED_PARAMETER") settingsRepository: UserPrefsRepository) {
    suspend fun getBackend(): ChatBackend = StubBackend()
}

object BackendFactory {
    fun provider(settingsRepository: UserPrefsRepository): BackendProvider {
        return BackendProvider(settingsRepository)
    }
}
