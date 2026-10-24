package com.splinch.junction.assistant.planning

import com.splinch.junction.assistant.context.Provenance
import com.splinch.junction.assistant.tools.PendingToolCall
import com.splinch.junction.assistant.tools.PostConditionVerifier
import com.splinch.junction.assistant.tools.ToolApplyResult
import com.splinch.junction.assistant.trust.TrustGate
import com.splinch.junction.data.database.audit.ActionLogDao
import com.splinch.junction.data.database.planning.PlanDao
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class PlanCallbacks(
    val appendSystemMessage: suspend (String) -> Unit,
    val sendRealtimeResult: suspend (String, String, String) -> Unit,
    val endVoiceTurn: (String, String?) -> Unit,
    val applyStep: suspend (Step) -> ToolApplyResult,
    /**
     * Offered a plan parked for approval. Returns true when it took over the spoken side
     * (a disclosure for voice confirmation, or why the screen is needed).
     */
    val voicePrompt: suspend (Plan, Boolean) -> Boolean = { _, _ -> false }
)

/** What actually happened when an approved plan ran, for a verified spoken result. */
data class PlanRunResult(val confirmations: List<String>, val failures: List<String>)

/** Coordinates proposal, approval, execution, persistence, and active-plan state. */
class PlanCoordinator(
    private val planDao: PlanDao,
    private val actionLogDao: ActionLogDao,
    private val verifier: PostConditionVerifier,
    private val egressValidator: suspend (String, org.json.JSONObject) -> String?
) {
    private lateinit var trustGate: TrustGate
    private lateinit var executor: PlanExecutor

    private val _activePlan = MutableStateFlow<Plan?>(null)
    val activePlan: StateFlow<Plan?> = _activePlan.asStateFlow()

    fun resetSession(sessionId: String, alwaysAllowedTools: Set<String>) {
        trustGate = TrustGate(actionLogDao, sessionId, egressValidator = egressValidator)
        trustGate.seedAlwaysAllowed(alwaysAllowedTools)
        executor = PlanExecutor(planDao, trustGate, verifier)
        _activePlan.value = null
    }

    suspend fun restoreActive(sessionId: String): Plan? {
        val resumable = executor.resumeActive()?.takeIf { it.sessionId == sessionId }
        _activePlan.value = resumable
        return resumable
    }

    fun clearActive() {
        _activePlan.value = null
    }

    fun recordContextBlock(provenance: Provenance, sourceRef: String) {
        trustGate.recordContextBlock(provenance, sourceRef)
    }

    fun grantAlwaysAllow(toolName: String) = trustGate.grantAlwaysAllow(toolName)

    fun revokeAlwaysAllow(toolName: String) = trustGate.revokeAlwaysAllow(toolName)

    fun currentAlwaysAllowed(): Set<String> = trustGate.currentAlwaysAllowed()

    suspend fun propose(
        calls: List<PendingToolCall>,
        goal: String,
        sessionId: String,
        costEstimatePerStepUsd: Double?,
        speakOutcomes: Boolean,
        callbacks: PlanCallbacks
    ) {
        if (calls.isEmpty()) return
        val plan = executor.buildPlan(
            goal.ifBlank { "Plan" },
            sessionId,
            Provenance.OWNER,
            calls,
            costEstimatePerStepUsd
        )
        val autoRun = executor.propose(plan)

        plan.steps.filter { it.status == StepStatus.BLOCKED }.forEach { step ->
            val reason = step.blockReason
            callbacks.appendSystemMessage(
                "Blocked: ${step.summary}" + (reason?.let { " ($it)" } ?: "")
            )
            callbacks.sendRealtimeResult(
                step.callId,
                "blocked",
                reason ?: "Blocked by trust policy"
            )
        }

        if (autoRun) {
            run(plan, speakOutcomes, callbacks)
        } else {
            _activePlan.value = plan
            if (!callbacks.voicePrompt(plan, speakOutcomes)) {
                callbacks.endVoiceTurn(
                    "plan_awaiting_approval",
                    "I need your approval before I can do that — it's waiting on screen."
                        .takeIf { speakOutcomes }
                )
            }
        }
    }

    suspend fun approve(callbacks: PlanCallbacks) {
        val plan = _activePlan.value ?: return
        _activePlan.value = null
        run(plan, speakOutcomes = true, callbacks)
    }

    /**
     * Approves only if [planId] is still the plan waiting, so a spoken confirmation can
     * never approve a plan that replaced the one read aloud. Consumed once: the active plan
     * is cleared before anything runs. The caller speaks the verified result.
     */
    suspend fun approveExact(planId: String, callbacks: PlanCallbacks, stillApproved: (Plan) -> Boolean): PlanRunResult? {
        val plan = _activePlan.value ?: return null
        if (plan.id != planId || !stillApproved(plan)) return null
        _activePlan.value = null
        return run(plan, speakOutcomes = false, callbacks)
    }

    suspend fun cancel(callbacks: PlanCallbacks) {
        val plan = _activePlan.value ?: return
        _activePlan.value = null
        executor.cancel(plan)
        plan.steps.filter { it.status == StepStatus.SKIPPED }.forEach { step ->
            callbacks.sendRealtimeResult(step.callId, "cancelled", "User cancelled the plan")
        }
        callbacks.appendSystemMessage("Cancelled: ${plan.goal}")
    }

    private suspend fun run(
        plan: Plan,
        speakOutcomes: Boolean,
        callbacks: PlanCallbacks
    ): PlanRunResult {
        executor.approve(plan)
        val outcomes = mutableListOf<String>()
        executor.run(plan) { step ->
            callbacks.applyStep(step).also { result ->
                if (result.confirmation.isNotBlank()) outcomes += result.confirmation
            }
        }
        if (outcomes.isNotEmpty() && speakOutcomes) {
            callbacks.endVoiceTurn("plan_done", outcomes.joinToString(" ").take(MAX_SPOKEN_OUTCOME_CHARS))
        }
        plan.steps.filter { it.status == StepStatus.FAILED }.forEach { step ->
            callbacks.appendSystemMessage(
                "Post-condition check failed for ${step.summary}: ${step.outcomeDetail ?: "unknown reason"}"
            )
            callbacks.sendRealtimeResult(
                step.callId,
                "failed",
                step.outcomeDetail ?: "Post-condition check failed"
            )
        }
        plan.steps.filter { it.status == StepStatus.SKIPPED }.forEach { step ->
            callbacks.sendRealtimeResult(
                step.callId,
                "skipped",
                "Skipped after an earlier step failed or was blocked"
            )
        }
        return PlanRunResult(
            confirmations = outcomes,
            failures = plan.steps.filter { it.status == StepStatus.FAILED || it.status == StepStatus.SKIPPED }
                .map { "${it.summary}: ${it.outcomeDetail ?: it.blockReason ?: "did not complete"}" }
        )
    }

    companion object {
        private const val MAX_SPOKEN_OUTCOME_CHARS = 400
    }
}
