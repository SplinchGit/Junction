package com.splinch.junction.feature.audit.ui

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.splinch.junction.data.database.audit.ActionLogDao
import com.splinch.junction.data.database.audit.ActionLogEntity
import com.splinch.junction.data.database.usage.ModelUsageDao
import com.splinch.junction.data.database.usage.ModelUsageEntity
import com.splinch.junction.data.database.audit.WorldAuditDao
import com.splinch.junction.data.database.audit.WorldAuditEntity
import com.splinch.junction.data.sync.lan.JunctionWorldClient
import com.splinch.junction.evaluation.ActionAuditEvaluator
import com.splinch.junction.evaluation.ActionAuditMetrics
import com.splinch.junction.evaluation.TelemetryExporter
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay

/** Read-only audit and evaluation view. Sensitive action arguments remain in storage only. */
@Composable
fun AuditScreen(
    actionLogDao: ActionLogDao,
    modelUsageDao: ModelUsageDao,
    worldAuditDao: WorldAuditDao,
    junctionWorldClient: JunctionWorldClient,
    modifier: Modifier = Modifier
) {
    val entries by actionLogDao.recentFlow().collectAsState(initial = emptyList())
    val modelUsage by modelUsageDao.recentFlow(20).collectAsState(initial = emptyList())
    val metrics = remember(entries) { ActionAuditEvaluator.evaluate(entries) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var exportStatus by remember { mutableStateOf("") }
    val worldEvents by worldAuditDao.recentFlow().collectAsState(initial = emptyList())
    var worldStatus by remember { mutableStateOf<Map<String, Any?>>(emptyMap()) }
    var worldMessage by remember { mutableStateOf("Checking Junction World…") }
    var worldFilter by remember { mutableStateOf("All") }
    var worldSearch by remember { mutableStateOf("") }
    var heartbeatMinutes by remember { mutableStateOf(15) }
    var worldPaused by remember { mutableStateOf(true) }
    var expandedWorldEvent by remember { mutableStateOf<String?>(null) }
    var worldDraft by remember { mutableStateOf("") }
    var worldChatStatus by remember { mutableStateOf("") }
    var worldChatSending by remember { mutableStateOf(false) }

    fun refreshWorld() {
        scope.launch {
            junctionWorldClient.refresh().onSuccess { status ->
                worldStatus = status
                worldPaused = status["paused"] as? Boolean ?: true
                heartbeatMinutes = (status["heartbeatMinutes"] as? Number)?.toInt()?.coerceIn(10, 120) ?: 15
                worldMessage = "Updated just now"
            }.onFailure { worldMessage = it.message?.take(160) ?: "Junction World is unavailable" }
        }
    }
    LaunchedEffect(Unit) {
        refreshWorld()
        while (true) {
            delay(30_000)
            refreshWorld()
        }
    }

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            JunctionWorldPanel(
                status = worldStatus,
                message = worldMessage,
                paused = worldPaused,
                heartbeatMinutes = heartbeatMinutes,
                actionsToday = worldEvents.count { it.timestamp >= java.time.LocalDate.now().atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli() && it.category in setOf("ACTION", "PROJECT_FILE", "RESEARCH") },
                recentErrors = worldEvents.count { it.timestamp >= System.currentTimeMillis() - 24 * 60 * 60_000L && it.category == "ERROR" },
                recentDenials = worldEvents.count { it.timestamp >= System.currentTimeMillis() - 24 * 60 * 60_000L && it.category == "SECURITY_DENIAL" },
                lastWake = worldEvents.firstOrNull { it.category == "WAKE" }?.timestamp,
                workspaceFreeBytes = worldEvents.firstNotNullOfOrNull { it.workspaceFreeBytes },
                onRefresh = ::refreshWorld,
                onPauseChange = { pause ->
                    scope.launch {
                        junctionWorldClient.setControls(pause, heartbeatMinutes).onSuccess { worldStatus = it; worldPaused = pause; worldMessage = "Control updated" }
                            .onFailure { worldMessage = it.message?.take(160) ?: "Control update failed" }
                    }
                },
                onHeartbeatChange = { minutes ->
                    scope.launch {
                        junctionWorldClient.setControls(worldPaused, minutes).onSuccess { worldStatus = it; heartbeatMinutes = minutes; worldMessage = "Heartbeat set to $minutes minutes" }
                            .onFailure { worldMessage = it.message?.take(160) ?: "Heartbeat update failed" }
                    }
                }
            )
        }
        item {
            Text("Junction World activity", style = MaterialTheme.typography.titleMedium)
            Text("Host-validated events from the isolated Debian environment. Action results are shown only after guest runtime confirmation.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(value = worldSearch, onValueChange = { worldSearch = it.take(120) }, label = { Text("Search activity") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("All", "Goals", "Thoughts", "Actions", "Research", "Communication", "Errors", "Security", "System").forEach { filter ->
                    FilterChip(selected = worldFilter == filter, onClick = { worldFilter = filter }, label = { Text(filter) })
                }
            }
        }
        item {
            JunctionWorldChat(
                events = worldEvents.filter { it.category == "COMMUNICATION" && it.conversationId == JunctionWorldClient.WORLD_CONVERSATION_ID }.sortedBy { it.timestamp }.takeLast(40),
                draft = worldDraft,
                onDraftChange = { worldDraft = it.take(2_800) },
                status = worldChatStatus,
                sending = worldChatSending,
                paused = worldPaused,
                onSend = {
                    if (!worldChatSending && worldDraft.isNotBlank()) scope.launch {
                        worldChatSending = true
                        junctionWorldClient.sendMessage(worldDraft).onSuccess { receipt ->
                            worldDraft = ""
                            worldChatStatus = if (receipt.status == "QUEUED") "Queued for Junction World." else "Message already delivered."
                            refreshWorld()
                        }.onFailure { worldChatStatus = it.message?.take(160) ?: "Message could not be sent." }
                        worldChatSending = false
                    }
                }
            )
        }
        val filteredWorldEvents = worldEvents.filter { worldMatches(it, worldFilter, worldSearch) }
        if (filteredWorldEvents.isEmpty()) item {
            Text(if (worldEvents.isEmpty()) "No Junction World events received yet." else "No activity matches this filter.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else items(filteredWorldEvents, key = { "world-${it.sequence}" }) { entry ->
            WorldAuditEntry(entry, expanded = expandedWorldEvent == entry.id, onExpand = { expandedWorldEvent = if (expandedWorldEvent == entry.id) null else entry.id })
        }
        item {
            Text(text = "Action audit", style = MaterialTheme.typography.titleLarge)
            Text(
                text = "Recent outcomes and evaluation signals. Sensitive action payloads are not displayed here.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        item { AuditMetricsSummary(metrics) }
        item {
            // §5.2 explicit, reviewable export — aggregate metrics only, never
            // message content or tool arguments. The share sheet is the
            // review step: the owner picks where it goes, or nowhere.
            OutlinedButton(onClick = {
                scope.launch {
                    val fullMetrics = ActionAuditEvaluator.evaluate(actionLogDao.allOnce())
                    val uri = TelemetryExporter.writeExportFile(context, fullMetrics)
                    val intent = Intent(Intent.ACTION_SEND).apply {
                        type = "application/json"
                        putExtra(Intent.EXTRA_STREAM, uri)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    context.startActivity(Intent.createChooser(intent, "Export telemetry"))
                    exportStatus = "Exported aggregate metrics only — no message content or tool arguments."
                }
            }) {
                Text("Export telemetry")
            }
            if (exportStatus.isNotBlank()) {
                Text(
                    text = exportStatus,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
        item {
            Text(
                text = "Model activity",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(top = 8.dp)
            )
            Text(
                text = "Shows whether each model response requested a real tool. Thinking text stays private; only its availability and size are shown.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        if (modelUsage.isEmpty()) {
            item {
                Text(
                    text = "No provider-reported usage is available yet.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        } else {
            item { ModelUsageSummary(modelUsage) }
            items(modelUsage, key = { it.id }) { entry -> ModelUsageEntry(entry) }
        }
        item {
            Text(
                text = "Recent actions",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(top = 8.dp)
            )
        }
        if (entries.isEmpty()) {
            item {
                Text(
                    text = "No actions have been evaluated in this install yet.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        } else {
            items(entries, key = { it.id }) { entry -> AuditEntry(entry) }
        }
    }
}

@Composable
private fun JunctionWorldPanel(
    status: Map<String, Any?>,
    message: String,
    paused: Boolean,
    heartbeatMinutes: Int,
    actionsToday: Int,
    recentErrors: Int,
    recentDenials: Int,
    lastWake: Long?,
    workspaceFreeBytes: Long?,
    onRefresh: () -> Unit,
    onPauseChange: (Boolean) -> Unit,
    onHeartbeatChange: (Int) -> Unit
) {
    var heartbeatDraft by remember(heartbeatMinutes) { mutableStateOf(heartbeatMinutes.toString()) }
    val state = status["state"]?.toString()?.take(24) ?: "OFFLINE"
    val currentGoal = status["currentGoal"]?.toString()?.take(180) ?: "No active goal"
    val activity = status["activity"]?.toString()?.take(180) ?: "Waiting for guest status"
    Card(shape = androidx.compose.foundation.shape.RoundedCornerShape(10.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Junction World", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(if (status.isEmpty()) "OFFLINE" else if (paused) "PAUSED" else state, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
            }
            Text("Goal: $currentGoal", style = MaterialTheme.typography.bodySmall)
            Text("Activity: $activity", style = MaterialTheme.typography.bodySmall)
            val uptime = (status["uptimeSeconds"] as? Number)?.toLong()
            val disk = workspaceFreeBytes ?: (status["workspaceFreeBytes"] as? Number)?.toLong()
            val wake = status["nextWakeAt"]?.toString()?.take(32)
            Text("Uptime: ${uptime?.let { "${it / 3600}h ${it % 3600 / 60}m" } ?: "—"}  •  Workspace free: ${disk?.let { String.format(Locale.US, "%.1f GB", it / 1_000_000_000.0) } ?: "—"}", style = MaterialTheme.typography.labelSmall)
            Text("Last wake: ${lastWake?.let(::formatTimestamp) ?: "—"}  •  Next wake: ${wake ?: "—"}  •  Heartbeat: $heartbeatMinutes min", style = MaterialTheme.typography.labelSmall)
            Text("Actions today: $actionsToday  •  Errors (24h): $recentErrors  •  Security denials (24h): $recentDenials", style = MaterialTheme.typography.labelSmall)
            Text(message, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { onPauseChange(!paused) }) { Text(if (paused) "Resume" else "Pause") }
                OutlinedButton(onClick = onRefresh) { Text("Refresh") }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = heartbeatDraft,
                    onValueChange = { value -> if (value.length <= 3 && value.all(Char::isDigit)) heartbeatDraft = value },
                    label = { Text("Heartbeat minutes") },
                    supportingText = { Text("10 to 120 minutes") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.weight(1f)
                )
                val parsedHeartbeat = heartbeatDraft.toIntOrNull()
                Button(onClick = { parsedHeartbeat?.let(onHeartbeatChange) }, enabled = parsedHeartbeat?.let { it in 10..120 } == true) { Text("Save") }
            }
        }
    }
}

private fun worldMatches(event: WorldAuditEntity, filter: String, query: String): Boolean {
    val categoryMatch = when (filter) {
        "Goals" -> event.category.startsWith("GOAL_")
        "Thoughts" -> event.category in setOf("REFLECTION", "INTENTION")
        "Actions" -> event.category in setOf("ACTION", "RESULT", "PROJECT_FILE")
        "Research" -> event.category == "RESEARCH"
        "Communication" -> event.category == "COMMUNICATION"
        "Errors" -> event.category in setOf("ERROR", "RESOURCE_WARNING")
        "Security" -> event.category == "SECURITY_DENIAL"
        "System" -> event.category in setOf("WAKE", "SLEEP", "SYSTEM")
        else -> true
    }
    val needle = query.trim().lowercase()
    return categoryMatch && (needle.isBlank() || "${event.category} ${event.summary} ${event.details.orEmpty()}".lowercase().contains(needle))
}

@Composable
private fun JunctionWorldChat(
    events: List<WorldAuditEntity>,
    draft: String,
    onDraftChange: (String) -> Unit,
    status: String,
    sending: Boolean,
    paused: Boolean,
    onSend: () -> Unit
) {
    Card(shape = androidx.compose.foundation.shape.RoundedCornerShape(10.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Talk to Junction World", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text("Messages stay in this app and the VM communication audit. They are not added to Junction's Firebase chat sync.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (events.isEmpty()) Text("No messages yet.", style = MaterialTheme.typography.bodySmall)
            events.forEach { event ->
                val fromJunction = event.communicationDirection == "AGENT_TO_OWNER"
                Card(colors = CardDefaults.cardColors(containerColor = if (fromJunction) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface)) {
                    Column(Modifier.fillMaxWidth().padding(10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(if (fromJunction) "Junction" else "You", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                        Text(event.details.orEmpty().take(4_000), style = MaterialTheme.typography.bodyMedium)
                        Text(formatTimestamp(event.timestamp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            OutlinedTextField(value = draft, onValueChange = onDraftChange, label = { Text("Message Junction") }, modifier = Modifier.fillMaxWidth(), minLines = 2, maxLines = 5)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(if (paused) "Paused: messages queue until resumed" else status, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                Button(onClick = onSend, enabled = !sending && draft.isNotBlank()) {
                    if (sending) CircularProgressIndicator(modifier = Modifier.padding(end = 8.dp), strokeWidth = 2.dp)
                    Text(if (sending) "Sending" else "Send")
                }
            }
            if (!paused && status.isNotBlank()) Text(status, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun WorldAuditEntry(event: WorldAuditEntity, expanded: Boolean, onExpand: () -> Unit) {
    Card(onClick = onExpand, shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(event.category.replace('_', ' '), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = if (event.category == "SECURITY_DENIAL" || event.category == "ERROR") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
                Text(formatTimestamp(event.timestamp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(event.summary, style = MaterialTheme.typography.bodyMedium)
            if (expanded) {
                event.details?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                event.actionStatus?.let { Text("Runtime status: $it", style = MaterialTheme.typography.labelSmall) }
                event.durationMs?.let { Text("Duration: ${it} ms", style = MaterialTheme.typography.labelSmall) }
                event.memoryUsedBytes?.let { Text("Guest memory used: ${String.format(Locale.US, "%.0f MiB", it / 1_048_576.0)}", style = MaterialTheme.typography.labelSmall) }
                event.cpuPercent?.let { Text("Guest CPU: ${String.format(Locale.US, "%.1f%%", it)}", style = MaterialTheme.typography.labelSmall) }
            }
        }
    }
}

@Composable
private fun ModelUsageSummary(entries: List<ModelUsageEntity>) {
    val tokens = entries.sumOf { (it.tokensIn ?: 0) + (it.tokensOut ?: 0) }
    val toolRuns = entries.count { it.toolCallsRequested > 0 }
    Card(
        shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            UsageTotal(entries.size.toString(), "Runs")
            UsageTotal(tokens.toString(), "Tokens")
            UsageTotal(toolRuns.toString(), "With tools")
        }
    }
}

@Composable
private fun UsageTotal(value: String, label: String) {
    Column {
        Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ModelUsageEntry(entry: ModelUsageEntity) {
    Card(
        shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(3.dp)
        ) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(
                    text = "${entry.provider} | ${entry.model}",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = when {
                        !entry.telemetryCaptured -> "OLDER RUN"
                        entry.toolCallsRequested == 0 -> "NO TOOLS"
                        entry.toolsExecuted -> "TOOLS USED"
                        entry.approvalRequired -> "APPROVAL NEEDED"
                        else -> "TOOLS REQUESTED"
                    },
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                    color = if (entry.toolCallsRequested > 0) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSecondaryContainer
                )
            }
            Text(
                text = if (!entry.telemetryCaptured) {
                    "Tool telemetry was not recorded for this older run."
                } else if (entry.toolCallsRequested > 0) {
                    "${entry.toolCallsRequested} request${if (entry.toolCallsRequested == 1) "" else "s"}: ${entry.toolNames.ifBlank { "unknown tool" }}"
                } else if (entry.toolsAvailable) {
                    "Tools were available, but the model answered without requesting one."
                } else {
                    "This historical run did not expose tools to the model."
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSecondaryContainer
            )
            Text(
                text = "Thinking: ${if (!entry.telemetryCaptured) "not recorded" else if (entry.thinkingReported) "reported (${entry.thinkingCharacters} chars)" else "not reported"} | Input ${entry.tokensIn ?: "—"} | Output ${entry.tokensOut ?: "—"}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSecondaryContainer
            )
            Text(
                text = "${entry.latencyMs} ms | ${formatTimestamp(entry.timestamp)}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSecondaryContainer
            )
        }
    }
}

@Composable
private fun AuditMetricsSummary(metrics: ActionAuditMetrics) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        AuditMetricRow("Task success", "${metrics.successfulTaskCount}/${metrics.taskCount}")
        AuditMetricRow("Subgoal success", "${metrics.successfulSubgoalCount}/${metrics.subgoalCount}")
        AuditMetricRow("Postconditions", "${metrics.postConditionPasses}/${metrics.postConditionChecks}")
        AuditMetricRow("Injection detections", metrics.injectionDetectionCount.toString())
        AuditMetricRow("Approvals declined", "${metrics.approvalRejectedCount}/${metrics.approvalCount}")
        AuditMetricRow("Average latency", metrics.averageLatencyMs?.let { "${it} ms" } ?: "No completed actions")
        AuditMetricRow("Estimated cost", String.format(Locale.US, "$%.4f", metrics.totalCostEstimate))
    }
}

@Composable
private fun AuditMetricRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(text = label, style = MaterialTheme.typography.bodyMedium)
        Text(text = value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun AuditEntry(entry: ActionLogEntity) {
    Card(
        shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(3.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(text = entry.toolName, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                Text(text = entry.decision.replace('_', ' '), style = MaterialTheme.typography.labelMedium)
            }
            Text(
                text = listOfNotNull(
                    entry.outcome?.replaceFirstChar { it.uppercase() },
                    entry.postConditionPassed?.let { if (it) "Postcondition passed" else "Postcondition failed" }
                ).joinToString(" | ").ifBlank { "Awaiting outcome" },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = "${entry.effectiveTier.lowercase()} risk | ${entry.triggerProvenance.lowercase()} trigger | ${formatTimestamp(entry.timestamp)}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            entry.blockReason?.let { reason ->
                Text(
                    text = "Blocked: $reason",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.error
                )
            }
        }
    }
}

private fun formatTimestamp(timestamp: Long): String = DateTimeFormatter
    .ofPattern("MMM d, HH:mm", Locale.getDefault())
    .withZone(ZoneId.systemDefault())
    .format(Instant.ofEpochMilli(timestamp))
