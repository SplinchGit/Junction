package com.splinch.junction.settings

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.splinch.junction.BuildConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "junction_settings")

class SettingsRepository(private val context: Context) {
    private val useHttpBackendKey = booleanPreferencesKey("use_http_backend")
    private val apiBaseUrlKey = stringPreferencesKey("api_base_url")
    private val digestIntervalKey = intPreferencesKey("digest_interval_minutes")

    val useHttpBackendFlow: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[useHttpBackendKey] ?: BuildConfig.JUNCTION_USE_HTTP_BACKEND
    }

    val apiBaseUrlFlow: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[apiBaseUrlKey] ?: BuildConfig.JUNCTION_API_BASE_URL
    }

    val digestIntervalMinutesFlow: Flow<Int> = context.dataStore.data.map { prefs ->
        prefs[digestIntervalKey] ?: 30
    }

    suspend fun setUseHttpBackend(enabled: Boolean) {
        context.dataStore.edit { it[useHttpBackendKey] = enabled }
    }

    suspend fun setApiBaseUrl(baseUrl: String) {
        context.dataStore.edit { it[apiBaseUrlKey] = baseUrl }
    }

    suspend fun setDigestIntervalMinutes(minutes: Int) {
        context.dataStore.edit { it[digestIntervalKey] = minutes }
    }
}
