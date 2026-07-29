package com.splinch.junction.ui

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.splinch.junction.data.ActionLogDao
import com.splinch.junction.data.ActionLogEntity
import com.splinch.junction.data.ModelUsageDao
import com.splinch.junction.data.ModelUsageEntity
import com.splinch.junction.evaluation.ActionAuditEvaluator
import com.splinch.junction.evaluation.ActionAuditMetrics
import com.splinch.junction.evaluation.TelemetryExporter
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.launch

/** Read-only audit and evaluation view. Sensitive action arguments remain in storage only. */
@Composable
fun AuditScreen(
    actionLogDao: ActionLogDao,
    modelUsageDao: ModelUsageDao,
    modifier: Modifier = Modifier
) {
    val entries by actionLogDao.recentFlow().collectAsState(initial = emptyList())
    val modelUsage by modelUsageDao.recentFlow(20).collectAsState(initial = emptyList())
    val metrics = remember(entries) { ActionAuditEvaluator.evaluate(entries) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var exportStatus by remember { mutableStateOf("") }

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
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
                text = "Model usage",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(top = 8.dp)
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
            Text(
                text = "${entry.provider} | ${entry.model}",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                text = "Input ${entry.tokensIn?.toString() ?: "not reported"} | Output ${entry.tokensOut?.toString() ?: "not reported"} | ${entry.latencyMs} ms",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSecondaryContainer
            )
            Text(
                text = "${entry.lane} lane | ${formatTimestamp(entry.timestamp)}",
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