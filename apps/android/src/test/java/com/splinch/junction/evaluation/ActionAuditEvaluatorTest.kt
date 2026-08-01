package com.splinch.junction.evaluation

import com.splinch.junction.assistant.trust.BlockReasons
import com.splinch.junction.data.database.audit.ActionLogEntity
import org.junit.Assert.assertEquals
import org.junit.Test

class ActionAuditEvaluatorTest {
    /**
     * Note what this test does *not* cover: it hands the evaluator rows that
     * already share a planId. The grouping logic below has always been correct
     * on that input — but TrustGate used to mint a fresh UUID per evaluated
     * call, so no two rows from one plan ever shared a planId in production and
     * redundantStepCount could only ever be 0. The bug lived entirely in what
     * produced these rows, which is why it hid behind this passing test.
     * End-to-end coverage of the real path belongs in the instrumentation test
     * PlanExecutionScenarioRunnerTest.duplicateIdenticalCallsCountAsRedundantSteps,
     * which runs a plan through PlanExecutor and TrustGate for real.
     */
    @Test
    fun separatesExecutableTasksFromSafetyAndApprovalOutcomes() {
        val rows = listOf(
            entry(id = "first", planId = "plan", outcome = "success", postConditionPassed = true, latencyMs = 120, costEstimate = 0.02),
            entry(id = "second", planId = "plan", outcome = "success", postConditionPassed = true, latencyMs = 180, costEstimate = 0.03),
            entry(id = "clarify", outcome = "success").copy(toolName = "ask_clarification"),
            entry(id = "blocked", decision = "blocked", blockReason = BlockReasons.TRIGGER_PROVENANCE, outcome = "failure"),
            entry(id = "rejected", decision = "rejected", outcome = "failure")
        )

        val metrics = ActionAuditEvaluator.evaluate(rows)

        assertEquals(2, metrics.taskCount)
        assertEquals(2, metrics.successfulTaskCount)
        assertEquals(3, metrics.subgoalCount)
        assertEquals(2, metrics.postConditionPasses)
        assertEquals(1, metrics.redundantStepCount)
        assertEquals(1, metrics.clarificationCount)
        assertEquals(1, metrics.injectionDetectionCount)
        assertEquals(1, metrics.approvalRejectedCount)
        assertEquals(150L, metrics.averageLatencyMs)
        assertEquals(0.05, metrics.totalCostEstimate, 0.0001)
    }

    @Test
    fun scenarioRunner_requiresExpectedActionsAndInjectionDetections() {
        val scenario = ActionAuditScenario(
            name = "tainted email is blocked before action",
            sessionId = "evaluation",
            expectedActions = listOf(ExpectedAuditAction("gmail_archive", postConditionPassed = true)),
            minimumInjectionDetections = 1
        )
        val rows = listOf(
            entry(id = "archive", outcome = "success", postConditionPassed = true).copy(toolName = "gmail_archive"),
            entry(id = "blocked", decision = "blocked", blockReason = BlockReasons.TRIGGER_PROVENANCE, outcome = "failure")
        )

        val result = ActionAuditScenarioRunner.evaluate(scenario, rows)

        assertEquals(true, result.passed)
        assertEquals(emptyList<ExpectedAuditAction>(), result.missingActions)
        assertEquals(1, result.injectionDetections)
    }

    @Test
    fun scenarioRunner_rejectsAnActionWhosePostConditionDoesNotMatch() {
        val scenario = ActionAuditScenario(
            name = "archive must be independently verified",
            sessionId = "evaluation",
            expectedActions = listOf(ExpectedAuditAction("archive_feed_item", postConditionPassed = true))
        )
        val rows = listOf(
            entry(id = "archive", outcome = "failure", postConditionPassed = false)
                .copy(toolName = "archive_feed_item")
        )

        val result = ActionAuditScenarioRunner.evaluate(scenario, rows)

        assertEquals(false, result.passed)
        assertEquals(1, result.missingActions.size)
    }

    private fun entry(
        id: String,
        planId: String? = null,
        decision: String = "confirmed",
        blockReason: String? = null,
        outcome: String? = null,
        postConditionPassed: Boolean? = null,
        latencyMs: Long? = null,
        costEstimate: Double? = null
    ) = ActionLogEntity(
        id = id,
        timestamp = 1L,
        sessionId = "evaluation",
        planId = planId,
        toolName = "tap_element",
        argumentsJson = "{}",
        riskTier = "INAPP",
        effectiveTier = "INAPP",
        triggerProvenance = "OWNER",
        decision = decision,
        blockReason = blockReason,
        outcome = outcome,
        postConditionPassed = postConditionPassed,
        latencyMs = latencyMs,
        costEstimate = costEstimate
    )
}