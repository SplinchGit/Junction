package com.splinch.junction.evaluation

import com.splinch.junction.chat.PendingToolCall
import com.splinch.junction.chat.Plan
import com.splinch.junction.chat.PlanExecutor
import com.splinch.junction.chat.Provenance
import com.splinch.junction.chat.Step
import com.splinch.junction.chat.ToolApplyResult
import com.splinch.junction.data.ActionLogDao

/** A deterministic, owner-approved plan scenario executed through [PlanExecutor]. */
data class PlanExecutionScenario(
    val auditScenario: ActionAuditScenario,
    val goal: String,
    val calls: List<PendingToolCall>,
    val trigger: Provenance = Provenance.OWNER
)

data class PlanExecutionScenarioResult(
    val plan: Plan,
    val auditResult: ActionAuditScenarioResult
)

/**
 * Runs a plan through proposal, owner approval when required, and execution.
 * The caller supplies a deterministic tool applicator so scenarios never call
 * real external services.
 */
class PlanExecutionScenarioRunner(
    private val executor: PlanExecutor,
    private val auditDao: ActionLogDao
) {
    suspend fun run(
        scenario: PlanExecutionScenario,
        applyStep: suspend (Step) -> ToolApplyResult
    ): PlanExecutionScenarioResult {
        val plan = executor.buildPlan(
            goal = scenario.goal,
            sessionId = scenario.auditScenario.sessionId,
            trigger = scenario.trigger,
            calls = scenario.calls
        )
        if (!executor.propose(plan)) executor.approve(plan)
        val completedPlan = executor.run(plan, applyStep = applyStep)
        val auditResult = ActionAuditScenarioRunner.evaluate(
            scenario.auditScenario,
            auditDao.forSession(scenario.auditScenario.sessionId)
        )
        return PlanExecutionScenarioResult(completedPlan, auditResult)
    }
}