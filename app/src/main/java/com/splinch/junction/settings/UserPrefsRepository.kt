package com.splinch.junction.settings

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.splinch.junction.core.Config
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import org.json.JSONObject

private val Context.dataStore by preferencesDataStore(name = "junction_prefs")

class UserPrefsRepository(private val context: Context) {
    private val useHttpBackendKey = booleanPreferencesKey("use_http_backend")
    private val apiBaseUrlKey = stringPreferencesKey("api_base_url")
    private val chatModelKey = stringPreferencesKey("chat_model")
    private val chatApiKeyKey = stringPreferencesKey("chat_api_key")
    private val digestIntervalKey = intPreferencesKey("digest_interval_minutes")
    private val realtimeEndpointKey = stringPreferencesKey("realtime_endpoint")
    private val realtimeClientSecretEndpointKey = stringPreferencesKey("realtime_client_secret_endpoint")
    private val webClientIdOverrideKey = stringPreferencesKey("web_client_id_override")

    private val lastOpenedAtKey = longPreferencesKey("last_opened_at")
    private val lastUpdateCheckAtKey = longPreferencesKey("last_update_check_at")
    private val notificationAccessAckKey = booleanPreferencesKey("notification_access_ack")
    private val notificationListenerEnabledKey = booleanPreferencesKey("notification_listener_enabled")
    private val junctionOnlyNotificationsKey = booleanPreferencesKey("junction_only_notifications")
    private val lastDigestAtKey = longPreferencesKey("last_digest_at")
    private val lastDigestSummaryKey = stringPreferencesKey("last_digest_summary")
    private val appWeightsKey = stringPreferencesKey("app_weights_json")
    private val disabledPackagesKey = stringSetPreferencesKey("disabled_packages")
    private val connectedIntegrationsKey = stringSetPreferencesKey("connected_integrations")
    private val mafiosoEnabledKey = booleanPreferencesKey("mafioso_game_enabled")

    val useHttpBackendFlow: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[useHttpBackendKey] ?: false
    }

    val apiBaseUrlFlow: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[apiBaseUrlKey] ?: Config.buildApiBaseUrl
    }

    val chatModelFlow: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[chatModelKey] ?: Config.buildChatModel
    }

    val chatApiKeyFlow: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[chatApiKeyKey] ?: ""
    }

    val digestIntervalMinutesFlow: Flow<Int> = context.dataStore.data.map { prefs ->
        prefs[digestIntervalKey] ?: 30
    }

    val realtimeEndpointFlow: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[realtimeEndpointKey] ?: Config.buildRealtimeEndpoint
    }

    val realtimeClientSecretEndpointFlow: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[realtimeClientSecretEndpointKey] ?: Config.buildRealtimeClientSecretEndpoint
    }

    val webClientIdOverrideFlow: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[webClientIdOverrideKey] ?: ""
    }

    val lastOpenedAtFlow: Flow<Long> = context.dataStore.data.map { prefs ->
        prefs[lastOpenedAtKey] ?: 0L
    }

    val lastUpdateCheckAtFlow: Flow<Long> = context.dataStore.data.map { prefs ->
        prefs[lastUpdateCheckAtKey] ?: 0L
    }

    val notificationAccessAcknowledgedFlow: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[notificationAccessAckKey] ?: false
    }

    val notificationListenerEnabledFlow: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[notificationListenerEnabledKey] ?: false
    }

    val junctionOnlyNotificationsFlow: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[junctionOnlyNotificationsKey] ?: false
    }

    val lastDigestAtFlow: Flow<Long> = context.dataStore.data.map { prefs ->
        prefs[lastDigestAtKey] ?: 0L
    }

    val lastDigestSummaryFlow: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[lastDigestSummaryKey] ?: ""
    }

    @Suppress("unused")
    val appWeightsFlow: Flow<Map<String, Int>> = context.dataStore.data.map { prefs ->
        val json = prefs[appWeightsKey].orEmpty()
        parseWeights(json)
    }

    val disabledPackagesFlow: Flow<Set<String>> = context.dataStore.data.map { prefs ->
        prefs[disabledPackagesKey] ?: emptySet()
    }

    val connectedIntegrationsFlow: Flow<Set<String>> = context.dataStore.data.map { prefs ->
        prefs[connectedIntegrationsKey] ?: emptySet()
    }

    val mafiosoGameEnabledFlow: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[mafiosoEnabledKey] ?: false
    }

    val snapshotFlow: Flow<PrefsSnapshot> = context.dataStore.data.map { prefs ->
        PrefsSnapshot(
            lastOpenedAt = prefs[lastOpenedAtKey] ?: 0L,
            digestIntervalMinutes = prefs[digestIntervalKey] ?: 30,
            notificationAccessAcknowledged = prefs[notificationAccessAckKey] ?: false,
            notificationListenerEnabled = prefs[notificationListenerEnabledKey] ?: false,
            appWeights = parseWeights(prefs[appWeightsKey].orEmpty()),
            disabledPackages = prefs[disabledPackagesKey] ?: emptySet(),
            lastUpdateCheckAt = prefs[lastUpdateCheckAtKey] ?: 0L,
            realtimeClientSecretEndpoint = prefs[realtimeClientSecretEndpointKey].orEmpty(),
            chatModel = prefs[chatModelKey] ?: Config.buildChatModel,
            connectedIntegrations = prefs[connectedIntegrationsKey] ?: emptySet(),
            mafiosoGameEnabled = prefs[mafiosoEnabledKey] ?: false
        )
    }

    suspend fun setUseHttpBackend(enabled: Boolean) {
        context.dataStore.edit { it[useHttpBackendKey] = enabled }
    }

    suspend fun setApiBaseUrl(baseUrl: String) {
        context.dataStore.edit { it[apiBaseUrlKey] = baseUrl }
    }

    suspend fun setChatModel(model: String) {
        context.dataStore.edit { it[chatModelKey] = model }
    }

    suspend fun setChatApiKey(key: String) {
        context.dataStore.edit { it[chatApiKeyKey] = key }
    }

    suspend fun setDigestIntervalMinutes(minutes: Int) {
        context.dataStore.edit { it[digestIntervalKey] = minutes }
    }

    suspend fun setRealtimeEndpoint(url: String) {
        context.dataStore.edit { it[realtimeEndpointKey] = url }
    }

    suspend fun setRealtimeClientSecretEndpoint(url: String) {
        context.dataStore.edit { it[realtimeClientSecretEndpointKey] = url }
    }

    suspend fun setWebClientIdOverride(value: String) {
        context.dataStore.edit { it[webClientIdOverrideKey] = value }
    }

    suspend fun setIntegrationConnected(provider: String, connected: Boolean) {
        val current = connectedIntegrationsFlow.first().toMutableSet()
        if (connected) {
            current.add(provider)
        } else {
            current.remove(provider)
        }
        context.dataStore.edit { it[connectedIntegrationsKey] = current }
    }

    suspend fun setMafiosoGameEnabled(enabled: Boolean) {
        context.dataStore.edit { it[mafiosoEnabledKey] = enabled }
    }

    suspend fun updateLastOpenedAt(timestamp: Long) {
        context.dataStore.edit { it[lastOpenedAtKey] = timestamp }
    }

    suspend fun updateLastUpdateCheckAt(timestamp: Long) {
        context.dataStore.edit { it[lastUpdateCheckAtKey] = timestamp }
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

    suspend fun updateDigest(summary: String, timestamp: Long) {
        context.dataStore.edit {
            it[lastDigestSummaryKey] = summary
            it[lastDigestAtKey] = timestamp
        }
    }

    suspend fun setJunctionOnlyNotifications(enabled: Boolean) {
        context.dataStore.edit { it[junctionOnlyNotificationsKey] = enabled }
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

    suspend fun applySnapshot(snapshot: PrefsSnapshot) {
        context.dataStore.edit { prefs ->
            prefs[lastOpenedAtKey] = snapshot.lastOpenedAt
            prefs[digestIntervalKey] = snapshot.digestIntervalMinutes
            prefs[notificationAccessAckKey] = snapshot.notificationAccessAcknowledged
            prefs[notificationListenerEnabledKey] = snapshot.notificationListenerEnabled
            prefs[appWeightsKey] = toWeightsJson(snapshot.appWeights)
            prefs[disabledPackagesKey] = snapshot.disabledPackages
            prefs[lastUpdateCheckAtKey] = snapshot.lastUpdateCheckAt
            prefs[realtimeClientSecretEndpointKey] = snapshot.realtimeClientSecretEndpoint
            prefs[chatModelKey] = snapshot.chatModel
            prefs[connectedIntegrationsKey] = snapshot.connectedIntegrations
            prefs[mafiosoEnabledKey] = snapshot.mafiosoGameEnabled
        }
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

data class PrefsSnapshot(
    val lastOpenedAt: Long,
    val digestIntervalMinutes: Int,
    val notificationAccessAcknowledged: Boolean,
    val notificationListenerEnabled: Boolean,
    val appWeights: Map<String, Int>,
    val disabledPackages: Set<String>,
    val lastUpdateCheckAt: Long,
    val realtimeClientSecretEndpoint: String,
    val chatModel: String,
    val connectedIntegrations: Set<String>,
    val mafiosoGameEnabled: Boolean
)
