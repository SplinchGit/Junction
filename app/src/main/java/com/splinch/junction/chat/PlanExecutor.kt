package com.splinch.junction.chat

import com.splinch.junction.chat.tools.PostConditionOutcome
import com.splinch.junction.chat.tools.PostConditionVerifier
import com.splinch.junction.chat.tools.RiskTier
import com.splinch.junction.chat.tools.ToolRegistry
import com.splinch.junction.data.PlanDao
import com.splinch.junction.data.PlanEntity
import com.splinch.junction.data.StepEntity
import org.json.JSONArray
import org.json.JSONObject

/**
 * §2.1/§2.2/§2.3 orchestrator for the typed Plan/Step pipeline.
 *
 * A turn's tool-call requests are assembled into a single [Plan] (not
 * executed as independent, unrelated tool calls). Every step is evaluated
 * against [TrustGate] up front so the owner sees the whole plan — including
 * any steps that are blocked outright — before anything runs. Approval is
 * plan-level; disclosure is per-step. Execution proceeds in dependency
 * order, a failed step halts (skips) its descendants, and every step's
 * result is checked against its declared post-condition rather than trusted
 * blindly. Plan state is persisted after every transition so an interrupted
 * plan can be resumed later (re-checking taint and plan hash first).
 */
class PlanExecutor(
    private val planDao: PlanDao,
    private val trustGate: TrustGate,
    private val verifier: PostConditionVerifier
) {

    /**
     * Assemble one turn's worth of tool-call requests into a single plan
     * (sequential dependency chain). [costEstimatePerStepUsd], if known, is
     * this turn's total estimated USD cost divided evenly across its steps —
     * a coarse but honest attribution, since token usage is reported per
     * model turn rather than per tool call (§Cost control).
     */
    fun buildPlan(
        goal: String,
        sessionId: String,
        trigger: Provenance,
        calls: List<PendingToolCall>,
        costEstimatePerStepUsd: Double? = null
    ): Plan {
        val steps = mutableListOf<Step>()
        calls.forEach { call ->
            val registration = ToolRegistry.get(call.name)
            steps.add(
                Step(
                    callId = call.callId,
                    tool = call.name,
                    arguments = call.arguments,
                    summary = call.summary,
                    riskTier = registration?.riskTier ?: RiskTier.DESTRUCTIVE,
                    dependsOn = steps.lastOrNull()?.let { listOf(it.id) } ?: emptyList(),
                    costEstimateUsd = costEstimatePerStepUsd
                )
            )
        }
        return Plan(goal = goal, steps = steps, sessionId = sessionId, trigger = trigger)
    }

    /**
     * Evaluate every step against [TrustGate] and persist the plan. Steps the
     * gate blocks outright are marked BLOCKED (and their descendants
     * SKIPPED) before the owner ever sees a confirmation prompt for them.
     * Returns true if every remaining step auto-allows (no owner
     * confirmation needed at all), false if the plan must wait at PROPOSED.
     */
    suspend fun propose(plan: Plan): Boolean {
        var needsConfirmation = false
        for (step in plan.steps) {
            if (step.status != StepStatus.PENDING) continue
            when (val decision = trustGate.evaluate(step.toPendingToolCall(), plan.trigger, step.costEstimateUsd)) {
                is TrustDecision.Allow -> Unit
                is TrustDecision.RequireConfirmation -> {
                    needsConfirmation = true
                    if (decision.tainted) {
                        plan.tainted = true
                        plan.taintSource = decision.taintSource
                    }
                }
                is TrustDecision.Block -> {
                    step.status = StepStatus.BLOCKED
                    step.blockReason = decision.reason
                    propagateSkip(plan, step.id)
                }
            }
        }
        plan.status = PlanStatus.PROPOSED
        persist(plan)
        return !needsConfirmation
    }

    suspend fun approve(plan: Plan) {
        if (plan.status == PlanStatus.PROPOSED) {
            plan.status = PlanStatus.APPROVED
            persist(plan)
        }
    }

    suspend fun cancel(plan: Plan) {
        for (step in plan.steps.filter { it.status == StepStatus.PENDING }) {
            step.status = StepStatus.SKIPPED
            trustGate.recordRejection(step.toPendingToolCall(), "Owner cancelled the plan before execution.")
        }
        plan.status = PlanStatus.CANCELLED
        persist(plan)
    }

    suspend fun pause(plan: Plan) {
        plan.status = PlanStatus.PAUSED
        persist(plan)
    }

    /**
     * Run every runnable step until the plan reaches a terminal state, or
     * until [shouldPause] returns true between steps (leaving remaining
     * steps PENDING for a later resume). [applyStep] performs the actual
     * side effect (delegates to the caller's existing tool-apply logic) and
     * must return the tool's own outcome; this method independently
     * verifies the declared post-condition regardless of what it reports.
     */
    suspend fun run(
        plan: Plan,
        shouldPause: () -> Boolean = { false },
        applyStep: suspend (Step) -> ToolApplyResult
    ): Plan {
        plan.status = PlanStatus.RUNNING
        persist(plan)

        while (!plan.isTerminal()) {
            if (shouldPause()) {
                pause(plan)
                return plan
            }
            val step = plan.nextRunnableStep() ?: break
            val startedAt = System.currentTimeMillis()

            val mismatch = trustGate.verifyBeforeExecute(step.toPendingToolCall())
            if (mismatch != null) {
                step.status = StepStatus.FAILED
                step.blockReason = mismatch.reason
                step.outcomeDetail = "Plan hash mismatch at execution time — arguments changed after approval."
                propagateSkip(plan, step.id)
                persistStep(plan.id, step)
                continue
            }

            step.status = StepStatus.RUNNING
            persistStep(plan.id, step)

            val applyResult = runCatching { applyStep(step) }
            val result = applyResult.getOrNull()
            if (result == null) {
                step.status = StepStatus.FAILED
                step.postConditionPassed = false
                step.outcomeDetail = "Tool threw: ${applyResult.exceptionOrNull()?.message}"
                trustGate.recordOutcome(
                    step.toPendingToolCall(),
                    succeeded = false,
                    postConditionPassed = false,
                    detail = step.outcomeDetail.orEmpty(),
                    undoAvailable = false,
                    latencyMs = System.currentTimeMillis() - startedAt
                )
                persistStep(plan.id, step)
                propagateSkip(plan, step.id)
                continue
            }
            step.rollbackAvailable = result.undo != null
            step.undo = result.undo

            // If the tool itself reported an error, don't let a "trusted"
            // default post-condition paper over that as a success.
            val toolOutputJson = runCatching { JSONObject(result.toolOutput) }.getOrNull()
            if (toolOutputJson?.optString("status") == "error") {
                step.status = StepStatus.FAILED
                step.postConditionPassed = false
                step.outcomeDetail = toolOutputJson.optString("message").ifBlank { "Tool reported an error" }
                trustGate.recordOutcome(
                    step.toPendingToolCall(),
                    succeeded = false,
                    postConditionPassed = false,
                    detail = step.outcomeDetail.orEmpty(),
                    undoAvailable = step.rollbackAvailable,
                    latencyMs = System.currentTimeMillis() - startedAt
                )
                persistStep(plan.id, step)
                propagateSkip(plan, step.id)
                continue
            }

            val registration = ToolRegistry.get(step.tool)
            val outcome: PostConditionOutcome = runCatching {
                registration?.verifyPostCondition?.invoke(step.arguments, verifier)
            }.getOrElse { PostConditionOutcome(false, "Post-condition check threw: ${it.message}") }
                ?: PostConditionOutcome.trusted("Tool reported success")

            step.postConditionPassed = outcome.passed
            step.outcomeDetail = outcome.detail
            step.status = if (outcome.passed) StepStatus.DONE else StepStatus.FAILED
            trustGate.recordOutcome(
                step.toPendingToolCall(),
                succeeded = outcome.passed,
                postConditionPassed = outcome.passed,
                detail = outcome.detail,
                undoAvailable = step.rollbackAvailable,
                latencyMs = System.currentTimeMillis() - startedAt
            )
            persistStep(plan.id, step)

            if (step.status == StepStatus.FAILED) {
                propagateSkip(plan, step.id)
            }
        }

        plan.status = if (plan.steps.any { it.status == StepStatus.FAILED || it.status == StepStatus.BLOCKED }) {
            PlanStatus.FAILED
        } else {
            PlanStatus.DONE
        }
        persist(plan)
        return plan
    }

    /** Reload the most recent non-terminal plan (§2.3 interruption tolerance), if any. */
    suspend fun resumeActive(): Plan? {
        val entity = planDao.activePlan() ?: return null
        val stepEntities = planDao.stepsForPlan(entity.id)
        val steps = stepEntities.map { it.toStep() }.toMutableList()
        return Plan(
            id = entity.id,
            goal = entity.goal,
            steps = steps,
            sessionId = entity.sessionId,
            trigger = Provenance.valueOf(entity.trigger),
            status = PlanStatus.valueOf(entity.status),
            tainted = entity.tainted,
            taintSource = entity.taintSource,
            createdAt = entity.createdAt
        )
    }

    // ── Persistence ──────────────────────────────────────────────────────────

    private suspend fun persist(plan: Plan) {
        planDao.insertPlanWithSteps(
            plan.toEntity(),
            plan.steps.mapIndexed { index, step -> step.toEntity(plan.id, index) }
        )
    }

    private suspend fun persistStep(planId: String, step: Step) {
        planDao.updateStep(
            id = step.id,
            status = step.status.name,
            blockReason = step.blockReason,
            postConditionPassed = step.postConditionPassed,
            outcomeDetail = step.outcomeDetail,
            rollbackAvailable = step.rollbackAvailable
        )
    }

    /** Mark every step that (transitively) depends on [failedStepId] as SKIPPED. */
    private fun propagateSkip(plan: Plan, failedStepId: String) {
        var changed = true
        while (changed) {
            changed = false
            for (step in plan.steps) {
                if (step.status != StepStatus.PENDING) continue
                val blockedByFailure = step.dependsOn.any { depId ->
                    val dep = plan.steps.firstOrNull { it.id == depId } ?: return@any false
                    dep.id == failedStepId || dep.status == StepStatus.SKIPPED ||
                        dep.status == StepStatus.FAILED || dep.status == StepStatus.BLOCKED
                }
                if (blockedByFailure) {
                    step.status = StepStatus.SKIPPED
                    changed = true
                }
            }
        }
    }
}

private fun Step.toPendingToolCall() = PendingToolCall(callId, tool, arguments, summary)

private fun Plan.toEntity() = PlanEntity(
    id = id,
    goal = goal,
    sessionId = sessionId,
    trigger = trigger.name,
    status = status.name,
    tainted = tainted,
    taintSource = taintSource,
    createdAt = createdAt
)

private fun Step.toEntity(planId: String, orderIndex: Int) = StepEntity(
    id = id,
    planId = planId,
    callId = callId,
    orderIndex = orderIndex,
    tool = tool,
    argumentsJson = arguments.toString(),
    summary = summary,
    riskTier = riskTier.name,
    dependsOnJson = JSONArray(dependsOn).toString(),
    status = status.name,
    blockReason = blockReason,
    postConditionPassed = postConditionPassed,
    outcomeDetail = outcomeDetail,
    rollbackAvailable = rollbackAvailable
)

private fun StepEntity.toStep(): Step {
    val deps = mutableListOf<String>()
    val array = JSONArray(dependsOnJson)
    for (i in 0 until array.length()) deps.add(array.getString(i))
    return Step(
        id = id,
        callId = callId,
        tool = tool,
        arguments = JSONObject(argumentsJson),
        summary = summary,
        riskTier = RiskTier.valueOf(riskTier),
        dependsOn = deps,
        status = StepStatus.valueOf(status),
        blockReason = blockReason,
        postConditionPassed = postConditionPassed,
        outcomeDetail = outcomeDetail,
        rollbackAvailable = rollbackAvailable
    )
}
