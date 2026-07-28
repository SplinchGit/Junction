package com.splinch.junction.ui

import android.content.Intent
import android.provider.Settings
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.splinch.junction.BuildConfig
import com.splinch.junction.core.Config
import com.splinch.junction.feed.FeedRepository
import com.splinch.junction.scheduler.Scheduler
import com.splinch.junction.settings.UserPrefsRepository
import com.splinch.junction.sync.firebase.AuthManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

@Composable
@OptIn(ExperimentalMaterial3Api::class)
fun SettingsScreen(
    userPrefs: UserPrefsRepository,
    feedRepository: FeedRepository,
    authManager: AuthManager,
    modifier: Modifier = Modifier
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    val chatModel by userPrefs.chatModelFlow.collectAsState(initial = Config.buildChatModel)
    val chatApiKey by userPrefs.chatApiKeyFlow.collectAsState(initial = "")
    val digestInterval by userPrefs.digestIntervalMinutesFlow.collectAsState(initial = 30)
    val realtimeEndpoint by userPrefs.realtimeEndpointFlow.collectAsState(initial = "")
    val realtimeClientSecretEndpoint by userPrefs.realtimeClientSecretEndpointFlow.collectAsState(initial = "")
    val notificationAck by userPrefs.notificationAccessAcknowledgedFlow.collectAsState(initial = false)
    val listenerEnabled by userPrefs.notificationListenerEnabledFlow.collectAsState(initial = false)
    val junctionOnlyNotifications by userPrefs.junctionOnlyNotificationsFlow.collectAsState(initial = false)
    val disabledPackages by userPrefs.disabledPackagesFlow.collectAsState(initial = emptySet())
    val connectedIntegrations by userPrefs.connectedIntegrationsFlow.collectAsState(initial = emptySet())
    val firebaseSyncEnabled by userPrefs.firebaseSyncEnabledFlow.collectAsState(initial = false)
    val user by authManager.userFlow.collectAsState()

    var chatModelInput by remember { mutableStateOf(chatModel) }
    var chatApiKeyInput by remember { mutableStateOf(chatApiKey) }
    var intervalInput by remember { mutableStateOf(digestInterval.toString()) }
    var realtimeEndpointInput by remember { mutableStateOf(realtimeEndpoint) }
    var realtimeClientSecretInput by remember { mutableStateOf(realtimeClientSecretEndpoint) }
    var understandChecked by remember { mutableStateOf(false) }
    var packages by remember { mutableStateOf(emptyList<String>()) }
    val httpClient = remember { OkHttpClient() }
    var clientSecretStatus by remember { mutableStateOf(ConnectionState(ConnectionStatus.IDLE)) }
    var chatSmokeStatus by remember { mutableStateOf(ConnectionState(ConnectionStatus.IDLE)) }

    val integrations = remember(connectedIntegrations) {
        listOf(
            IntegrationItem(
                id = "google",
                name = "Google Calendar",
                description = "Upcoming events, reminders, and daily agenda.",
                status = if (connectedIntegrations.contains("google")) "Connected" else "Ready to connect",
                enabled = !connectedIntegrations.contains("google"),
                connected = connectedIntegrations.contains("google")
            ),
            IntegrationItem(
                id = "slack",
                name = "Slack",
                description = "Mentions, DMs, and priority channels.",
                status = if (connectedIntegrations.contains("slack")) "Connected" else "Ready to connect",
                enabled = !connectedIntegrations.contains("slack"),
                connected = connectedIntegrations.contains("slack")
            ),
            IntegrationItem(
                id = "github",
                name = "GitHub",
                description = "PRs, issues, and review requests.",
                status = if (connectedIntegrations.contains("github")) "Connected" else "Ready to connect",
                enabled = !connectedIntegrations.contains("github"),
                connected = connectedIntegrations.contains("github")
            ),
            IntegrationItem(
                id = "notion",
                name = "Notion",
                description = "Tasks and knowledge updates.",
                status = if (connectedIntegrations.contains("notion")) "Connected" else "Ready to connect",
                enabled = !connectedIntegrations.contains("notion"),
                connected = connectedIntegrations.contains("notion")
            )
        )
    }

    LaunchedEffect(chatModel) { chatModelInput = chatModel }
    LaunchedEffect(chatApiKey) { chatApiKeyInput = chatApiKey }
    LaunchedEffect(digestInterval) { intervalInput = digestInterval.toString() }
    LaunchedEffect(realtimeEndpoint) { realtimeEndpointInput = realtimeEndpoint }
    LaunchedEffect(realtimeClientSecretEndpoint) { realtimeClientSecretInput = realtimeClientSecretEndpoint }

    LaunchedEffect(Unit) {
        packages = feedRepository.getDistinctPackages()
    }

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp)
    ) {
        item {
            Text(text = "Settings", style = MaterialTheme.typography.titleLarge)
        }

        item {
            Text(text = "Realtime", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(
                value = realtimeEndpointInput,
                onValueChange = { realtimeEndpointInput = it },
                label = { Text("Realtime SDP endpoint") },
                placeholder = { Text("https://<region>-<project>.cloudfunctions.net/realtimeSdpExchange") },
                modifier = Modifier.fillMaxWidth()
            )
            Button(onClick = {
                scope.launch { userPrefs.setRealtimeEndpoint(realtimeEndpointInput.trim()) }
            }) {
                Text("Save realtime endpoint")
            }
            OutlinedTextField(
                value = realtimeClientSecretInput,
                onValueChange = { realtimeClientSecretInput = it },
                label = { Text("Realtime client secret endpoint") },
                placeholder = { Text("https://<region>-<project>.cloudfunctions.net/realtimeClientSecret") },
                modifier = Modifier.fillMaxWidth()
            )
            Button(onClick = {
                scope.launch { userPrefs.setRealtimeClientSecretEndpoint(realtimeClientSecretInput.trim()) }
            }) {
                Text("Save client secret endpoint")
            }
        }

        item {
            Text(text = "Connectivity", style = MaterialTheme.typography.titleMedium)
            StatusRow(
                label = "Signed in",
                value = if (user == null) "No" else "Yes",
                detail = user?.email
            )
            StatusRow(
                label = "Firebase sync",
                value = if (firebaseSyncEnabled) "Enabled" else "Disabled (default)",
                detail = if (!firebaseSyncEnabled) "Enable below to use Google sign-in and sync." else null
            )
            StatusRow(
                label = "Realtime client secret",
                value = if (realtimeClientSecretEndpoint.isBlank()) "Not configured" else clientSecretStatus.label(),
                detail = clientSecretStatus.message
            )
            StatusRow(
                label = "Realtime SDP endpoint",
                value = if (realtimeEndpoint.isBlank()) "Not configured" else "Configured",
                detail = null
            )
            StatusRow(
                label = "Chat smoke test",
                value = if (chatSmokeStatus.status == ConnectionStatus.IDLE) "Not run" else chatSmokeStatus.label(),
                detail = chatSmokeStatus.message
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(
                    onClick = {
                        scope.launch {
                            clientSecretStatus = ConnectionState(ConnectionStatus.TESTING)
                            val token = user?.getIdToken(true)?.await()?.token
                            clientSecretStatus = when {
                                realtimeClientSecretEndpoint.isBlank() ->
                                    ConnectionState(ConnectionStatus.ERROR, "Missing endpoint")
                                token.isNullOrBlank() ->
                                    ConnectionState(ConnectionStatus.ERROR, "Sign-in required")
                                else ->
                                    testClientSecret(httpClient, realtimeClientSecretEndpoint, token)
                            }
                        }
                    }
                ) {
                    Text("Test connections")
                }
                TextButton(
                    onClick = {
                        clientSecretStatus = ConnectionState(ConnectionStatus.IDLE)
                        chatSmokeStatus = ConnectionState(ConnectionStatus.IDLE)
                    }
                ) {
                    Text("Reset")
                }
            }
        }

        item {
            Text(text = "Firebase sync (optional)", style = MaterialTheme.typography.titleMedium)
            Text(
                text = "Off by default. Enable to use Google sign-in and cloud sync. Not required to chat.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(text = "Enable Firebase sync", style = MaterialTheme.typography.bodyMedium)
                Switch(
                    checked = firebaseSyncEnabled,
                    onCheckedChange = { enabled ->
                        scope.launch { userPrefs.setFirebaseSyncEnabled(enabled) }
                    }
                )
            }
            if (firebaseSyncEnabled) {
                if (user == null) {
                    Text(
                        text = "Sign in with Google to enable sync.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                } else {
                    Text(
                        text = "Signed in as ${user?.email}",
                        style = MaterialTheme.typography.bodySmall
                    )
                    TextButton(onClick = { scope.launch { authManager.signOut() } }) {
                        Text("Sign out")
                    }
                }
            }
        }

        item {
            Text(text = "Digest", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(
                value = intervalInput,
                onValueChange = { intervalInput = it },
                label = { Text("Digest interval (minutes)") },
                modifier = Modifier.fillMaxWidth()
            )
            Button(onClick = {
                val parsed = intervalInput.toIntOrNull() ?: 30
                val safe = parsed.coerceAtLeast(15)
                scope.launch {
                    userPrefs.setDigestIntervalMinutes(safe)
                    Scheduler.scheduleFeedDigest(context, safe.toLong())
                }
            }) {
                Text("Apply digest interval")
            }
        }

        item {
            Text(text = "Feed", style = MaterialTheme.typography.titleMedium)
            Button(onClick = {
                scope.launch {
                    feedRepository.clearAll()
                    Toast.makeText(context, "Feed cleared", Toast.LENGTH_SHORT).show()
                }
            }) {
                Text("Clear feed data")
            }
        }

        item {
            Text(text = "Notification access", style = MaterialTheme.typography.titleMedium)
            if (!notificationAck) {
                Text(
                    text = "Junction can read notification metadata to build your calm feed. " +
                        "Nothing leaves your device unless you enable a backend.",
                    style = MaterialTheme.typography.bodyMedium
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Switch(
                        checked = understandChecked,
                        onCheckedChange = { understandChecked = it }
                    )
                    Text(
                        text = "I understand and consent",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(start = 8.dp)
                    )
                }
                Button(
                    onClick = {
                        if (understandChecked) {
                            scope.launch { userPrefs.setNotificationAccessAcknowledged(true) }
                            context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                        }
                    },
                    enabled = understandChecked
                ) {
                    Text("Open Notification Access")
                }
            } else {
                Text(
                    text = if (listenerEnabled) {
                        "Notification access is enabled."
                    } else {
                        "Notification access is not enabled yet."
                    },
                    style = MaterialTheme.typography.bodyMedium
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(text = "Junction-only notifications", style = MaterialTheme.typography.bodyMedium)
                        Text(
                            text = "If enabled, Junction will dismiss incoming app notifications and show them only in your Junction feed.",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Switch(
                        checked = junctionOnlyNotifications,
                        onCheckedChange = { enabled ->
                            scope.launch { userPrefs.setJunctionOnlyNotifications(enabled) }
                        }
                    )
                }
                TextButton(onClick = {
                    context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                }) {
                    Text("Manage notification access")
                }
            }
        }

        item {
            Text(
                text = "Integrations",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                text = "Connect Junction to other services.",
                style = MaterialTheme.typography.bodyMedium
            )
        }

        items(integrations) { integration ->
            IntegrationRow(
                item = integration,
                onConnect = {
                    scope.launch {
                        val token = user?.getIdToken(true)?.await()?.token
                        if (token.isNullOrBlank()) {
                            Toast.makeText(context, "Sign in required", Toast.LENGTH_SHORT).show()
                            return@launch
                        }
                        val endpoint = realtimeEndpoint.trim().trimEnd('/').let { base ->
                            base.substringBeforeLast('/') + "/integrations/${integration.id}/start"
                        }
                        val result = startIntegration(
                            client = httpClient,
                            url = endpoint,
                            token = token
                        )
                        if (result.isSuccess) {
                            val url = result.getOrNull().orEmpty()
                            if (url.isNotBlank()) {
                                context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()))
                            } else {
                                Toast.makeText(context, "Missing auth URL", Toast.LENGTH_SHORT).show()
                            }
                        } else {
                            Toast.makeText(
                                context,
                                result.exceptionOrNull()?.message ?: "Failed to start integration",
                                Toast.LENGTH_SHORT
                            ).show()
                        }
                    }
                },
                onDisconnect = {
                    scope.launch {
                        userPrefs.setIntegrationConnected(integration.id, false)
                        Toast.makeText(context, "Disconnected", Toast.LENGTH_SHORT).show()
                    }
                },
                onSync = {
                    Toast.makeText(context, "Sync not available", Toast.LENGTH_SHORT).show()
                }
            )
        }

        if (packages.isNotEmpty()) {
            item {
                Text(
                    text = "App filters",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = "Disable apps you don't want in your Junction feed.",
                    style = MaterialTheme.typography.bodyMedium
                )
            }

            items(packages) { packageName ->
                val enabled = !disabledPackages.contains(packageName)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(text = resolveAppLabel(context, packageName))
                    Switch(
                        checked = enabled,
                        onCheckedChange = { isEnabled ->
                            scope.launch { userPrefs.setPackageEnabled(packageName, isEnabled) }
                        }
                    )
                }
            }
        }

        item {
            Text(
                text = "About",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                text = "Version ${BuildConfig.VERSION_NAME} (${BuildConfig.JUNCTION_VERSION_CODE})",
                style = MaterialTheme.typography.bodyMedium
            )
        }
    }
}

private fun resolveAppLabel(context: android.content.Context, packageName: String): String {
    return try {
        val pm = context.packageManager
        val appInfo = pm.getApplicationInfo(packageName, 0)
        pm.getApplicationLabel(appInfo).toString()
    } catch (_: Exception) {
        packageName
    }
}

private data class IntegrationItem(
    val id: String,
    val name: String,
    val description: String,
    val status: String,
    val enabled: Boolean,
    val connected: Boolean
)

@Composable
private fun IntegrationRow(
    item: IntegrationItem,
    onConnect: () -> Unit,
    onDisconnect: () -> Unit,
    onSync: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(text = item.name, style = MaterialTheme.typography.bodyLarge)
            Text(
                text = item.description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = item.status,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (item.connected) {
                Button(onClick = onDisconnect) {
                    Text("Disconnect")
                }
                TextButton(onClick = onSync) {
                    Text("Sync")
                }
            } else {
                Button(onClick = onConnect, enabled = item.enabled) {
                    Text("Connect")
                }
            }
        }
    }
}

private enum class ConnectionStatus {
    IDLE,
    TESTING,
    OK,
    ERROR
}

private data class ConnectionState(
    val status: ConnectionStatus,
    val message: String? = null
) {
    fun label(): String {
        return when (status) {
            ConnectionStatus.IDLE -> "Idle"
            ConnectionStatus.TESTING -> "Testing..."
            ConnectionStatus.OK -> "Healthy"
            ConnectionStatus.ERROR -> "Error"
        }
    }
}

@Composable
private fun StatusRow(label: String, value: String, detail: String?) {
    Column(modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(text = label, style = MaterialTheme.typography.bodyMedium)
            Text(text = value, style = MaterialTheme.typography.labelMedium)
        }
        if (!detail.isNullOrBlank()) {
            Text(
                text = detail,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

private suspend fun testClientSecret(
    client: OkHttpClient,
    endpoint: String,
    token: String
): ConnectionState {
    return withContext(Dispatchers.IO) {
        val body = "{}".toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url(endpoint.trim())
            .post(body)
            .addHeader("Authorization", "Bearer $token")
            .build()
        try {
            client.newCall(request).execute().use { response ->
                val payload = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    return@withContext ConnectionState(
                        ConnectionStatus.ERROR,
                        "HTTP ${response.code}"
                    )
                }
                val json = runCatching { JSONObject(payload) }.getOrNull()
                val secret = json?.optString("client_secret")
                    ?.ifBlank { null }
                    ?: json?.optJSONObject("client_secret")?.optString("value")
                if (!secret.isNullOrBlank()) {
                    ConnectionState(ConnectionStatus.OK, "Minted client secret")
                } else {
                    ConnectionState(ConnectionStatus.ERROR, "Missing client secret")
                }
            }
        } catch (ex: Exception) {
            ConnectionState(ConnectionStatus.ERROR, ex.message ?: "Network error")
        }
    }
}

private suspend fun startIntegration(
    client: OkHttpClient,
    url: String,
    token: String
): Result<String> {
    return withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(url)
            .post("{}".toRequestBody("application/json".toMediaType()))
            .addHeader("Authorization", "Bearer $token")
            .build()
        try {
            client.newCall(request).execute().use { response ->
                val payload = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    return@withContext Result.failure(
                        IllegalStateException("HTTP ${response.code}")
                    )
                }
                val json = runCatching { JSONObject(payload) }.getOrNull()
                val authUrl = json?.optString("url").orEmpty()
                Result.success(authUrl)
            }
        } catch (ex: Exception) {
            Result.failure(ex)
        }
    }
}
