package com.splinch.junction.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
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
import androidx.compose.ui.unit.dp
import com.splinch.junction.scheduler.Scheduler
import com.splinch.junction.settings.SettingsRepository
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(settingsRepository: SettingsRepository, modifier: Modifier = Modifier) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    val useBackend by settingsRepository.useHttpBackendFlow.collectAsState(initial = false)
    val apiBaseUrl by settingsRepository.apiBaseUrlFlow.collectAsState(initial = "")
    val digestInterval by settingsRepository.digestIntervalMinutesFlow.collectAsState(initial = 30)

    var apiBaseUrlInput by remember { mutableStateOf(apiBaseUrl) }
    var intervalInput by remember { mutableStateOf(digestInterval.toString()) }

    LaunchedEffect(apiBaseUrl) {
        apiBaseUrlInput = apiBaseUrl
    }

    LaunchedEffect(digestInterval) {
        intervalInput = digestInterval.toString()
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(text = "Settings", style = MaterialTheme.typography.titleLarge)

        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(text = "Use HTTP backend", style = MaterialTheme.typography.bodyMedium)
            Switch(
                checked = useBackend,
                onCheckedChange = { enabled ->
                    scope.launch { settingsRepository.setUseHttpBackend(enabled) }
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
            scope.launch { settingsRepository.setApiBaseUrl(apiBaseUrlInput.trim()) }
        }) {
            Text("Save API URL")
        }

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
                settingsRepository.setDigestIntervalMinutes(safe)
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
}
