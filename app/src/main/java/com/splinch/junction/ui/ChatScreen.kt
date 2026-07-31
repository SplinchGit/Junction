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
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import com.splinch.junction.ui.components.BluetoothThrower
import com.splinch.junction.ui.components.JunctionTextField
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Pixel offset applied when scrolling to the last message. Scrolling to an
 * index alone aligns that item's *top* with the top of the viewport, so a
 * reply taller than the screen would pin to its first line and stay there
 * while the rest streamed in off-screen. A large offset asks to scroll well
 * past the item's start; LazyColumn clamps it to the true maximum scroll, so
 * the effect is "pin to the bottom" for tall and short messages alike.
 */
private const val BOTTOM_SCROLL_OFFSET = 100_000

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
    val voiceListening by chatManager.localVoiceListening.collectAsState()
    val voiceSpeaking by chatManager.localVoiceSpeaking.collectAsState()
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

    Column(modifier = modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 10.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = "Chat",
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                val providerConfig by chatManager.providerConfigFlow.collectAsState(initial = ProviderConfig())
                ProviderSwitcher(
                    providerConfig = providerConfig,
                    onSwitch = { id, modelId -> scope.launch { chatManager.switchProvider(id, modelId) } }
                )
                BluetoothThrower()
                ConnectionPill(state = connectionState)
            }
        }

        // Single compact toolbar replaces four stacked toggle rows -- keeps the
        // message list from being squeezed to nothing when the keyboard opens.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            FilterChip(
                selected = speechModeEnabled,
                onClick = {
                    if (!speechModeEnabled) {
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
                },
                label = { Text("Voice") },
                leadingIcon = {
                    Icon(
                        imageVector = if (speechModeEnabled) Icons.Default.Mic else Icons.Default.MicOff,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                }
            )
            FilterChip(
                selected = agentToolsEnabled,
                onClick = { scope.launch { chatManager.setAgentToolsEnabled(!agentToolsEnabled) } },
                label = { Text("Tools") },
                leadingIcon = { Icon(Icons.Default.Build, contentDescription = null, modifier = Modifier.size(18.dp)) }
            )
            if (speechModeEnabled) {
                FilterChip(
                    selected = micEnabled,
                    onClick = {
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
                    },
                    label = { Text(callStatusLabel(micEnabled, voiceListening, voiceSpeaking)) },
                    leadingIcon = {
                        Icon(
                            imageVector = if (micEnabled) Icons.Default.Mic else Icons.Default.MicOff,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                )
            }
            Spacer(Modifier.weight(1f))
            IconButton(onClick = { scope.launch { chatManager.stopResponse() } }, modifier = Modifier.size(36.dp)) {
                Icon(imageVector = Icons.Default.Stop, contentDescription = "Stop")
            }
            IconButton(onClick = { scope.launch { chatManager.regenerateResponse() } }, modifier = Modifier.size(36.dp)) {
                Icon(imageVector = Icons.Default.Refresh, contentDescription = "Regenerate")
            }
            // History management was reachable only by typing /clear, which is
            // undiscoverable on a phone. Same actions, surfaced.
            var historyMenuOpen by remember { mutableStateOf(false) }
            Box {
                IconButton(
                    onClick = { historyMenuOpen = true },
                    modifier = Modifier.size(36.dp)
                ) {
                    Icon(imageVector = Icons.Default.MoreVert, contentDescription = "Chat history options")
                }
                DropdownMenu(
                    expanded = historyMenuOpen,
                    onDismissRequest = { historyMenuOpen = false }
                ) {
                    DropdownMenuItem(
                        text = { Text("Keep last ${ChatManager.DEFAULT_TRIM_KEEP} messages") },
                        onClick = {
                            historyMenuOpen = false
                            scope.launch { chatManager.trimHistory() }
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("Clear chat") },
                        onClick = {
                            historyMenuOpen = false
                            scope.launch { chatManager.clearSession() }
                        }
                    )
                }
            }
        }

        val listState = rememberLazyListState()
        // The streaming bubble is only an item when something is actually
        // streaming. It used to be an unconditional item{} wrapping an if,
        // which left a permanent zero-height row on the end -- so the scroll
        // target was that empty row rather than the last real message, and
        // every index calculation below was quietly off by one.
        val itemCount = messages.size + if (streaming != null) 1 else 0
        val lastIndex = (itemCount - 1).coerceAtLeast(0)

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

        // Opening the chat lands on the newest message. Previously the only
        // scroll was the animated follow below, which meant arriving with a
        // long history dropped you at the very top with the whole conversation
        // to scroll through. This jumps without animating, so a long history
        // doesn't visibly race past on the way down.
        var hasSnappedToBottom by remember { mutableStateOf(false) }
        LaunchedEffect(itemCount) {
            if (!hasSnappedToBottom && itemCount > 0) {
                listState.scrollToItem(lastIndex, BOTTOM_SCROLL_OFFSET)
                hasSnappedToBottom = true
            }
        }

        LaunchedEffect(itemCount, streaming?.content) {
            if (hasSnappedToBottom && isNearBottom && itemCount > 0) {
                listState.animateScrollToItem(lastIndex, BOTTOM_SCROLL_OFFSET)
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
            items(messages, key = { it.id }) { message ->
                MessageBubble(message)
            }
            streaming?.let { active ->
                item(key = active.itemId) {
                    MessageBubble(
                        message = ChatMessage(
                            id = active.itemId,
                            timestamp = Instant.now(),
                            sender = Sender.ASSISTANT,
                            content = active.content
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

/**
 * What the call is doing this second.
 *
 * A chip reading "Mic on" while nothing is actually listening is the illusion that makes
 * voice feel broken, so the label follows the audio rather than the switch. Falls back to
 * "Mic on" between turns and on the Realtime backend, which drives its own audio and
 * reports neither state -- never claiming more than is known.
 */
private fun callStatusLabel(micEnabled: Boolean, listening: Boolean, speaking: Boolean): String = when {
    !micEnabled -> "Mic muted"
    speaking -> "Speaking"
    listening -> "Listening"
    else -> "Mic on"
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
    // Header pill stays short (provider name only) so it never crowds out the
    // screen title; the full "Provider — Model" detail still appears in the
    // dropdown below and in the switch-confirmation chat message.
    val currentLabel = currentProvider?.displayName ?: providerConfig.providerId.ifBlank { "Choose AI" }

    Box(modifier = modifier) {
        OutlinedButton(
            onClick = { expanded = true },
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
        ) {
            Text(
                text = currentLabel,
                style = MaterialTheme.typography.labelMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = 96.dp)
            )
            Icon(
                Icons.Default.ArrowDropDown,
                contentDescription = "Switch AI provider",
                modifier = Modifier.size(18.dp)
            )
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
