package com.splinch.junction.ui

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.splinch.junction.chat.ChatManager
import com.splinch.junction.chat.ChatMessage
import com.splinch.junction.chat.Plan
import com.splinch.junction.chat.Sender
import com.splinch.junction.chat.Step
import com.splinch.junction.chat.StepStatus
import com.splinch.junction.chat.realtime.RealtimeConnectionState
import com.splinch.junction.chat.provider.ModelCatalog
import com.splinch.junction.chat.provider.ProviderDefinition
import com.splinch.junction.chat.tools.RiskTier
import com.splinch.junction.settings.KeyStorage
import com.splinch.junction.settings.ProviderConfig
import com.splinch.junction.ui.components.JunctionTextField
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun ChatScreen(
    chatManager: ChatManager,
    modifier: Modifier = Modifier
) {
    val messages by chatManager.messages.collectAsState()
    val streaming by chatManager.streamingAssistant.collectAsState()
    val activePlan by chatManager.activePlan.collectAsState()
    val connectionState by chatManager.connectionState.collectAsState()
    val speechModeEnabled by chatManager.speechModeEnabled.collectAsState()
    val agentToolsEnabled by chatManager.agentToolsEnabled.collectAsState()
    val micEnabled by chatManager.micEnabled.collectAsState()
    val lastUndo by chatManager.lastUndo.collectAsState()
    var input by remember { mutableStateOf("") }
    var pendingImagePath by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var pendingSpeechEnable by remember { mutableStateOf(false) }
    val sendEnabled = input.isNotBlank() || pendingImagePath != null

    DisposableEffect(Unit) {
        chatManager.setChatVisible(true)
        onDispose { chatManager.setChatVisible(false) }
    }

    val photoPickerLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia()
    ) { uri ->
        if (uri != null) {
            scope.launch {
                val path = withContext(Dispatchers.IO) { copyAndDownscaleImage(context, uri) }
                if (path != null) {
                    pendingImagePath = path
                } else {
                    Toast.makeText(context, "Couldn't load that image", Toast.LENGTH_SHORT).show()
                }
            }
        }
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
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val providerConfig by chatManager.providerConfigFlow.collectAsState(initial = ProviderConfig())
                ProviderSwitcher(
                    providerConfig = providerConfig,
                    onSwitch = { id, modelId -> scope.launch { chatManager.switchProvider(id, modelId) } }
                )
                ConnectionPill(state = connectionState)
            }
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

        val listState = rememberLazyListState()
        // Only auto-follow new content if the user was already at (or very near)
        // the bottom -- otherwise a response streaming in would keep yanking
        // them back down every time they tried to scroll up to read history.
        val isNearBottom by remember {
            derivedStateOf {
                val layoutInfo = listState.layoutInfo
                val lastVisible = layoutInfo.visibleItemsInfo.lastOrNull()
                lastVisible == null || lastVisible.index >= layoutInfo.totalItemsCount - 2
            }
        }
        LaunchedEffect(messages.size, streaming?.content) {
            if (isNearBottom) {
                listState.animateScrollToItem(messages.size)
            }
        }

        LazyColumn(
            state = listState,
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

        val plan = activePlan
        if (plan != null) {
            val alwaysAllowedTools by chatManager.alwaysAllowedTools.collectAsState()
            var selectedForAlwaysAllow by remember(plan.id) { mutableStateOf(setOf<String>()) }
            PlanCard(
                plan = plan,
                alwaysAllowedTools = alwaysAllowedTools,
                selectedForAlwaysAllow = selectedForAlwaysAllow,
                onToggleAlwaysAllow = { tool, checked ->
                    selectedForAlwaysAllow = if (checked) {
                        selectedForAlwaysAllow + tool
                    } else {
                        selectedForAlwaysAllow - tool
                    }
                },
                onApprove = {
                    scope.launch {
                        selectedForAlwaysAllow.forEach { tool -> chatManager.grantAlwaysAllow(tool) }
                        chatManager.approvePlan()
                    }
                },
                onCancel = { scope.launch { chatManager.cancelPlan() } }
            )
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
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            OutlinedButton(
                onClick = { scope.launch { chatManager.stopResponse() } },
                enabled = true
            ) {
                Text("Stop")
            }
            OutlinedButton(
                onClick = { scope.launch { chatManager.regenerateResponse() } },
                enabled = true
            ) {
                Text("Regenerate")
            }
        }

        ChatInputRow(
            text = input,
            onTextChange = { input = it },
            onSend = {
                val trimmed = input.trim()
                if (sendEnabled) {
                    val imagePath = pendingImagePath
                    scope.launch { chatManager.sendUserMessage(trimmed, imagePath) }
                    input = ""
                    pendingImagePath = null
                }
            },
            sendEnabled = sendEnabled,
            pendingImagePath = pendingImagePath,
            onAttachImage = {
                photoPickerLauncher.launch(
                    PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                )
            },
            onRemoveImage = { pendingImagePath = null }
        )
    }
}

@Composable
fun ChatInputRow(
    text: String,
    onTextChange: (String) -> Unit,
    onSend: () -> Unit,
    sendEnabled: Boolean,
    pendingImagePath: String? = null,
    onAttachImage: () -> Unit = {},
    onRemoveImage: () -> Unit = {}
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .imePadding()
            .navigationBarsPadding()
            .padding(horizontal = 12.dp, vertical = 8.dp)
    ) {
        if (pendingImagePath != null) {
            val bitmap = remember(pendingImagePath) {
                BitmapFactory.decodeFile(pendingImagePath)?.asImageBitmap()
            }
            if (bitmap != null) {
                Box(modifier = Modifier.padding(bottom = 8.dp)) {
                    Image(
                        bitmap = bitmap,
                        contentDescription = "Attached image",
                        modifier = Modifier
                            .size(72.dp)
                            .clip(RoundedCornerShape(8.dp)),
                        contentScale = ContentScale.Crop
                    )
                    IconButton(
                        onClick = onRemoveImage,
                        modifier = Modifier
                            .size(24.dp)
                            .align(Alignment.TopEnd)
                            .background(Color.Black.copy(alpha = 0.6f), CircleShape)
                    ) {
                        Icon(
                            Icons.Default.Close,
                            contentDescription = "Remove image",
                            tint = Color.White,
                            modifier = Modifier.size(16.dp)
                        )
                    }
                }
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Bottom
        ) {
            IconButton(onClick = onAttachImage, modifier = Modifier.size(48.dp)) {
                Icon(Icons.Default.Image, contentDescription = "Attach image")
            }

            Spacer(Modifier.width(4.dp))

            JunctionTextField(
                value = text,
                onValueChange = onTextChange,
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 56.dp, max = 160.dp),
                placeholder = "Message Junction…",
                singleLine = false,
                maxLines = 6
            )

            Spacer(Modifier.width(8.dp))

            IconButton(
                onClick = onSend,
                enabled = sendEnabled,
                modifier = Modifier.size(56.dp)
            ) {
                Icon(Icons.Default.Send, contentDescription = "Send")
            }
        }
    }
}

/**
 * Copies a picked photo into app-private storage as a downscaled JPEG --
 * never keeps a reference to the original content:// URI, since the Photo
 * Picker only grants temporary read access to it.
 */
private fun copyAndDownscaleImage(context: android.content.Context, uri: android.net.Uri): String? {
    return runCatching {
        val original = context.contentResolver.openInputStream(uri)?.use { stream ->
            BitmapFactory.decodeStream(stream)
        } ?: return null

        val maxDimension = 1568
        val largestSide = maxOf(original.width, original.height)
        val scale = if (largestSide > maxDimension) maxDimension.toFloat() / largestSide else 1f
        val scaled = if (scale < 1f) {
            Bitmap.createScaledBitmap(
                original,
                (original.width * scale).toInt().coerceAtLeast(1),
                (original.height * scale).toInt().coerceAtLeast(1),
                true
            )
        } else {
            original
        }

        val dir = java.io.File(context.filesDir, "chat_images").apply { mkdirs() }
        val file = java.io.File(dir, "${java.util.UUID.randomUUID()}.jpg")
        java.io.FileOutputStream(file).use { out ->
            scaled.compress(Bitmap.CompressFormat.JPEG, 85, out)
        }
        file.absolutePath
    }.getOrNull()
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

/** Quick switcher between providers the owner has already stored a key for — full setup lives in Settings. */
@Composable
private fun ProviderSwitcher(
    providerConfig: ProviderConfig,
    onSwitch: (providerId: String, modelId: String) -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val keyStorage = remember { KeyStorage(context) }
    var expanded by remember { mutableStateOf(false) }
    var configuredProviders by remember { mutableStateOf(emptyList<ProviderDefinition>()) }

    LaunchedEffect(expanded) {
        if (expanded) {
            configuredProviders = ModelCatalog.providers.filter { keyStorage.getApiKey(it.id).isNotBlank() }
        }
    }

    val currentProvider = ModelCatalog.providerById(providerConfig.providerId)
    val currentModel = currentProvider?.models?.find { it.id == providerConfig.modelId }
        ?: currentProvider?.models?.find { it.id == currentProvider.defaultModelId }
    val currentLabel = when {
        currentProvider != null && currentModel != null -> "${currentProvider.displayName} — ${currentModel.displayName}"
        currentProvider != null -> currentProvider.displayName
        else -> providerConfig.providerId.ifBlank { "Choose AI" }
    }

    Box(modifier = modifier) {
        OutlinedButton(onClick = { expanded = true }) {
            Text(currentLabel, style = MaterialTheme.typography.labelLarge)
            Icon(Icons.Default.ArrowDropDown, contentDescription = "Switch AI provider")
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            if (configuredProviders.isEmpty()) {
                DropdownMenuItem(
                    text = { Text("No providers configured — add one in Settings") },
                    onClick = { expanded = false },
                    enabled = false
                )
            }
            configuredProviders.forEach { provider ->
                val model = provider.models.find { it.id == provider.defaultModelId }
                DropdownMenuItem(
                    text = {
                        Column {
                            Text(provider.displayName)
                            if (model != null) {
                                Text(
                                    text = "${model.displayName} · ${model.costTier}",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    },
                    leadingIcon = if (provider.id == providerConfig.providerId) {
                        { Icon(Icons.Default.Check, contentDescription = null) }
                    } else null,
                    onClick = {
                        expanded = false
                        onSwitch(provider.id, provider.defaultModelId)
                    }
                )
            }
        }
    }
}

/**
 * §2.1 plan-level confirmation with per-step disclosure: the owner sees
 * every step in the plan (including anything TrustGate already blocked)
 * before a single Approve/Cancel decision is made for the whole plan.
 */
@Composable
private fun PlanCard(
    plan: Plan,
    alwaysAllowedTools: Set<String>,
    selectedForAlwaysAllow: Set<String>,
    onToggleAlwaysAllow: (tool: String, checked: Boolean) -> Unit,
    onApprove: () -> Unit,
    onCancel: () -> Unit
) {
    val runnableSteps = plan.steps.count { it.status != StepStatus.BLOCKED }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.secondaryContainer)
            .padding(12.dp)
    ) {
        Text(text = "Proposed plan", style = MaterialTheme.typography.labelLarge)
        Text(text = plan.goal, style = MaterialTheme.typography.bodyMedium)
        if (plan.tainted) {
            Text(
                text = "⚠️ Untrusted content entered context recently — treat with extra care.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.error
            )
            if (!plan.taintSource.isNullOrBlank()) {
                Text(
                    text = "Source: ${plan.taintSource}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.error
                )
            }
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            plan.steps.forEach { step -> PlanStepRow(step, showResolvedPayload = plan.tainted) }
        }
        // §1.5 always-allow promotion: only offered on an untainted plan, one
        // checkbox per distinct tool in it. Granted tools are excluded since
        // there's nothing left to promote.
        if (!plan.tainted) {
            val promotable = plan.steps
                .filter { it.status != StepStatus.BLOCKED }
                .map { it.tool }
                .distinct()
                .filter { it !in alwaysAllowedTools }
            if (promotable.isNotEmpty()) {
                Column(modifier = Modifier.padding(top = 8.dp)) {
                    Text(
                        text = "Always allow without confirming next time:",
                        style = MaterialTheme.typography.labelSmall
                    )
                    promotable.forEach { tool ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(
                                checked = tool in selectedForAlwaysAllow,
                                onCheckedChange = { checked -> onToggleAlwaysAllow(tool, checked) }
                            )
                            Text(text = tool, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Button(onClick = onApprove, enabled = runnableSteps > 0) { Text("Approve plan") }
            OutlinedButton(onClick = onCancel) { Text("Cancel") }
        }
    }
}

@Composable
private fun PlanStepRow(step: Step, showResolvedPayload: Boolean) {
    val (label, color) = when (step.status) {
        StepStatus.BLOCKED -> "Blocked" to MaterialTheme.colorScheme.error
        StepStatus.SKIPPED -> "Skipped" to MaterialTheme.colorScheme.onSurfaceVariant
        StepStatus.FAILED -> "Failed" to MaterialTheme.colorScheme.error
        StepStatus.DONE -> "Done" to MaterialTheme.colorScheme.primary
        StepStatus.RUNNING -> "Running" to MaterialTheme.colorScheme.tertiary
        StepStatus.PENDING -> step.riskTier.name to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = step.summary,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.weight(1f)
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = color
        )
    }
    if (step.status == StepStatus.PENDING &&
        (showResolvedPayload || step.riskTier == RiskTier.OUTBOUND || step.riskTier == RiskTier.DESTRUCTIVE)
    ) {
        Text(
            text = "Payload: ${step.arguments}",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
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
        Column(
            modifier = Modifier
                .sizeIn(maxWidth = 280.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(bubbleColor)
                .padding(12.dp)
        ) {
            message.imagePath?.let { path ->
                val bitmap = remember(path) { BitmapFactory.decodeFile(path)?.asImageBitmap() }
                if (bitmap != null) {
                    Image(
                        bitmap = bitmap,
                        contentDescription = "Attached image",
                        modifier = Modifier
                            .sizeIn(maxWidth = 256.dp, maxHeight = 256.dp)
                            .clip(RoundedCornerShape(8.dp)),
                        contentScale = ContentScale.Fit
                    )
                    if (message.content.isNotBlank()) {
                        Spacer(Modifier.height(8.dp))
                    }
                }
            }
            if (message.content.isNotBlank()) {
                Text(text = message.content, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}
