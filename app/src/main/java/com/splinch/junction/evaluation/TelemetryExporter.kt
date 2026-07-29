package com.splinch.junction.evaluation

import android.content.Context
import android.net.Uri
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.time.Instant

/**
 * §5.2 privacy-preserving telemetry. Exports only [ActionAuditMetrics] —
 * approval rates, failure modes, latency, cost — never message content, tool
 * arguments, or anything else that could identify what the owner actually
 * did. Local by default; writing/sharing the file is always an explicit,
 * owner-initiated action (the Export button), never automatic.
 */
object TelemetryExporter {
    fun toJson(metrics: ActionAuditMetrics): String = JSONObject().apply {
        put("exportedAt", Instant.now().toString())
        put("taskCount", metrics.taskCount)
        put("successfulTaskCount", metrics.successfulTaskCount)
        put("taskSuccessRate", metrics.taskSuccessRate)
        put("subgoalCount", metrics.subgoalCount)
        put("successfulSubgoalCount", metrics.successfulSubgoalCount)
        put("subgoalSuccessRate", metrics.subgoalSuccessRate)
        put("postConditionChecks", metrics.postConditionChecks)
        put("postConditionPasses", metrics.postConditionPasses)
        put("postConditionPassRate", metrics.postConditionPassRate)
        put("redundantStepCount", metrics.redundantStepCount)
        put("redundantStepRate", metrics.redundantStepRate)
        put("clarificationCount", metrics.clarificationCount)
        put("clarificationRate", metrics.clarificationRate)
        put("approvalCount", metrics.approvalCount)
        put("approvalRejectedCount", metrics.approvalRejectedCount)
        put("approvalRejectionRate", metrics.approvalRejectionRate)
        put("approvalsPerSuccessfulTask", metrics.approvalsPerSuccessfulTask)
        put("injectionDetectionCount", metrics.injectionDetectionCount)
        put("totalCostEstimateUsd", metrics.totalCostEstimate)
        put("averageLatencyMs", metrics.averageLatencyMs)
        put("p50LatencyMs", metrics.p50LatencyMs)
        put("p95LatencyMs", metrics.p95LatencyMs)
    }.toString(2)

    /** Writes to app-private cache and returns a content:// Uri suitable for a share intent. */
    fun writeExportFile(context: Context, metrics: ActionAuditMetrics): Uri {
        val dir = File(context.cacheDir, "telemetry").apply { mkdirs() }
        val file = File(dir, "junction-telemetry-${System.currentTimeMillis()}.json")
        file.writeText(toJson(metrics))
        return FileProvider.getUriForFile(context, "${context.packageName}.updates", file)
    }
}
