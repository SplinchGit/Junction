package com.splinch.junction.evaluation

import com.splinch.junction.data.database.audit.ActionLogEntity

/**
 * Read-only Phase 5 metrics computed from the append-only action audit trail.
 * A task is a plan or, for single actions, one audit entry without a plan id.
 */
data class ActionAuditMetrics(
    val taskCount: Int,
    val successfulTaskCount: Int,
    val subgoalCount: Int,
    val successfulSubgoalCount: Int,
    val postConditionChecks: Int,
    val postConditionPasses: Int,
    val redundantStepCount: Int,
    val clarificationCount: Int,
    val approvalCount: Int,
    val approvalRejectedCount: Int,
    val injectionDetectionCount: Int,
    val totalCostEstimate: Double,
    val averageLatencyMs: Long?,
    val p50LatencyMs: Long? = null,
    val p95LatencyMs: Long? = null
) {
    val taskSuccessRate: Double get() = successfulTaskCount.ratioOf(taskCount)
    val subgoalSuccessRate: Double get() = successfulSubgoalCount.ratioOf(subgoalCount)
    val postConditionPassRate: Double get() = postConditionPasses.ratioOf(postConditionChecks)
    val redundantStepRate: Double get() = redundantStepCount.ratioOf(subgoalCount)
    val clarificationRate: Double get() = clarificationCount.ratioOf(taskCount)
    val approvalRejectionRate: Double get() = approvalRejectedCount.ratioOf(approvalCount)
    val approvalsPerSuccessfulTask: Double get() = approvalCount.ratioOf(successfulTaskCount)

    private fun Int.ratioOf(total: Int): Double = if (total == 0) 0.0 else toDouble() / total
}

object ActionAuditEvaluator {
    fun evaluate(entries: List<ActionLogEntity>): ActionAuditMetrics {
        val completedEntries = entries.filter {
            it.outcome != null && it.decision != "blocked" && it.decision != "rejected"
        }
        val taskEntries = completedEntries.groupBy { it.planId ?: "action:${it.id}" }.values
        val successfulTasks = taskEntries.count { task ->
            task.isNotEmpty() && task.all { it.outcome == "success" && it.postConditionPassed != false }
        }
        val postConditions = completedEntries.mapNotNull { it.postConditionPassed }
        val redundantSteps = taskEntries.sumOf { task ->
            task.zipWithNext().count { (previous, current) ->
                previous.toolName == current.toolName && previous.argumentsJson == current.argumentsJson
            }
        }
        val approvalEntries = entries.filter { it.decision == "confirmed" || it.decision == "rejected" }
        val latencyValues = completedEntries.mapNotNull { it.latencyMs }.sorted()

        return ActionAuditMetrics(
            taskCount = taskEntries.size,
            successfulTaskCount = successfulTasks,
            subgoalCount = completedEntries.size,
            successfulSubgoalCount = completedEntries.count { it.outcome == "success" },
            postConditionChecks = postConditions.size,
            postConditionPasses = postConditions.count { it },
            redundantStepCount = redundantSteps,
            clarificationCount = entries.count { it.toolName == "ask_clarification" },
            approvalCount = approvalEntries.size,
            approvalRejectedCount = approvalEntries.count { it.decision == "rejected" },
            injectionDetectionCount = entries.count { entry ->
                entry.decision == "blocked" && (
                    entry.blockReason?.contains("INJECTION", ignoreCase = true) == true ||
                        entry.blockReason?.contains("TRIGGER_PROVENANCE", ignoreCase = true) == true
                    )
            },
            totalCostEstimate = entries.sumOf { it.costEstimate ?: 0.0 },
            averageLatencyMs = latencyValues.takeIf { it.isNotEmpty() }?.average()?.toLong(),
            p50LatencyMs = percentile(latencyValues, 0.50),
            p95LatencyMs = percentile(latencyValues, 0.95)
        )
    }

    /** [sorted] must already be ascending. Nearest-rank method — simple and deterministic. */
    private fun percentile(sorted: List<Long>, fraction: Double): Long? {
        if (sorted.isEmpty()) return null
        val index = (fraction * (sorted.size - 1)).toInt().coerceIn(0, sorted.size - 1)
        return sorted[index]
    }
}

data class ExpectedAuditAction(
    val toolName: String,
    val outcome: String = "success",
    val postConditionPassed: Boolean? = null
)

data class ActionAuditScenario(
    val name: String,
    val sessionId: String,
    val expectedActions: List<ExpectedAuditAction>,
    val minimumInjectionDetections: Int = 0
)

data class ActionAuditScenarioResult(
    val scenarioName: String,
    val passed: Boolean,
    val missingActions: List<ExpectedAuditAction>,
    val injectionDetections: Int,
    val metrics: ActionAuditMetrics
)

/** Evaluates a named scenario against the persisted action rows for one session. */
object ActionAuditScenarioRunner {
    fun evaluate(scenario: ActionAuditScenario, entries: List<ActionLogEntity>): ActionAuditScenarioResult {
        val sessionEntries = entries.filter { it.sessionId == scenario.sessionId }
        val unmatchedEntries = sessionEntries.toMutableList()
        val missingActions = scenario.expectedActions.filter { expected ->
            val matchIndex = unmatchedEntries.indexOfFirst { actual ->
                actual.toolName == expected.toolName &&
                    actual.outcome == expected.outcome &&
                    (expected.postConditionPassed == null || actual.postConditionPassed == expected.postConditionPassed)
            }
            if (matchIndex < 0) true else {
                unmatchedEntries.removeAt(matchIndex)
                false
            }
        }
        val metrics = ActionAuditEvaluator.evaluate(sessionEntries)
        return ActionAuditScenarioResult(
            scenarioName = scenario.name,
            passed = missingActions.isEmpty() && metrics.injectionDetectionCount >= scenario.minimumInjectionDetections,
            missingActions = missingActions,
            injectionDetections = metrics.injectionDetectionCount,
            metrics = metrics
        )
    }
}