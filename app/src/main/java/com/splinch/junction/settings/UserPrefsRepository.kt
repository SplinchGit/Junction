package com.splinch.junction.settings

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.splinch.junction.BuildConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import org.json.JSONObject

private val Context.dataStore by preferencesDataStore(name = "junction_prefs")

class UserPrefsRepository(private val context: Context) {
    private val useHttpBackendKey = booleanPreferencesKey("use_http_backend")
    private val apiBaseUrlKey = stringPreferencesKey("api_base_url")
    private val digestIntervalKey = intPreferencesKey("digest_interval_minutes")

    private val lastOpenedAtKey = longPreferencesKey("last_opened_at")
    private val notificationAccessAckKey = booleanPreferencesKey("notification_access_ack")
    private val notificationListenerEnabledKey = booleanPreferencesKey("notification_listener_enabled")
    private val appWeightsKey = stringPreferencesKey("app_weights_json")
    private val disabledPackagesKey = stringSetPreferencesKey("disabled_packages")

    val useHttpBackendFlow: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[useHttpBackendKey] ?: BuildConfig.JUNCTION_USE_HTTP_BACKEND
    }

    val apiBaseUrlFlow: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[apiBaseUrlKey] ?: BuildConfig.JUNCTION_API_BASE_URL
    }

    val digestIntervalMinutesFlow: Flow<Int> = context.dataStore.data.map { prefs ->
        prefs[digestIntervalKey] ?: 30
    }

    val lastOpenedAtFlow: Flow<Long> = context.dataStore.data.map { prefs ->
        prefs[lastOpenedAtKey] ?: 0L
    }

    val notificationAccessAcknowledgedFlow: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[notificationAccessAckKey] ?: false
    }

    val notificationListenerEnabledFlow: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[notificationListenerEnabledKey] ?: false
    }

    val appWeightsFlow: Flow<Map<String, Int>> = context.dataStore.data.map { prefs ->
        val json = prefs[appWeightsKey].orEmpty()
        parseWeights(json)
    }

    val disabledPackagesFlow: Flow<Set<String>> = context.dataStore.data.map { prefs ->
        prefs[disabledPackagesKey] ?: emptySet()
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

    suspend fun updateLastOpenedAt(timestamp: Long) {
        context.dataStore.edit { it[lastOpenedAtKey] = timestamp }
    }

    suspend fun markOpenedAndGetPrevious(now: Long): Long {
        val previous = lastOpenedAtFlow.first()
        updateLastOpenedAt(now)
        return previous
    }

    suspend fun setNotificationAccessAcknowledged(ack: Boolean) {
        context.dataStore.edit { it[notificationAccessAckKey] = ack }
    }

    suspend fun setNotificationListenerEnabled(enabled: Boolean) {
        context.dataStore.edit { it[notificationListenerEnabledKey] = enabled }
    }

    suspend fun setAppWeight(packageName: String, weight: Int) {
        val current = appWeightsFlow.first().toMutableMap()
        current[packageName] = weight
        context.dataStore.edit { it[appWeightsKey] = toWeightsJson(current) }
    }

    suspend fun setPackageEnabled(packageName: String, enabled: Boolean) {
        val current = disabledPackagesFlow.first().toMutableSet()
        if (enabled) {
            current.remove(packageName)
        } else {
            current.add(packageName)
        }
        context.dataStore.edit { it[disabledPackagesKey] = current }
    }

    suspend fun isPackageEnabled(packageName: String): Boolean {
        val disabled = disabledPackagesFlow.first()
        return !disabled.contains(packageName)
    }

    private fun parseWeights(json: String): Map<String, Int> {
        if (json.isBlank()) return emptyMap()
        return try {
            val obj = JSONObject(json)
            obj.keys().asSequence().associateWith { key -> obj.getInt(key) }
        } catch (_: Exception) {
            emptyMap()
        }
    }

    private fun toWeightsJson(weights: Map<String, Int>): String {
        val obj = JSONObject()
        weights.forEach { (key, value) -> obj.put(key, value) }
        return obj.toString()
    }
}
