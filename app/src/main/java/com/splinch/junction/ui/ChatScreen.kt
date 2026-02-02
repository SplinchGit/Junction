package com.splinch.junction.ui

import android.Manifest
import android.content.pm.PackageManager
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.splinch.junction.chat.ChatManager
import com.splinch.junction.chat.ChatMessage
import com.splinch.junction.chat.PendingToolCall
import com.splinch.junction.chat.Sender
import com.splinch.junction.chat.realtime.RealtimeConnectionState
import com.splinch.junction.sync.firebase.AuthManager
import java.time.Instant
import kotlinx.coroutines.launch

@Composable
fun ChatScreen(
    chatManager: ChatManager,
    authManager: AuthManager,
    modifier: Modifier = Modifier
) {
    val messages by chatManager.messages.collectAsState()
    val streaming by chatManager.streamingAssistant.collectAsState()
    val pendingTools by chatManager.pendingToolCalls.collectAsState()
    val connectionState by chatManager.connectionState.collectAsState()
    val speechModeEnabled by chatManager.speechModeEnabled.collectAsState()
    val agentToolsEnabled by chatManager.agentToolsEnabled.collectAsState()
    val micEnabled by chatManager.micEnabled.collectAsState()
    val lastUndo by chatManager.lastUndo.collectAsState()
    val user by authManager.userFlow.collectAsState()

    var input by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val activity = context as? android.app.Activity
    var pendingSpeechEnable by remember { mutableStateOf(false) }
    var authError by remember { mutableStateOf<String?>(null) }

    DisposableEffect(Unit) {
        chatManager.setChatVisible(true)
        onDispose { chatManager.setChatVisible(false) }
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            if (pendingSpeechEnable) {
                scope.launch { chatManager.setSpeechMode(true) }
            } else {
                chatManager.setMicEnabled(true)
            }
        } else {
            Toast.makeText(context, "Microphone permission denied", Toast.LENGTH_SHORT).show()
        }
        pendingSpeechEnable = false
    }

    LaunchedEffect(speechModeEnabled) {
        if (!speechModeEnabled && micEnabled) {
            chatManager.setMicEnabled(false)
        }
    }

    Column(modifier = modifier.fillMaxSize().padding(16.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = "JunctionGPT",
                style = MaterialTheme.typography.titleLarge
            )
            ConnectionPill(state = connectionState)
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column {
                Text(text = "Speech mode", style = MaterialTheme.typography.bodyMedium)
                Text(
                    text = if (speechModeEnabled) "Continuous voice" else "Text only",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Switch(
                checked = speechModeEnabled,
                onCheckedChange = { enabled ->
                    if (enabled) {
                        val granted = ContextCompat.checkSelfPermission(
                            context,
                            Manifest.permission.RECORD_AUDIO
                        ) == PackageManager.PERMISSION_GRANTED
                        if (granted) {
                            scope.launch { chatManager.setSpeechMode(true) }
                        } else {
                            pendingSpeechEnable = true
                            permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                        }
                    } else {
                        scope.launch { chatManager.setSpeechMode(false) }
                    }
                }
            )
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column {
                Text(text = "Agent tools", style = MaterialTheme.typography.bodyMedium)
                Text(
                    text = if (agentToolsEnabled) "Actions with confirmation" else "Tools disabled",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Switch(
                checked = agentToolsEnabled,
                onCheckedChange = { enabled ->
                    scope.launch { chatManager.setAgentToolsEnabled(enabled) }
                }
            )
        }

        if (speechModeEnabled) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = {
                        val granted = ContextCompat.checkSelfPermission(
                            context,
                            Manifest.permission.RECORD_AUDIO
                        ) == PackageManager.PERMISSION_GRANTED
                        if (micEnabled) {
                            chatManager.setMicEnabled(false)
                        } else if (granted) {
                            chatManager.setMicEnabled(true)
                        } else {
                            permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                        }
                    }) {
                        Icon(
                            imageVector = if (micEnabled) Icons.Default.Mic else Icons.Default.MicOff,
                            contentDescription = if (micEnabled) "Mute mic" else "Unmute mic"
                        )
                    }
                    Text(
                        text = if (micEnabled) "Mic on" else "Mic muted",
                        style = MaterialTheme.typography.bodySmall
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    IconButton(onClick = { scope.launch { chatManager.stopResponse() } }) {
                        Icon(imageVector = Icons.Default.Stop, contentDescription = "Stop")
                    }
                    IconButton(onClick = { scope.launch { chatManager.regenerateResponse() } }) {
                        Icon(imageVector = Icons.Default.Refresh, contentDescription = "Regenerate")
                    }
                }
            }
        }

        if (user == null) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = "Sign in to start a Realtime session.",
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center
                )
                Button(
                    onClick = {
                        if (activity != null) {
                            authError = null
                            scope.launch {
                                val result = authManager.signInWithGoogle(activity)
                                if (result.isFailure) {
                                    authError = result.exceptionOrNull()?.message ?: "Sign-in failed"
                                }
                            }
                        }
                    },
                    modifier = Modifier.padding(top = 8.dp)
                ) {
                    Text("Sign in with Google")
                }
                if (!authError.isNullOrBlank()) {
                    Text(
                        text = authError.orEmpty(),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(top = 6.dp)
                    )
                }
            }
        }

        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(top = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(messages) { message ->
                MessageBubble(message)
            }
            item {
                if (streaming != null) {
                    MessageBubble(
                        message = ChatMessage(
                            id = streaming!!.itemId,
                            timestamp = Instant.now(),
                            sender = Sender.ASSISTANT,
                            content = streaming!!.content
                        )
                    )
                }
            }
        }

        if (pendingTools.isNotEmpty()) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                pendingTools.forEach { call ->
                    PendingToolCard(
                        call = call,
                        onApply = { scope.launch { chatManager.applyToolCall(call.callId) } },
                        onCancel = { scope.launch { chatManager.cancelToolCall(call.callId) } }
                    )
                }
            }
        }

        if (lastUndo != null) {
            TextButton(
                onClick = { scope.launch { chatManager.undoLast() } },
                modifier = Modifier.padding(top = 6.dp)
            ) {
                Text(lastUndo?.label ?: "Undo")
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            OutlinedTextField(
                value = input,
                onValueChange = { input = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text("Type a message") },
                enabled = user != null
            )
            OutlinedButton(
                onClick = { scope.launch { chatManager.stopResponse() } },
                enabled = user != null
            ) {
                Text("Stop")
            }
            OutlinedButton(
                onClick = { scope.launch { chatManager.regenerateResponse() } },
                enabled = user != null
            ) {
                Text("Regenerate")
            }
            Button(
                onClick = {
                    val trimmed = input.trim()
                    if (trimmed.isNotEmpty()) {
                        scope.launch { chatManager.sendUserMessage(trimmed) }
                        input = ""
                    }
                },
                enabled = user != null && input.trim().isNotEmpty()
            ) {
                Text("Send")
            }
        }
    }
}

@Composable
private fun ConnectionPill(state: RealtimeConnectionState) {
    val color = when (state) {
        RealtimeConnectionState.CONNECTED -> MaterialTheme.colorScheme.primary
        RealtimeConnectionState.CONNECTING -> MaterialTheme.colorScheme.tertiary
        RealtimeConnectionState.FAILED -> MaterialTheme.colorScheme.error
        RealtimeConnectionState.DISCONNECTED -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    val label = when (state) {
        RealtimeConnectionState.CONNECTED -> "Online"
        RealtimeConnectionState.CONNECTING -> "Connecting"
        RealtimeConnectionState.FAILED -> "Offline"
        RealtimeConnectionState.DISCONNECTED -> "Idle"
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(50))
                .background(color)
                .sizeIn(minWidth = 8.dp, minHeight = 8.dp)
        )
        Text(
            text = " $label",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun PendingToolCard(
    call: PendingToolCall,
    onApply: () -> Unit,
    onCancel: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.secondaryContainer)
            .padding(12.dp)
    ) {
        Text(text = "Proposed change", style = MaterialTheme.typography.labelLarge)
        Text(text = call.summary, style = MaterialTheme.typography.bodyMedium)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Button(onClick = onApply) { Text("Apply") }
            OutlinedButton(onClick = onCancel) { Text("Cancel") }
        }
    }
}

@Composable
private fun MessageBubble(message: ChatMessage) {
    val isUser = message.sender == Sender.USER
    val bubbleColor = when (message.sender) {
        Sender.USER -> MaterialTheme.colorScheme.primaryContainer
        Sender.ASSISTANT -> MaterialTheme.colorScheme.secondaryContainer
        Sender.SYSTEM -> MaterialTheme.colorScheme.surfaceVariant
    }

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
    ) {
        Box(
            modifier = Modifier
                .sizeIn(maxWidth = 280.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(bubbleColor)
                .padding(12.dp)
        ) {
            Text(text = message.content, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
