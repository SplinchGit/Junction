package com.splinch.junction.data.preference

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.splinch.junction.app.config.AppConfig
import com.splinch.junction.feature.scheduler.DigestQuietHours
import com.splinch.junction.feature.scheduler.DigestProfile
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import org.json.JSONObject

private val Context.dataStore by preferencesDataStore(name = "junction_prefs")

class UserPrefsRepository(private val context: Context) {
    private val chatModelKey = stringPreferencesKey("chat_model")
    private val chatApiKeyKey = stringPreferencesKey("chat_api_key")
    private val digestIntervalKey = intPreferencesKey("digest_interval_minutes")
    private val digestEnabledKey = booleanPreferencesKey("digest_enabled")
    private val digestQuietHoursEnabledKey = booleanPreferencesKey("digest_quiet_hours_enabled")
    private val digestQuietHoursStartKey = intPreferencesKey("digest_quiet_hours_start")
    private val digestQuietHoursEndKey = intPreferencesKey("digest_quiet_hours_end")
    private val digestProfileKey = stringPreferencesKey("digest_profile")
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
    private val firebaseSyncEnabledKey = booleanPreferencesKey("firebase_sync_enabled")
    private val shizukuEnabledKey = booleanPreferencesKey("shizuku_enabled")
    private val providerIdKey = stringPreferencesKey("provider_id")
    private val providerModelIdKey = stringPreferencesKey("provider_model_id")
    private val providerWorkhorseModelKey = stringPreferencesKey("provider_workhorse_model")
    private val providerFrontierModelKey = stringPreferencesKey("provider_frontier_model")
    private val providerBaseUrlKey = stringPreferencesKey("provider_base_url")
    private val gmailAccountEmailKey = stringPreferencesKey("gmail_account_email")
    private val allowedWebDomainsKey = stringSetPreferencesKey("allowed_web_domains")
    private val alwaysAllowedToolsKey = stringSetPreferencesKey("always_allowed_tools")
    private val voiceBackendKey = stringPreferencesKey("voice_backend")
    private val onboardingCompletedKey = booleanPreferencesKey("onboarding_completed")

    val firebaseSyncEnabledFlow: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[firebaseSyncEnabledKey] ?: false
    }

    /** Explicit owner opt-in before Junction can request or use Shizuku permission. */
    val shizukuEnabledFlow: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[shizukuEnabledKey] ?: false
    }

    /** Whether the first-run provider setup wizard has been completed (or skipped). */
    val onboardingCompletedFlow: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[onboardingCompletedKey] ?: false
    }

    /** Provider config (without API key — that lives in KeyStorage). */
    val providerConfigFlow: Flow<ProviderConfig> = context.dataStore.data.map { prefs ->
        ProviderConfig(
            providerId = prefs[providerIdKey] ?: "anthropic",
            apiKey = "",  // API key is stored in KeyStorage, not here
            modelId = prefs[providerModelIdKey] ?: "",
            workhorseModel = prefs[providerWorkhorseModelKey] ?: "",
            frontierModel = prefs[providerFrontierModelKey] ?: "",
            baseUrl = prefs[providerBaseUrlKey] ?: ""
        )
    }

    val chatModelFlow: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[chatModelKey] ?: AppConfig.buildChatModel
    }

    val chatApiKeyFlow: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[chatApiKeyKey] ?: ""
    }

    val digestIntervalMinutesFlow: Flow<Int> = context.dataStore.data.map { prefs ->
        prefs[digestIntervalKey] ?: 30
    }

    /** Explicit owner opt-in for proactive digest notifications. */
    val digestEnabledFlow: Flow<Boolean> = context.dataStore.data.map { prefs ->
        prefs[digestEnabledKey] ?: false
    }

    val digestQuietHoursFlow: Flow<DigestQuietHours> = context.dataStore.data.map { prefs ->
        DigestQuietHours(
            enabled = prefs[digestQuietHoursEnabledKey] ?: false,
            startHour = prefs[digestQuietHoursStartKey] ?: 22,
            endHour = prefs[digestQuietHoursEndKey] ?: 7
        )
    }

    val digestProfileFlow: Flow<DigestProfile> = context.dataStore.data.map { prefs ->
        runCatching { DigestProfile.valueOf(prefs[digestProfileKey] ?: DigestProfile.ALL.name) }
            .getOrDefault(DigestProfile.ALL)
    }

    val realtimeEndpointFlow: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[realtimeEndpointKey] ?: AppConfig.buildRealtimeEndpoint
    }

    val realtimeClientSecretEndpointFlow: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[realtimeClientSecretEndpointKey] ?: AppConfig.buildRealtimeClientSecretEndpoint
    }

    val webClientIdOverrideFlow: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[webClientIdOverrideKey] ?: ""
    }

    /** Gmail account explicitly configured by the owner for triage/unsubscribe tools (device-scoped; not synced). */
    val gmailAccountEmailFlow: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[gmailAccountEmailKey] ?: ""
    }

    /** Owner-managed HTTPS destinations permitted for app-open and VIEW intent tools. */
    val allowedWebDomainsFlow: Flow<Set<String>> = context.dataStore.data.map { prefs ->
        prefs[allowedWebDomainsKey] ?: emptySet()
    }

    /**
     * §1.5 tools the owner has promoted to auto-execute without per-call
     * confirmation. Persisted so the promotion survives app restarts;
     * TrustGate still suspends these unconditionally whenever the session
     * is tainted (§1.5/1.4), regardless of what's stored here.
     */
    val alwaysAllowedToolsFlow: Flow<Set<String>> = context.dataStore.data.map { prefs ->
        prefs[alwaysAllowedToolsKey] ?: emptySet()
    }

    /**
     * §3.1 "realtime" (OpenAI WebRTC) or "local" (on-device SpeechRecognizer/TextToSpeech).
     *
     * Defaults to **local**, because that is the only one that can work on a fresh
     * install. Realtime needs a deployed SDP endpoint, a server minting client
     * secrets, and a Firebase sign-in; until all three are standing it does nothing,
     * which presents to the owner as "voice is broken" rather than "voice is not
     * configured yet". The on-device path needs none of them.
     *
     * Realtime is still the better experience once that backend exists -- it is a
     * mode to opt into, not the floor.
     */
    val voiceBackendFlow: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[voiceBackendKey] ?: "local"
    }

    suspend fun setVoiceBackend(backend: String) {
        context.dataStore.edit { it[voiceBackendKey] = backend }
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
            chatModel = prefs[chatModelKey] ?: AppConfig.buildChatModel,
            connectedIntegrations = prefs[connectedIntegrationsKey] ?: emptySet()
        )
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

    suspend fun setDigestEnabled(enabled: Boolean) {
        context.dataStore.edit { it[digestEnabledKey] = enabled }
    }

    suspend fun setDigestQuietHours(enabled: Boolean, startHour: Int, endHour: Int) {
        context.dataStore.edit {
            it[digestQuietHoursEnabledKey] = enabled
            it[digestQuietHoursStartKey] = startHour.coerceIn(0, 23)
            it[digestQuietHoursEndKey] = endHour.coerceIn(0, 23)
        }
    }

    suspend fun setDigestProfile(profile: DigestProfile) {
        context.dataStore.edit { it[digestProfileKey] = profile.name }
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

    suspend fun setGmailAccountEmail(email: String) {
        context.dataStore.edit { it[gmailAccountEmailKey] = email }
    }

    suspend fun grantAlwaysAllowTool(toolName: String) {
        context.dataStore.edit { prefs ->
            val current = prefs[alwaysAllowedToolsKey] ?: emptySet()
            prefs[alwaysAllowedToolsKey] = current + toolName
        }
    }

    suspend fun revokeAlwaysAllowTool(toolName: String) {
        context.dataStore.edit { prefs ->
            val current = prefs[alwaysAllowedToolsKey] ?: emptySet()
            prefs[alwaysAllowedToolsKey] = current - toolName
        }
    }

    suspend fun setAllowedWebDomains(domains: Set<String>) {
        val normalized = domains.mapNotNull { domain ->
            domain.trim().lowercase()
                .removePrefix("https://")
                .removePrefix("http://")
                .substringBefore('/')
                .takeIf { it.matches(Regex("[a-z0-9.-]+")) }
        }.toSet()
        context.dataStore.edit { it[allowedWebDomainsKey] = normalized }
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

    suspend fun setFirebaseSyncEnabled(enabled: Boolean) {
        context.dataStore.edit { it[firebaseSyncEnabledKey] = enabled }
    }

    suspend fun setShizukuEnabled(enabled: Boolean) {
        context.dataStore.edit { it[shizukuEnabledKey] = enabled }
    }

    suspend fun setOnboardingCompleted(completed: Boolean) {
        context.dataStore.edit { it[onboardingCompletedKey] = completed }
    }

    suspend fun setProviderConfig(config: ProviderConfig) {
        context.dataStore.edit {
            it[providerIdKey] = config.providerId
            it[providerModelIdKey] = config.modelId
            it[providerWorkhorseModelKey] = config.workhorseModel
            it[providerFrontierModelKey] = config.frontierModel
            it[providerBaseUrlKey] = config.baseUrl
            // apiKey intentionally excluded — stored in KeyStorage
        }
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
    val connectedIntegrations: Set<String>
)
