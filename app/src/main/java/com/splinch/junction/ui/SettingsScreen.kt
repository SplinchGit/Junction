package com.splinch.junction.ui

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import com.splinch.junction.feed.FeedRepository
import com.splinch.junction.settings.UserPrefsRepository
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(
    userPrefs: UserPrefsRepository,
    feedRepository: FeedRepository,
    modifier: Modifier = Modifier
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    val useBackend by userPrefs.useHttpBackendFlow.collectAsState(initial = false)
    val apiBaseUrl by userPrefs.apiBaseUrlFlow.collectAsState(initial = "")
    val digestInterval by userPrefs.digestIntervalMinutesFlow.collectAsState(initial = 30)
    val notificationAck by userPrefs.notificationAccessAcknowledgedFlow.collectAsState(initial = false)
    val listenerEnabled by userPrefs.notificationListenerEnabledFlow.collectAsState(initial = false)
    val disabledPackages by userPrefs.disabledPackagesFlow.collectAsState(initial = emptySet())

    var apiBaseUrlInput by remember { mutableStateOf(apiBaseUrl) }
    var intervalInput by remember { mutableStateOf(digestInterval.toString()) }
    var understandChecked by remember { mutableStateOf(false) }
    var packages by remember { mutableStateOf(emptyList<String>()) }

    LaunchedEffect(apiBaseUrl) {
        apiBaseUrlInput = apiBaseUrl
    }

    LaunchedEffect(digestInterval) {
        intervalInput = digestInterval.toString()
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
                scope.launch { userPrefs.setApiBaseUrl(apiBaseUrlInput.trim()) }
            }) {
                Text("Save API URL")
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

        if (packages.isNotEmpty()) {
            item {
                Text(
                    text = "App filters",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = "Disable apps you don’t want in your Junction feed.",
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
