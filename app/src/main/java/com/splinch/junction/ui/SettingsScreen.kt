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
fun SettingsScreen(
    userPrefs: UserPrefsRepository,
    feedRepository: FeedRepository,
    authManager: AuthManager,
    modifier: Modifier = Modifier
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val activity = context as? android.app.Activity

    val useBackend by userPrefs.useHttpBackendFlow.collectAsState(initial = false)
    val apiBaseUrl by userPrefs.apiBaseUrlFlow.collectAsState(initial = "")
    val digestInterval by userPrefs.digestIntervalMinutesFlow.collectAsState(initial = 30)
    val realtimeEndpoint by userPrefs.realtimeEndpointFlow.collectAsState(initial = "")
    val realtimeClientSecretEndpoint by userPrefs.realtimeClientSecretEndpointFlow.collectAsState(initial = "")
    val notificationAck by userPrefs.notificationAccessAcknowledgedFlow.collectAsState(initial = false)
    val listenerEnabled by userPrefs.notificationListenerEnabledFlow.collectAsState(initial = false)
    val disabledPackages by userPrefs.disabledPackagesFlow.collectAsState(initial = emptySet())
    val connectedIntegrations by userPrefs.connectedIntegrationsFlow.collectAsState(initial = emptySet())
    val mafiosoEnabled by userPrefs.mafiosoGameEnabledFlow.collectAsState(initial = false)
    val user by authManager.userFlow.collectAsState()

    var apiBaseUrlInput by remember { mutableStateOf(apiBaseUrl) }
    var intervalInput by remember { mutableStateOf(digestInterval.toString()) }
    var realtimeEndpointInput by remember { mutableStateOf(realtimeEndpoint) }
    var realtimeClientSecretInput by remember { mutableStateOf(realtimeClientSecretEndpoint) }
    var understandChecked by remember { mutableStateOf(false) }
    var packages by remember { mutableStateOf(emptyList<String>()) }
    var authError by remember { mutableStateOf<String?>(null) }
    val httpClient = remember { OkHttpClient() }
    var clientSecretStatus by remember { mutableStateOf(ConnectionState(ConnectionStatus.IDLE)) }
    var backendStatus by remember { mutableStateOf(ConnectionState(ConnectionStatus.IDLE)) }
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

    LaunchedEffect(apiBaseUrl) {
        apiBaseUrlInput = apiBaseUrl
    }

    LaunchedEffect(digestInterval) {
        intervalInput = digestInterval.toString()
    }

    LaunchedEffect(realtimeEndpoint) {
        realtimeEndpointInput = realtimeEndpoint
    }

    LaunchedEffect(realtimeClientSecretEndpoint) {
        realtimeClientSecretInput = realtimeClientSecretEndpoint
    }

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
            Text(text = "Get started", style = MaterialTheme.typography.titleMedium)
            ChecklistRow(
                label = "Sign in to Junction",
                done = user != null,
                detail = user?.email
            )
            ChecklistRow(
                label = "Set Realtime client secret endpoint",
                done = realtimeClientSecretEndpoint.isNotBlank(),
                detail = realtimeClientSecretEndpoint.ifBlank { "Missing endpoint" }
            )
            ChecklistRow(
                label = "Set HTTP backend base URL",
                done = apiBaseUrl.isNotBlank(),
                detail = apiBaseUrl.ifBlank { "Missing base URL" }
            )
        }

        item {
            Text(text = "Account", style = MaterialTheme.typography.titleMedium)
            if (user == null) {
                Text(
                    text = "Sign in to sync conversations and feed metadata.",
                    style = MaterialTheme.typography.bodyMedium
                )
                Button(
                    onClick = {
                        authError = null
                        if (activity != null) {
                            scope.launch {
                                val result = authManager.signInWithGoogle(activity)
                                if (result.isFailure) {
                                    authError = result.exceptionOrNull()?.message ?: "Sign-in failed"
                                }
                            }
                        } else {
                            authError = "Sign-in requires an Activity context"
                        }
                    }
                ) {
                    Text("Sign in with Google")
                }
            } else {
                Text(
                    text = "Signed in as ${user?.email ?: "Google user"}",
                    style = MaterialTheme.typography.bodyMedium
                )
                Text(
                    text = "Sync is active for this account.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                TextButton(
                    onClick = { scope.launch { authManager.signOut() } }
                ) {
                    Text("Sign out")
                }
            }
            if (!authError.isNullOrBlank()) {
                Text(
                    text = authError.orEmpty(),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.error
                )
            }
        }

        item {
            Text(text = "Backend", style = MaterialTheme.typography.titleMedium)
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(text = "Use HTTP backend", style = MaterialTheme.typography.bodyMedium)
                Switch(
                    checked = useBackend,
                    onCheckedChange = { enabled ->
                        scope.launch { userPrefs.setUseHttpBackend(enabled) }
                    }
                )
            }

            OutlinedTextField(
                value = apiBaseUrlInput,
                onValueChange = { apiBaseUrlInput = it },
                label = { Text("API Base URL") },
                placeholder = { Text("http://10.0.2.2:8787") },
                modifier = Modifier.fillMaxWidth()
            )
            Button(onClick = {
                scope.launch {
                    val base = apiBaseUrlInput.trim()
                    userPrefs.setApiBaseUrl(base)
                    if (realtimeClientSecretInput.isBlank()) {
                        userPrefs.setRealtimeClientSecretEndpoint(deriveClientSecretEndpoint(base))
                    }
                    if (realtimeEndpointInput.isBlank()) {
                        userPrefs.setRealtimeEndpoint(deriveSdpEndpoint(base))
                    }
                }
            }) {
                Text("Save API URL")
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                TextButton(onClick = {
                    scope.launch {
                        val base = "http://10.0.2.2:8787"
                        userPrefs.setApiBaseUrl(base)
                        userPrefs.setRealtimeClientSecretEndpoint(deriveClientSecretEndpoint(base))
                        userPrefs.setRealtimeEndpoint(deriveSdpEndpoint(base))
                        userPrefs.setUseHttpBackend(true)
                        Toast.makeText(context, "Emulator defaults applied", Toast.LENGTH_SHORT).show()
                    }
                }) {
                    Text("Use emulator defaults")
                }
                TextButton(onClick = {
                    scope.launch {
                        userPrefs.setRealtimeClientSecretEndpoint(deriveClientSecretEndpoint(apiBaseUrlInput.trim()))
                        userPrefs.setRealtimeEndpoint(deriveSdpEndpoint(apiBaseUrlInput.trim()))
                        Toast.makeText(context, "Derived endpoints from base URL", Toast.LENGTH_SHORT).show()
                    }
                }) {
                    Text("Auto-fill endpoints")
                }
            }
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
                label = { Text("Realtime client secret endpoint (recommended)") },
                placeholder = { Text("https://<region>-<project>.cloudfunctions.net/realtimeClientSecret") },
                modifier = Modifier.fillMaxWidth()
            )
            Button(onClick = {
                scope.launch { userPrefs.setRealtimeClientSecretEndpoint(realtimeClientSecretInput.trim()) }
            }) {
                Text("Save client secret endpoint")
            }
            Text(
                text = "Sign-in is required to create Realtime sessions.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        item {
            Text(text = "Connectivity", style = MaterialTheme.typography.titleMedium)
            StatusRow(
                label = "Signed in",
                value = if (user == null) "No" else "Yes",
                detail = user?.email
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
                label = "HTTP backend",
                value = if (!useBackend || apiBaseUrl.isBlank()) "Not configured" else backendStatus.label(),
                detail = backendStatus.message
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(
                    onClick = {
                        scope.launch {
                            val token = user?.getIdToken(true)?.await()?.token
                            clientSecretStatus = ConnectionState(ConnectionStatus.TESTING)
                            backendStatus = ConnectionState(ConnectionStatus.TESTING)

                            clientSecretStatus = if (realtimeClientSecretEndpoint.isBlank()) {
                                ConnectionState(ConnectionStatus.ERROR, "Missing endpoint")
                            } else if (token.isNullOrBlank()) {
                                ConnectionState(ConnectionStatus.ERROR, "Sign-in required")
                            } else {
                                testClientSecret(httpClient, realtimeClientSecretEndpoint, token)
                            }

                            backendStatus = if (!useBackend || apiBaseUrl.isBlank()) {
                                ConnectionState(ConnectionStatus.ERROR, "Disabled")
                            } else {
                                testBackendHealth(httpClient, apiBaseUrl)
                            }
                        }
                    }
                ) {
                    Text("Test connections")
                }
                TextButton(
                    onClick = {
                        clientSecretStatus = ConnectionState(ConnectionStatus.IDLE)
                        backendStatus = ConnectionState(ConnectionStatus.IDLE)
                    }
                ) {
                    Text("Reset")
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
            Text(
                text = "Tip: 10.0.2.2 targets localhost from the Android emulator.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
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
                        val baseUrl = apiBaseUrl.trim()
                        if (baseUrl.isBlank()) {
                            Toast.makeText(context, "Set API base URL first", Toast.LENGTH_SHORT).show()
                            return@launch
                        }
                        val result = startIntegration(
                            client = httpClient,
                            baseUrl = baseUrl,
                            provider = integration.id,
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
                        val token = user?.getIdToken(true)?.await()?.token
                        if (token.isNullOrBlank()) {
                            Toast.makeText(context, "Sign in required", Toast.LENGTH_SHORT).show()
                            return@launch
                        }
                        val baseUrl = apiBaseUrl.trim()
                        if (baseUrl.isBlank()) {
                            Toast.makeText(context, "Set API base URL first", Toast.LENGTH_SHORT).show()
                            return@launch
                        }
                        val result = disconnectIntegration(
                            client = httpClient,
                            baseUrl = baseUrl,
                            provider = integration.id,
                            token = token
                        )
                        if (result.isSuccess) {
                            userPrefs.setIntegrationConnected(integration.id, false)
                            Toast.makeText(context, "Disconnected", Toast.LENGTH_SHORT).show()
                        } else {
                            Toast.makeText(
                                context,
                                result.exceptionOrNull()?.message ?: "Failed to disconnect",
                                Toast.LENGTH_SHORT
                            ).show()
                        }
                    }
                },
                onSync = {
                    scope.launch {
                        val token = user?.getIdToken(true)?.await()?.token
                        if (token.isNullOrBlank()) {
                            Toast.makeText(context, "Sign in required", Toast.LENGTH_SHORT).show()
                            return@launch
                        }
                        val baseUrl = apiBaseUrl.trim()
                        if (baseUrl.isBlank()) {
                            Toast.makeText(context, "Set API base URL first", Toast.LENGTH_SHORT).show()
                            return@launch
                        }
                        val result = syncIntegration(
                            client = httpClient,
                            baseUrl = baseUrl,
                            provider = integration.id,
                            token = token
                        )
                        if (result.isSuccess) {
                            Toast.makeText(context, "Sync started", Toast.LENGTH_SHORT).show()
                        } else {
                            Toast.makeText(
                                context,
                                result.exceptionOrNull()?.message ?: "Sync failed",
                                Toast.LENGTH_SHORT
                            ).show()
                        }
                    }
                }
            )
        }

        item {
            Text(
                text = "Games (optional)",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                text = "Enable built-in games. They run fully inside Junction.",
                style = MaterialTheme.typography.bodyMedium
            )
        }

        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(text = "Mafioso", style = MaterialTheme.typography.bodyLarge)
                    Text(
                        text = "Optional mafia strategy game. Tap Play to launch.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Switch(
                    checked = mafiosoEnabled,
                    onCheckedChange = { enabled ->
                        scope.launch { userPrefs.setMafiosoGameEnabled(enabled) }
                    }
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(
                    onClick = {
                        if (mafiosoEnabled) {
                            context.startActivity(
                                Intent(context, MafiosoGameActivity::class.java)
                            )
                        } else {
                            Toast.makeText(context, "Enable Mafioso to play", Toast.LENGTH_SHORT).show()
                        }
                    }
                ) {
                    Text("Play Mafioso")
                }
                TextButton(
                    onClick = {
                        if (!mafiosoEnabled) {
                            scope.launch { userPrefs.setMafiosoGameEnabled(true) }
                        }
                    }
                ) {
                    Text("Enable")
                }
            }
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

@Composable
private fun ChecklistRow(label: String, done: Boolean, detail: String?) {
    Column(modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(text = label, style = MaterialTheme.typography.bodyMedium)
            Text(
                text = if (done) "Done" else "Needed",
                style = MaterialTheme.typography.labelMedium,
                color = if (done) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error
            )
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

private suspend fun testBackendHealth(
    client: OkHttpClient,
    baseUrl: String
): ConnectionState {
    return withContext(Dispatchers.IO) {
        val url = baseUrl.trim().trimEnd('/') + "/health"
        val request = Request.Builder()
            .url(url)
            .get()
            .build()
        try {
            client.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    ConnectionState(ConnectionStatus.OK, "Reachable")
                } else {
                    ConnectionState(
                        ConnectionStatus.ERROR,
                        "HTTP ${response.code}"
                    )
                }
            }
        } catch (ex: Exception) {
            ConnectionState(ConnectionStatus.ERROR, ex.message ?: "Network error")
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
    baseUrl: String,
    provider: String,
    token: String
): Result<String> {
    return withContext(Dispatchers.IO) {
        val url = baseUrl.trim().trimEnd('/') + "/integrations/$provider/start"
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

private fun deriveClientSecretEndpoint(baseUrl: String): String {
    val base = baseUrl.trim().trimEnd('/')
    return if (base.isBlank()) "" else "$base/realtime/client-secret"
}

private fun deriveSdpEndpoint(baseUrl: String): String {
    val base = baseUrl.trim().trimEnd('/')
    return if (base.isBlank()) "" else "$base/realtime/sdp-exchange"
}

private suspend fun disconnectIntegration(
    client: OkHttpClient,
    baseUrl: String,
    provider: String,
    token: String
): Result<Unit> {
    return withContext(Dispatchers.IO) {
        val url = baseUrl.trim().trimEnd('/') + "/integrations/$provider/disconnect"
        val request = Request.Builder()
            .url(url)
            .post("{}".toRequestBody("application/json".toMediaType()))
            .addHeader("Authorization", "Bearer $token")
            .build()
        try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    return@withContext Result.failure(
                        IllegalStateException("HTTP ${response.code}")
                    )
                }
                Result.success(Unit)
            }
        } catch (ex: Exception) {
            Result.failure(ex)
        }
    }
}

private suspend fun syncIntegration(
    client: OkHttpClient,
    baseUrl: String,
    provider: String,
    token: String
): Result<Unit> {
    return withContext(Dispatchers.IO) {
        val url = baseUrl.trim().trimEnd('/') + "/integrations/$provider/sync"
        val request = Request.Builder()
            .url(url)
            .post("{}".toRequestBody("application/json".toMediaType()))
            .addHeader("Authorization", "Bearer $token")
            .build()
        try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    return@withContext Result.failure(
                        IllegalStateException("HTTP ${response.code}")
                    )
                }
                Result.success(Unit)
            }
        } catch (ex: Exception) {
            Result.failure(ex)
        }
    }
}
