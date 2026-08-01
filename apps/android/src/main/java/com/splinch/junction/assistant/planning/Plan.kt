package com.splinch.junction.assistant.planning

import com.splinch.junction.assistant.context.*
import com.splinch.junction.assistant.conversation.*
import com.splinch.junction.assistant.planning.*
import com.splinch.junction.assistant.provider.*
import com.splinch.junction.assistant.runtime.*
import com.splinch.junction.assistant.tools.*
import com.splinch.junction.assistant.trust.*

import com.splinch.junction.assistant.tools.RiskTier
import org.json.JSONObject
import java.util.UUID

/**
 * §2.1 Typed plans / §2.3 interruption tolerance.
 *
 * A turn produces a [Plan], not a lone tool call. Steps run in dependency
 * order; a failed step halts its descendants. Confirmation happens at plan
 * level with per-step disclosure (§2.1) — the owner sees every step before
 * any of them run.
 */
enum class PlanStatus {
    PROPOSED, APPROVED, RUNNING, PAUSED, FAILED, DONE, CANCELLED
}

enum class StepStatus {
    PENDING, BLOCKED, RUNNING, DONE, FAILED, SKIPPED
}

data class Step(
    val id: String = UUID.randomUUID().toString(),
    val callId: String,
    val tool: String,
    val arguments: JSONObject,
    val summary: String,
    val riskTier: RiskTier,
    val dependsOn: List<String> = emptyList(),
    var status: StepStatus = StepStatus.PENDING,
    var blockReason: String? = null,
    var postConditionPassed: Boolean? = null,
    var outcomeDetail: String? = null,
    var rollbackAvailable: Boolean = false,
    var undo: UndoAction? = null,
    /** §Cost control: this step's share of the turn's estimated USD cost, if known. */
    val costEstimateUsd: Double? = null
)

data class Plan(
    val id: String = UUID.randomUUID().toString(),
    val goal: String,
    val steps: MutableList<Step>,
    val sessionId: String,
    val trigger: Provenance,
    var status: PlanStatus = PlanStatus.PROPOSED,
    var tainted: Boolean = false,
    var taintSource: String? = null,
    val createdAt: Long = System.currentTimeMillis()
) {
    /** All steps in dependency-satisfied order have completed (DONE or SKIPPED). */
    fun isTerminal(): Boolean = steps.all {
        it.status == StepStatus.DONE || it.status == StepStatus.FAILED ||
            it.status == StepStatus.SKIPPED || it.status == StepStatus.BLOCKED
    }

    fun nextRunnableStep(): Step? = steps.firstOrNull { step ->
        step.status == StepStatus.PENDING &&
            step.dependsOn.all { depId -> steps.firstOrNull { it.id == depId }?.status == StepStatus.DONE }
    }
}
