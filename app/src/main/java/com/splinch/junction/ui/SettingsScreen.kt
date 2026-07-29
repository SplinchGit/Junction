package com.splinch.junction.ui

import android.app.Activity
import android.content.ContextWrapper
import android.content.Intent
import android.provider.Settings
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.splinch.junction.BuildConfig
import com.splinch.junction.accessibility.JunctionAccessibilityService
import com.splinch.junction.chat.ChatManager
import com.splinch.junction.chat.provider.ModelCatalog
import com.splinch.junction.core.Config
import com.splinch.junction.feed.FeedRepository
import com.splinch.junction.platform.ShizukuCapability
import com.splinch.junction.platform.ShizukuStatus
import com.splinch.junction.scheduler.Scheduler
import com.splinch.junction.settings.KeyStorage
import com.splinch.junction.settings.ProviderConfig
import com.splinch.junction.settings.UserPrefsRepository
import com.splinch.junction.sync.firebase.AuthManager
import com.splinch.junction.ui.components.JunctionTextField
import com.splinch.junction.ui.components.ModelCard
import com.splinch.junction.ui.components.ProviderCard
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
    chatManager: ChatManager,
    actionLogDao: com.splinch.junction.data.ActionLogDao,
    memoryFactDao: com.splinch.junction.data.MemoryFactDao,
    modifier: Modifier = Modifier
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    val chatModel by userPrefs.chatModelFlow.collectAsState(initial = Config.buildChatModel)
    val chatApiKey by userPrefs.chatApiKeyFlow.collectAsState(initial = "")
    val providerConfig by userPrefs.providerConfigFlow.collectAsState(initial = ProviderConfig())
    val digestInterval by userPrefs.digestIntervalMinutesFlow.collectAsState(initial = 30)
    val digestEnabled by userPrefs.digestEnabledFlow.collectAsState(initial = false)
    val digestQuietHours by userPrefs.digestQuietHoursFlow.collectAsState(initial = com.splinch.junction.scheduler.DigestQuietHours(false, 22, 7))
    val digestProfile by userPrefs.digestProfileFlow.collectAsState(initial = com.splinch.junction.scheduler.DigestProfile.ALL)
    val realtimeEndpoint by userPrefs.realtimeEndpointFlow.collectAsState(initial = "")
    val realtimeClientSecretEndpoint by userPrefs.realtimeClientSecretEndpointFlow.collectAsState(initial = "")
    val gmailAccountEmail by userPrefs.gmailAccountEmailFlow.collectAsState(initial = "")
    val allowedWebDomains by userPrefs.allowedWebDomainsFlow.collectAsState(initial = emptySet())
    val notificationAck by userPrefs.notificationAccessAcknowledgedFlow.collectAsState(initial = false)
    val listenerEnabled by userPrefs.notificationListenerEnabledFlow.collectAsState(initial = false)
    val junctionOnlyNotifications by userPrefs.junctionOnlyNotificationsFlow.collectAsState(initial = false)
    val disabledPackages by userPrefs.disabledPackagesFlow.collectAsState(initial = emptySet())
    val connectedIntegrations by userPrefs.connectedIntegrationsFlow.collectAsState(initial = emptySet())
    val firebaseSyncEnabled by userPrefs.firebaseSyncEnabledFlow.collectAsState(initial = false)
    val shizukuEnabled by userPrefs.shizukuEnabledFlow.collectAsState(initial = false)
    val user by authManager.userFlow.collectAsState()

    val keyStorage = remember { KeyStorage(context) }
    var providerIdInput by remember { mutableStateOf(providerConfig.providerId) }
    var providerModelIdInput by remember { mutableStateOf(providerConfig.modelId) }
    var providerApiKeyInput by remember { mutableStateOf("") }
    var providerFrontierInput by remember { mutableStateOf(providerConfig.frontierModel) }
    var providerBaseUrlInput by remember { mutableStateOf(providerConfig.baseUrl) }
    var providerTestStatus by remember { mutableStateOf("") }
    var providerPickerExpanded by remember { mutableStateOf(false) }
    var shizukuStatus by remember { mutableStateOf(ShizukuCapability.status(shizukuEnabled)) }

    LaunchedEffect(shizukuEnabled) {
        shizukuStatus = ShizukuCapability.status(shizukuEnabled)
    }

    var chatModelInput by remember { mutableStateOf(chatModel) }
    var chatApiKeyInput by remember { mutableStateOf(chatApiKey) }
    var intervalInput by remember { mutableStateOf(digestInterval.toString()) }
    var quietStartInput by remember { mutableStateOf(digestQuietHours.startHour.toString()) }
    var quietEndInput by remember { mutableStateOf(digestQuietHours.endHour.toString()) }
    var realtimeEndpointInput by remember { mutableStateOf(realtimeEndpoint) }
    var realtimeClientSecretInput by remember { mutableStateOf(realtimeClientSecretEndpoint) }
    var gmailAccountEmailInput by remember { mutableStateOf(gmailAccountEmail) }
    var allowedWebDomainsInput by remember { mutableStateOf(allowedWebDomains.joinToString("\n")) }
    var understandChecked by remember { mutableStateOf(false) }
    var packages by remember { mutableStateOf(emptyList<String>()) }
    val httpClient = remember { OkHttpClient() }
    var clientSecretStatus by remember { mutableStateOf(ConnectionState(ConnectionStatus.IDLE)) }
    var chatSmokeStatus by remember { mutableStateOf(ConnectionState(ConnectionStatus.IDLE)) }
    var accessibilityEnabled by remember { mutableStateOf(JunctionAccessibilityService.isEnabled(context)) }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                accessibilityEnabled = JunctionAccessibilityService.isEnabled(context)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

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

    LaunchedEffect(providerConfig) {
        providerIdInput = providerConfig.providerId
        providerModelIdInput = providerConfig.modelId
        providerFrontierInput = providerConfig.frontierModel
        providerBaseUrlInput = providerConfig.baseUrl
        providerApiKeyInput = keyStorage.getApiKey(providerConfig.providerId)
    }

    LaunchedEffect(chatModel) { chatModelInput = chatModel }
    LaunchedEffect(chatApiKey) { chatApiKeyInput = chatApiKey }
    LaunchedEffect(digestInterval) { intervalInput = digestInterval.toString() }
    LaunchedEffect(digestQuietHours) {
        quietStartInput = digestQuietHours.startHour.toString()
        quietEndInput = digestQuietHours.endHour.toString()
    }
    LaunchedEffect(realtimeEndpoint) { realtimeEndpointInput = realtimeEndpoint }
    LaunchedEffect(realtimeClientSecretEndpoint) { realtimeClientSecretInput = realtimeClientSecretEndpoint }
    LaunchedEffect(gmailAccountEmail) { gmailAccountEmailInput = gmailAccountEmail }
    LaunchedEffect(allowedWebDomains) { allowedWebDomainsInput = allowedWebDomains.sorted().joinToString("\n") }

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
            val currentProvider = remember(providerIdInput) { ModelCatalog.providerById(providerIdInput) }
            val currentModel = remember(providerIdInput, providerModelIdInput) {
                currentProvider?.models?.find { it.id == providerModelIdInput }
                    ?: currentProvider?.models?.find { it.id == currentProvider.defaultModelId }
            }

            Text(text = "AI Provider", style = MaterialTheme.typography.titleMedium)
            Text(
                text = "Connect an AI provider to use chat without a server. " +
                    "You can change AI providers at any time here!",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            OutlinedButton(onClick = {
                scope.launch { userPrefs.setOnboardingCompleted(false) }
            }) {
                Text("Run setup wizard")
            }
            Spacer(Modifier.height(12.dp))

            // Currently active provider + model, always visible, never ambiguous.
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        text = currentProvider?.displayName ?: providerIdInput.ifBlank { "No provider selected" },
                        style = MaterialTheme.typography.titleMedium
                    )
                    Text(
                        text = currentModel?.displayName ?: "Default model",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                OutlinedButton(onClick = { providerPickerExpanded = !providerPickerExpanded }) {
                    Text(if (providerPickerExpanded) "Close" else "Change")
                }
            }

            if (providerPickerExpanded) {
                Spacer(Modifier.height(12.dp))
                Text(text = "Provider", style = MaterialTheme.typography.labelLarge)
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    ModelCatalog.providers.forEach { provider ->
                        ProviderCard(
                            provider = provider,
                            selected = provider.id == providerIdInput,
                            onClick = {
                                providerIdInput = provider.id
                                providerModelIdInput = provider.defaultModelId
                            }
                        )
                    }
                }
                if (currentProvider != null && currentProvider.models.isNotEmpty()) {
                    Spacer(Modifier.height(12.dp))
                    Text(text = "Model", style = MaterialTheme.typography.labelLarge)
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        currentProvider.models.forEach { model ->
                            ModelCard(
                                model = model,
                                selected = model.id == providerModelIdInput,
                                onClick = { providerModelIdInput = model.id }
                            )
                        }
                    }
                }
                Spacer(Modifier.height(12.dp))
            }

            JunctionTextField(
                value = providerApiKeyInput,
                onValueChange = { providerApiKeyInput = it },
                label = "API key",
                isPassword = true
            )
            JunctionTextField(
                value = providerFrontierInput,
                onValueChange = { providerFrontierInput = it },
                label = "Frontier model override (optional, advanced)",
                placeholder = "e.g. claude-sonnet-4-6 -- leave blank to use the picked model for everything"
            )
            if (providerIdInput == "custom") {
                JunctionTextField(
                    value = providerBaseUrlInput,
                    onValueChange = { providerBaseUrlInput = it },
                    label = "Base URL",
                    placeholder = "https://api.example.com/v1"
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(onClick = {
                    scope.launch {
                        val switched = providerIdInput.trim() != providerConfig.providerId ||
                            providerModelIdInput.trim() != providerConfig.modelId
                        val config = ProviderConfig(
                            providerId = providerIdInput.trim(),
                            apiKey = "",
                            modelId = providerModelIdInput.trim(),
                            frontierModel = providerFrontierInput.trim(),
                            baseUrl = providerBaseUrlInput.trim()
                        )
                        userPrefs.setProviderConfig(config)
                        if (providerApiKeyInput.isNotBlank()) {
                            keyStorage.setApiKey(providerIdInput.trim(), providerApiKeyInput)
                        }
                        if (switched) {
                            chatManager.announceProviderSwitch(config.providerId, config.modelId)
                        }
                        providerPickerExpanded = false
                        providerTestStatus = "Saved."
                    }
                }) {
                    Text("Save")
                }
                OutlinedButton(onClick = {
                    providerTestStatus = "Testing..."
                    scope.launch {
                        // Basic connectivity check: just verify we have a key
                        val key = keyStorage.getApiKey(providerIdInput.trim())
                        providerTestStatus = if (key.isBlank()) "No API key set." else "Key present. Send a message to test."
                    }
                }) {
                    Text("Test")
                }
            }
            if (providerTestStatus.isNotBlank()) {
                Text(
                    text = providerTestStatus,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            // §Cost control: "you cannot control what you don't measure" —
            // a running total of today's estimated spend, computed from the
            // same audit rows that back the Audit tab.
            val startOfToday = remember {
                java.time.LocalDate.now()
                    .atStartOfDay(java.time.ZoneId.systemDefault())
                    .toInstant()
                    .toEpochMilli()
            }
            val todaysCost by actionLogDao.totalCostSinceFlow(startOfToday).collectAsState(initial = null)
            Text(
                text = "Estimated spend today: ${"$%.4f".format(todaysCost ?: 0.0)} (approximate, from token usage)",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        item {
            val voiceBackend by chatManager.voiceBackendState.collectAsState()
            Text(text = "Voice backend", style = MaterialTheme.typography.titleMedium)
            Text(
                text = "Realtime uses OpenAI's low-latency voice API (needs the endpoint below). " +
                    "On-device uses this phone's own speech recognition and text-to-speech, routed through " +
                    "whichever text provider is configured above — works with any provider, higher latency.",
                style = MaterialTheme.typography.bodyMedium
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(text = "On-device (provider-agnostic)", style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.width(8.dp))
                Switch(
                    checked = voiceBackend == com.splinch.junction.chat.VoiceBackend.LOCAL,
                    onCheckedChange = { useLocal ->
                        scope.launch {
                            chatManager.setVoiceBackend(
                                if (useLocal) com.splinch.junction.chat.VoiceBackend.LOCAL
                                else com.splinch.junction.chat.VoiceBackend.REALTIME
                            )
                        }
                    }
                )
            }
        }

        item {
            Text(text = "Realtime", style = MaterialTheme.typography.titleMedium)
            JunctionTextField(
                value = realtimeEndpointInput,
                onValueChange = { realtimeEndpointInput = it },
                label = "Realtime SDP endpoint",
                placeholder = "https://<region>-<project>.cloudfunctions.net/realtimeSdpExchange"
            )
            Button(onClick = {
                scope.launch { userPrefs.setRealtimeEndpoint(realtimeEndpointInput.trim()) }
            }) {
                Text("Save realtime endpoint")
            }
            JunctionTextField(
                value = realtimeClientSecretInput,
                onValueChange = { realtimeClientSecretInput = it },
                label = "Realtime client secret endpoint",
                placeholder = "https://<region>-<project>.cloudfunctions.net/realtimeClientSecret"
            )
            Button(onClick = {
                scope.launch { userPrefs.setRealtimeClientSecretEndpoint(realtimeClientSecretInput.trim()) }
            }) {
                Text("Save client secret endpoint")
            }
        }

        item {
            Text(text = "Gmail", style = MaterialTheme.typography.titleMedium)
            Text(
                text = "Configure the Gmail account Junction may use for inbox triage and unsubscribe actions. " +
                    "You'll be prompted to grant access the first time it's used.",
                style = MaterialTheme.typography.bodySmall
            )
            JunctionTextField(
                value = gmailAccountEmailInput,
                onValueChange = { gmailAccountEmailInput = it },
                label = "Gmail account email",
                placeholder = "you@gmail.com"
            )
            Button(onClick = {
                scope.launch { userPrefs.setGmailAccountEmail(gmailAccountEmailInput.trim()) }
            }) {
                Text("Save Gmail account")
            }
        }

        item {
            Text(text = "Web destinations", style = MaterialTheme.typography.titleMedium)
            Text(
                text = "Junction may open HTTPS links only for domains you list here. One domain per line.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            JunctionTextField(
                value = allowedWebDomainsInput,
                onValueChange = { allowedWebDomainsInput = it },
                label = "Allowed domains",
                placeholder = "calendar.google.com\napp.slack.com",
                singleLine = false,
                minLines = 3
            )
            Button(onClick = {
                scope.launch {
                    userPrefs.setAllowedWebDomains(
                        allowedWebDomainsInput.lines().map { it.trim() }.filter { it.isNotBlank() }.toSet()
                    )
                }
            }) {
                Text("Save allowed domains")
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
                        text = "Sign in with Google to enable sync and voice mode.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Button(onClick = {
                        val activity = context.findActivity()
                        if (activity == null) {
                            Toast.makeText(context, "Can't sign in from this screen", Toast.LENGTH_SHORT).show()
                        } else {
                            scope.launch {
                                val result = authManager.signInWithGoogle(activity)
                                result.onFailure { ex ->
                                    Toast.makeText(context, "Sign-in failed: ${ex.message}", Toast.LENGTH_LONG).show()
                                }
                            }
                        }
                    }) {
                        Text("Sign in with Google")
                    }
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
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(text = "Proactive digest", style = MaterialTheme.typography.bodyMedium)
                    Text(
                        text = "Show scheduled summaries of new feed items.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Switch(
                    checked = digestEnabled,
                    onCheckedChange = { enabled ->
                        scope.launch {
                            userPrefs.setDigestEnabled(enabled)
                            Scheduler.configureFeedDigest(context, enabled, digestInterval.toLong())
                        }
                    }
                )
            }
            Text(text = "Digest profile", style = MaterialTheme.typography.bodyMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                com.splinch.junction.scheduler.DigestProfile.entries.forEach { profile ->
                    if (profile == digestProfile) {
                        Button(onClick = {}) { Text(profile.label) }
                    } else {
                        OutlinedButton(onClick = {
                            scope.launch { userPrefs.setDigestProfile(profile) }
                        }) { Text(profile.label) }
                    }
                }
            }
            Text(
                text = "Focus includes work, projects, and system items. Personal includes conversations and communities.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(text = "Quiet hours", style = MaterialTheme.typography.bodyMedium)
                    Text(
                        text = "Suppress digest notifications during a local time window.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Switch(
                    checked = digestQuietHours.enabled,
                    onCheckedChange = { enabled ->
                        scope.launch {
                            userPrefs.setDigestQuietHours(
                                enabled,
                                quietStartInput.toIntOrNull() ?: digestQuietHours.startHour,
                                quietEndInput.toIntOrNull() ?: digestQuietHours.endHour
                            )
                        }
                    }
                )
            }
            if (digestQuietHours.enabled) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    JunctionTextField(
                        value = quietStartInput,
                        onValueChange = { quietStartInput = it },
                        label = "Quiet from (0-23)",
                        modifier = Modifier.weight(1f)
                    )
                    JunctionTextField(
                        value = quietEndInput,
                        onValueChange = { quietEndInput = it },
                        label = "Quiet until (0-23)",
                        modifier = Modifier.weight(1f)
                    )
                }
                OutlinedButton(onClick = {
                    scope.launch {
                        userPrefs.setDigestQuietHours(
                            enabled = true,
                            startHour = quietStartInput.toIntOrNull() ?: digestQuietHours.startHour,
                            endHour = quietEndInput.toIntOrNull() ?: digestQuietHours.endHour
                        )
                    }
                }) {
                    Text("Apply quiet hours")
                }
            }
            JunctionTextField(
                value = intervalInput,
                onValueChange = { intervalInput = it },
                label = "Digest interval (minutes)",
                placeholder = "e.g. 30"
            )
            Button(onClick = {
                val parsed = intervalInput.toIntOrNull() ?: 30
                val safe = parsed.coerceAtLeast(15)
                scope.launch {
                    userPrefs.setDigestIntervalMinutes(safe)
                    Scheduler.configureFeedDigest(context, digestEnabled, safe.toLong())
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
            Text(text = "Screen automation", style = MaterialTheme.typography.titleMedium)
            Text(
                text = "Lets Junction read the screen and tap/type on your behalf when you ask it to " +
                    "(e.g. \"reply to this thread\"). Every action still requires your confirmation in chat.",
                style = MaterialTheme.typography.bodyMedium
            )
            Text(
                text = if (accessibilityEnabled) "Accessibility service is enabled." else "Accessibility service is not enabled yet.",
                style = MaterialTheme.typography.bodyMedium
            )
            Button(onClick = {
                context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            }) {
                Text(if (accessibilityEnabled) "Manage accessibility access" else "Enable accessibility access")
            }
        }

        item {
            val alwaysAllowedTools by chatManager.alwaysAllowedTools.collectAsState()
            Text(text = "Always-allow tools", style = MaterialTheme.typography.titleMedium)
            Text(
                text = "Tools you've promoted to auto-execute without a per-call confirmation. " +
                    "Suspended automatically for any turn where untrusted content entered context.",
                style = MaterialTheme.typography.bodyMedium
            )
            if (alwaysAllowedTools.isEmpty()) {
                Text(
                    text = "Nothing promoted yet — check the box on a plan step in chat to promote it.",
                    style = MaterialTheme.typography.bodySmall
                )
            } else {
                alwaysAllowedTools.sorted().forEach { tool ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(text = tool, style = MaterialTheme.typography.bodyMedium)
                        TextButton(onClick = { scope.launch { chatManager.revokeAlwaysAllow(tool) } }) {
                            Text("Revoke")
                        }
                    }
                }
            }
        }

        item {
            val facts by memoryFactDao.allFlow().collectAsState(initial = emptyList())
            Text(text = "Memory", style = MaterialTheme.typography.titleMedium)
            Text(
                text = "Facts Junction has remembered about you (max 200), built forward from conversation. " +
                    "Deleting one here is permanent.",
                style = MaterialTheme.typography.bodyMedium
            )
            Text(
                text = "${facts.size} / 200 remembered",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (facts.isEmpty()) {
                Text(
                    text = "Nothing remembered yet.",
                    style = MaterialTheme.typography.bodySmall
                )
            } else {
                facts.forEach { fact ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = "[${fact.category}] ${fact.content}",
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.weight(1f)
                        )
                        TextButton(onClick = { scope.launch { memoryFactDao.delete(fact.id) } }) {
                            Text("Delete")
                        }
                    }
                }
            }
        }

        item {
            Text(text = "Privileged access", style = MaterialTheme.typography.titleMedium)
            Text(
                text = "Connect to the owner-run Shizuku service. This does not enable any additional Junction actions until a capability is explicitly added and approved.",
                style = MaterialTheme.typography.bodyMedium
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(text = "Enable Shizuku access", style = MaterialTheme.typography.bodyMedium)
                Switch(
                    checked = shizukuEnabled,
                    onCheckedChange = { enabled ->
                        scope.launch { userPrefs.setShizukuEnabled(enabled) }
                    }
                )
            }
            Text(
                text = when (shizukuStatus) {
                    ShizukuStatus.DISABLED -> "Shizuku access is disabled."
                    ShizukuStatus.NOT_RUNNING -> "Shizuku is not running on this device."
                    ShizukuStatus.PERMISSION_REQUIRED -> "Shizuku is running and needs your permission."
                    ShizukuStatus.AVAILABLE -> "Shizuku permission is available."
                },
                style = MaterialTheme.typography.bodyMedium
            )
            if (shizukuStatus == ShizukuStatus.PERMISSION_REQUIRED) {
                Button(onClick = {
                    if (!ShizukuCapability.requestPermission(shizukuEnabled)) {
                        Toast.makeText(context, "Shizuku permission request could not be started.", Toast.LENGTH_SHORT).show()
                    }
                    shizukuStatus = ShizukuCapability.status(shizukuEnabled)
                }) {
                    Text("Grant Shizuku permission")
                }
            }
            if (shizukuEnabled && shizukuStatus != ShizukuStatus.PERMISSION_REQUIRED) {
                TextButton(onClick = {
                    shizukuStatus = ShizukuCapability.status(shizukuEnabled)
                }) {
                    Text("Refresh Shizuku status")
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

private fun android.content.Context.findActivity(): Activity? {
    var ctx = this
    while (ctx is ContextWrapper) {
        if (ctx is Activity) return ctx
        ctx = ctx.baseContext
    }
    return null
}
