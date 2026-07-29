package com.splinch.junction.evaluation

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.splinch.junction.chat.PendingToolCall
import com.splinch.junction.chat.PlanExecutor
import com.splinch.junction.chat.PlanStatus
import com.splinch.junction.chat.Provenance
import com.splinch.junction.chat.StepStatus
import com.splinch.junction.chat.ToolApplyResult
import com.splinch.junction.chat.TrustGate
import com.splinch.junction.chat.tools.PostConditionVerifier
import com.splinch.junction.data.ActionLogDao
import com.splinch.junction.data.ActionLogEntity
import com.splinch.junction.data.PlanDao
import com.splinch.junction.data.PlanEntity
import com.splinch.junction.data.StepEntity
import com.splinch.junction.feed.FeedRepository
import com.splinch.junction.feed.data.FeedDao
import com.splinch.junction.feed.model.FeedCategory
import com.splinch.junction.feed.model.FeedItemEntity
import com.splinch.junction.feed.model.FeedStatus
import com.splinch.junction.settings.UserPrefsRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PlanExecutionScenarioRunnerTest {
    @Test
    fun executesOwnerApprovedPlanAndEvaluatesPersistedAudit() = runBlocking {
        val sessionId = "execution-scenario"
        val auditDao = InMemoryActionLogDao()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val verifier = PostConditionVerifier(
            prefs = UserPrefsRepository(context),
            feedRepository = FeedRepository(NoOpFeedDao()),
            activeNotificationKeys = { emptySet() }
        )
        val executor = PlanExecutor(
            planDao = InMemoryPlanDao(),
            trustGate = TrustGate(auditDao, sessionId),
            verifier = verifier
        )
        val scenario = PlanExecutionScenario(
            auditScenario = ActionAuditScenario(
                name = "owner enables speech mode",
                sessionId = sessionId,
                expectedActions = listOf(ExpectedAuditAction("set_speech_mode", postConditionPassed = true))
            ),
            goal = "Enable speech mode",
            calls = listOf(
                PendingToolCall(
                    callId = "enable-speech-mode",
                    name = "set_speech_mode",
                    arguments = JSONObject().put("enabled", true),
                    summary = "Enable speech mode"
                )
            )
        )

        val result = PlanExecutionScenarioRunner(executor, auditDao).run(scenario) {
            ToolApplyResult("Speech mode enabled", JSONObject().put("status", "applied").toString())
        }

        assertEquals(PlanStatus.DONE, result.plan.status)
        assertTrue(result.auditResult.passed)
        assertEquals(1, result.auditResult.metrics.successfulSubgoalCount)
    }

    @Test
    fun stopsDependentStepsWhenTheFirstToolReportsFailure() = runBlocking {
        val sessionId = "failure-scenario"
        val auditDao = InMemoryActionLogDao()
        val runner = PlanExecutionScenarioRunner(newExecutor(auditDao, sessionId), auditDao)
        val scenario = PlanExecutionScenario(
            auditScenario = ActionAuditScenario(
                name = "tool failure stops descendants",
                sessionId = sessionId,
                expectedActions = listOf(ExpectedAuditAction("open_app", outcome = "failure", postConditionPassed = false))
            ),
            goal = "Open two apps",
            calls = listOf(openAppCall("first-app"), openAppCall("second-app"))
        )
        var appliedSteps = 0

        val result = runner.run(scenario) {
            appliedSteps += 1
            ToolApplyResult("Launch failed", JSONObject().put("status", "error").put("message", "App unavailable").toString())
        }

        assertEquals(PlanStatus.FAILED, result.plan.status)
        assertEquals(StepStatus.SKIPPED, result.plan.steps[1].status)
        assertEquals(1, appliedSteps)
        assertTrue(result.auditResult.passed)
    }

    @Test
    fun failsAndStopsDescendantsWhenPostConditionDisprovesToolSuccess() = runBlocking {
        val sessionId = "postcondition-scenario"
        val auditDao = InMemoryActionLogDao()
        val runner = PlanExecutionScenarioRunner(newExecutor(auditDao, sessionId), auditDao)
        val scenario = PlanExecutionScenario(
            auditScenario = ActionAuditScenario(
                name = "archive readback failure stops descendants",
                sessionId = sessionId,
                expectedActions = listOf(
                    ExpectedAuditAction("archive_feed_item", outcome = "failure", postConditionPassed = false)
                )
            ),
            goal = "Archive then open an app",
            calls = listOf(
                PendingToolCall(
                    callId = "archive-missing-item",
                    name = "archive_feed_item",
                    arguments = JSONObject().put("id", "missing-feed-item"),
                    summary = "Archive missing feed item"
                ),
                openAppCall("dependent-open-app")
            )
        )
        var appliedSteps = 0

        val result = runner.run(scenario) {
            appliedSteps += 1
            ToolApplyResult("Archive reported success", JSONObject().put("status", "applied").toString())
        }

        assertEquals(PlanStatus.FAILED, result.plan.status)
        assertEquals(StepStatus.FAILED, result.plan.steps[0].status)
        assertEquals(false, result.plan.steps[0].postConditionPassed)
        assertEquals(StepStatus.SKIPPED, result.plan.steps[1].status)
        assertEquals(1, appliedSteps)
        assertTrue(result.auditResult.passed)
    }

    @Test
    fun recordsUntrustedTriggerAsAnInjectionDetectionWithoutExecuting() = runBlocking {
        val sessionId = "injection-scenario"
        val auditDao = InMemoryActionLogDao()
        val runner = PlanExecutionScenarioRunner(newExecutor(auditDao, sessionId), auditDao)
        val scenario = PlanExecutionScenario(
            auditScenario = ActionAuditScenario(
                name = "untrusted trigger cannot open an app",
                sessionId = sessionId,
                expectedActions = emptyList(),
                minimumInjectionDetections = 1
            ),
            goal = "Injected action",
            calls = listOf(openAppCall("injected-app")),
            trigger = Provenance.UNTRUSTED
        )
        var wasApplied = false

        val result = runner.run(scenario) {
            wasApplied = true
            ToolApplyResult("Unexpected", JSONObject().put("status", "applied").toString())
        }

        assertEquals(false, wasApplied)
        assertEquals(PlanStatus.FAILED, result.plan.status)
        assertTrue(result.auditResult.passed)
        assertEquals(1, result.auditResult.injectionDetections)
    }

    // §5.1 additional task-set scenarios, spanning both action tracks
    // (Track A: notifications/deep links/gmail; Track B: accessibility) plus
    // settings/feed/clarification/memory tools, bringing the task set toward
    // the spec's ~20-real-task target.

    @Test
    fun setFeedFilterSucceeds() = runBlocking {
        val sessionId = "set-feed-filter"
        val auditDao = InMemoryActionLogDao()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val prefs = UserPrefsRepository(context)
        val executor = PlanExecutor(
            planDao = InMemoryPlanDao(),
            trustGate = TrustGate(auditDao, sessionId),
            verifier = PostConditionVerifier(
                prefs = prefs,
                feedRepository = FeedRepository(NoOpFeedDao()),
                activeNotificationKeys = { emptySet() }
            )
        )
        val runner = PlanExecutionScenarioRunner(executor, auditDao)
        val scenario = PlanExecutionScenario(
            auditScenario = ActionAuditScenario(
                name = "disable a feed package",
                sessionId = sessionId,
                expectedActions = listOf(ExpectedAuditAction("set_feed_filter", postConditionPassed = true))
            ),
            goal = "Mute a package",
            calls = listOf(
                PendingToolCall(
                    callId = "mute-package",
                    name = "set_feed_filter",
                    arguments = JSONObject().put("packageName", "com.example.app").put("enabled", false),
                    summary = "Mute com.example.app"
                )
            )
        )
        // State-based verification (§5.1): the fake apply performs the real
        // side effect so the post-condition genuinely reads it back, rather
        // than trusting a canned "applied" response.
        val result = runner.run(scenario) {
            prefs.setPackageEnabled("com.example.app", false)
            ToolApplyResult("Muted", JSONObject().put("status", "applied").toString())
        }
        assertEquals(PlanStatus.DONE, result.plan.status)
        assertTrue(result.auditResult.passed)
    }

    @Test
    fun checkForUpdatesSucceeds() = runBlocking {
        val sessionId = "check-updates"
        val auditDao = InMemoryActionLogDao()
        val runner = PlanExecutionScenarioRunner(newExecutor(auditDao, sessionId), auditDao)
        val scenario = PlanExecutionScenario(
            auditScenario = ActionAuditScenario(
                name = "owner asks for an update check",
                sessionId = sessionId,
                expectedActions = listOf(ExpectedAuditAction("check_for_updates"))
            ),
            goal = "Check for updates",
            calls = listOf(
                PendingToolCall(
                    callId = "check-updates",
                    name = "check_for_updates",
                    arguments = JSONObject(),
                    summary = "Check for updates"
                )
            )
        )
        val result = runner.run(scenario) { ToolApplyResult("No updates", JSONObject().put("status", "applied").toString()) }
        assertEquals(PlanStatus.DONE, result.plan.status)
        assertTrue(result.auditResult.passed)
    }

    @Test
    fun askClarificationIsReadTierAndAutoAllowed() = runBlocking {
        val sessionId = "ask-clarification"
        val auditDao = InMemoryActionLogDao()
        val runner = PlanExecutionScenarioRunner(newExecutor(auditDao, sessionId), auditDao)
        val scenario = PlanExecutionScenario(
            auditScenario = ActionAuditScenario(
                name = "ambiguous request triggers a clarifying question",
                sessionId = sessionId,
                expectedActions = listOf(ExpectedAuditAction("ask_clarification"))
            ),
            goal = "Which Sam?",
            calls = listOf(
                PendingToolCall(
                    callId = "ask-which-sam",
                    name = "ask_clarification",
                    arguments = JSONObject().put("question", "Which Sam did you mean?"),
                    summary = "Ask: which Sam?"
                )
            )
        )
        val result = runner.run(scenario) { ToolApplyResult("Asked", JSONObject().put("status", "applied").toString()) }
        assertEquals(PlanStatus.DONE, result.plan.status)
        assertEquals(1, result.auditResult.metrics.clarificationCount)
        assertTrue(result.auditResult.passed)
    }

    @Test
    fun replyNotificationRequiresApprovalThenSucceeds() = runBlocking {
        val sessionId = "reply-notification"
        val auditDao = InMemoryActionLogDao()
        val runner = PlanExecutionScenarioRunner(newExecutor(auditDao, sessionId), auditDao)
        val scenario = PlanExecutionScenario(
            auditScenario = ActionAuditScenario(
                name = "owner approves a notification reply",
                sessionId = sessionId,
                expectedActions = listOf(ExpectedAuditAction("reply_notification"))
            ),
            goal = "Reply on my way",
            calls = listOf(
                PendingToolCall(
                    callId = "reply-key",
                    name = "reply_notification",
                    arguments = JSONObject().put("notificationKey", "key-1").put("text", "On my way"),
                    summary = "Reply to key-1: On my way"
                )
            )
        )
        val result = runner.run(scenario) { ToolApplyResult("Replied", JSONObject().put("status", "applied").toString()) }
        assertEquals(PlanStatus.DONE, result.plan.status)
        assertTrue(result.auditResult.passed)
    }

    @Test
    fun emailSendRequiresApprovalThenSucceeds() = runBlocking {
        val sessionId = "email-send"
        val auditDao = InMemoryActionLogDao()
        val runner = PlanExecutionScenarioRunner(newExecutor(auditDao, sessionId), auditDao)
        val scenario = PlanExecutionScenario(
            auditScenario = ActionAuditScenario(
                name = "owner approves sending a previously drafted reply",
                sessionId = sessionId,
                expectedActions = listOf(ExpectedAuditAction("email_send"))
            ),
            goal = "Send the drafted reply",
            calls = listOf(
                PendingToolCall(
                    callId = "send-draft",
                    name = "email_send",
                    arguments = JSONObject().put("draftId", "draft-1"),
                    summary = "Send draft draft-1"
                )
            )
        )
        val result = runner.run(scenario) { ToolApplyResult("Sent", JSONObject().put("status", "applied").toString()) }
        assertEquals(PlanStatus.DONE, result.plan.status)
        assertTrue(result.auditResult.passed)
    }

    @Test
    fun gmailUnsubscribeRequiresApprovalThenSucceeds() = runBlocking {
        val sessionId = "gmail-unsubscribe"
        val auditDao = InMemoryActionLogDao()
        val runner = PlanExecutionScenarioRunner(newExecutor(auditDao, sessionId), auditDao)
        val scenario = PlanExecutionScenario(
            auditScenario = ActionAuditScenario(
                name = "owner approves unsubscribing from a mailing list",
                sessionId = sessionId,
                expectedActions = listOf(ExpectedAuditAction("gmail_unsubscribe"))
            ),
            goal = "Unsubscribe from this list",
            calls = listOf(
                PendingToolCall(
                    callId = "unsub-1",
                    name = "gmail_unsubscribe",
                    arguments = JSONObject().put("messageId", "msg-1"),
                    summary = "Unsubscribe msg-1"
                )
            )
        )
        val result = runner.run(scenario) { ToolApplyResult("Unsubscribed", JSONObject().put("status", "applied").toString()) }
        assertEquals(PlanStatus.DONE, result.plan.status)
        assertTrue(result.auditResult.passed)
    }

    @Test
    fun rememberFactThenForgetFactBothSucceed() = runBlocking {
        val sessionId = "memory-fact"
        val auditDao = InMemoryActionLogDao()
        val runner = PlanExecutionScenarioRunner(newExecutor(auditDao, sessionId), auditDao)
        val scenario = PlanExecutionScenario(
            auditScenario = ActionAuditScenario(
                name = "owner states a preference and later deletes it",
                sessionId = sessionId,
                expectedActions = listOf(
                    ExpectedAuditAction("remember_fact"),
                    ExpectedAuditAction("forget_fact")
                )
            ),
            goal = "Remember and then forget a preference",
            calls = listOf(
                PendingToolCall(
                    callId = "remember-1",
                    name = "remember_fact",
                    arguments = JSONObject().put("content", "Prefers dark mode").put("category", "preference"),
                    summary = "Remember: prefers dark mode"
                ),
                PendingToolCall(
                    callId = "forget-1",
                    name = "forget_fact",
                    arguments = JSONObject().put("id", "fact-1"),
                    summary = "Forget fact fact-1"
                )
            )
        )
        val result = runner.run(scenario) { ToolApplyResult("Done", JSONObject().put("status", "applied").toString()) }
        assertEquals(PlanStatus.DONE, result.plan.status)
        assertTrue(result.auditResult.passed)
    }

    @Test
    fun tapSetTextScrollAccessibilityChainSucceeds() = runBlocking {
        val sessionId = "accessibility-chain"
        val auditDao = InMemoryActionLogDao()
        val runner = PlanExecutionScenarioRunner(newExecutor(auditDao, sessionId), auditDao)
        val scenario = PlanExecutionScenario(
            auditScenario = ActionAuditScenario(
                name = "fill and submit a form via accessibility",
                sessionId = sessionId,
                expectedActions = listOf(
                    ExpectedAuditAction("scroll"),
                    ExpectedAuditAction("set_text"),
                    ExpectedAuditAction("tap_element")
                )
            ),
            goal = "Fill in the search box and submit",
            calls = listOf(
                PendingToolCall(
                    callId = "scroll-1",
                    name = "scroll",
                    arguments = JSONObject().put("direction", "down"),
                    summary = "Scroll down"
                ),
                PendingToolCall(
                    callId = "set-text-1",
                    name = "set_text",
                    arguments = JSONObject().put("resourceId", "search_box").put("value", "coffee"),
                    summary = "Type 'coffee'"
                ),
                PendingToolCall(
                    callId = "tap-1",
                    name = "tap_element",
                    arguments = JSONObject().put("resourceId", "search_button"),
                    summary = "Tap search"
                )
            )
        )
        val result = runner.run(scenario) { ToolApplyResult("Done", JSONObject().put("status", "applied").toString()) }
        assertEquals(PlanStatus.DONE, result.plan.status)
        assertEquals(3, result.plan.steps.count { it.status == StepStatus.DONE })
        assertTrue(result.auditResult.passed)
    }

    @Test
    fun openDeeplinkBlockedByCentralizedEgressValidator() = runBlocking {
        val sessionId = "egress-blocked"
        val auditDao = InMemoryActionLogDao()
        val executor = PlanExecutor(
            planDao = InMemoryPlanDao(),
            trustGate = TrustGate(
                auditDao,
                sessionId,
                egressValidator = { name, _ -> if (name == "open_deeplink") "EGRESS_DESTINATION_NOT_ALLOWED" else null }
            ),
            verifier = PostConditionVerifier(
                prefs = UserPrefsRepository(InstrumentationRegistry.getInstrumentation().targetContext),
                feedRepository = FeedRepository(NoOpFeedDao()),
                activeNotificationKeys = { emptySet() }
            )
        )
        val runner = PlanExecutionScenarioRunner(executor, auditDao)
        val scenario = PlanExecutionScenario(
            auditScenario = ActionAuditScenario(
                name = "deep link to a non-allow-listed domain is blocked before execution",
                sessionId = sessionId,
                expectedActions = emptyList()
            ),
            goal = "Open a suspicious link",
            calls = listOf(
                PendingToolCall(
                    callId = "open-bad-link",
                    name = "open_deeplink",
                    arguments = JSONObject().put("uri", "https://not-allowed.example/phish"),
                    summary = "Open deep link: https://not-allowed.example/phish"
                )
            )
        )
        var wasApplied = false
        val result = runner.run(scenario) {
            wasApplied = true
            ToolApplyResult("Unexpected", JSONObject().put("status", "applied").toString())
        }
        assertEquals(false, wasApplied)
        assertEquals(StepStatus.BLOCKED, result.plan.steps[0].status)
        assertEquals("EGRESS_DESTINATION_NOT_ALLOWED", result.plan.steps[0].blockReason)
        assertTrue(result.auditResult.passed)
    }

    @Test
    fun duplicateIdenticalCallsCountAsRedundantSteps() = runBlocking {
        val sessionId = "redundant-steps"
        val auditDao = InMemoryActionLogDao()
        val runner = PlanExecutionScenarioRunner(newExecutor(auditDao, sessionId), auditDao)
        val scenario = PlanExecutionScenario(
            auditScenario = ActionAuditScenario(
                name = "the model repeats the same check-for-updates call twice",
                sessionId = sessionId,
                expectedActions = listOf(
                    ExpectedAuditAction("check_for_updates"),
                    ExpectedAuditAction("check_for_updates")
                )
            ),
            goal = "Check for updates (repeated)",
            calls = listOf(
                PendingToolCall(
                    callId = "check-a",
                    name = "check_for_updates",
                    arguments = JSONObject(),
                    summary = "Check for updates"
                ),
                PendingToolCall(
                    callId = "check-b",
                    name = "check_for_updates",
                    arguments = JSONObject(),
                    summary = "Check for updates"
                )
            )
        )
        val result = runner.run(scenario) { ToolApplyResult("No updates", JSONObject().put("status", "applied").toString()) }
        assertEquals(PlanStatus.DONE, result.plan.status)
        assertEquals(1, result.auditResult.metrics.redundantStepCount)
        assertTrue(result.auditResult.passed)
    }

    private fun newExecutor(auditDao: ActionLogDao, sessionId: String): PlanExecutor {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        return PlanExecutor(
            planDao = InMemoryPlanDao(),
            trustGate = TrustGate(auditDao, sessionId),
            verifier = PostConditionVerifier(
                prefs = UserPrefsRepository(context),
                feedRepository = FeedRepository(NoOpFeedDao()),
                activeNotificationKeys = { emptySet() }
            )
        )
    }

    private fun openAppCall(callId: String) = PendingToolCall(
        callId = callId,
        name = "open_app",
        arguments = JSONObject().put("packageName", "com.google.android.calendar"),
        summary = "Open Calendar"
    )
}

private class InMemoryActionLogDao : ActionLogDao {
    private val entries = mutableListOf<ActionLogEntity>()

    override suspend fun insert(entry: ActionLogEntity) { entries += entry }

    override suspend fun updateOutcome(id: String, outcome: String, postConditionPassed: Boolean?, outcomeDetail: String?, undoAvailable: Boolean, latencyMs: Long) {
        replace(id) { it.copy(outcome = outcome, postConditionPassed = postConditionPassed, outcomeDetail = outcomeDetail, undoAvailable = undoAvailable, latencyMs = latencyMs) }
    }

    override suspend fun markBlocked(id: String, blockReason: String, outcomeDetail: String, latencyMs: Long) {
        replace(id) { it.copy(decision = "blocked", blockReason = blockReason, outcome = "failure", postConditionPassed = false, outcomeDetail = outcomeDetail, latencyMs = latencyMs) }
    }

    override suspend fun markRejected(id: String, outcomeDetail: String) {
        replace(id) { it.copy(decision = "rejected", outcome = "failure", outcomeDetail = outcomeDetail) }
    }

    override fun recentFlow(limit: Int): Flow<List<ActionLogEntity>> = flowOf(entries.takeLast(limit))
    override suspend fun forSession(sessionId: String): List<ActionLogEntity> = entries.filter { it.sessionId == sessionId }
    override suspend fun allOnce(): List<ActionLogEntity> = entries.sortedByDescending { it.timestamp }
    override fun blockedFlow(limit: Int): Flow<List<ActionLogEntity>> = flowOf(entries.filter { it.decision == "blocked" || it.decision == "rejected" }.takeLast(limit))
    override suspend fun taintedActionsSince(since: Long): Int = entries.count { it.tainted && it.timestamp > since }
    override suspend fun injectionAttemptCount(): Int = entries.count { it.decision == "blocked" && it.blockReason?.contains("INJECTION") == true }
    override suspend fun totalCostSince(since: Long): Double? = entries.mapNotNull { it.costEstimate }.sum().takeIf { it > 0.0 }
    override fun totalCostSinceFlow(since: Long): Flow<Double?> = flowOf(entries.mapNotNull { it.costEstimate }.sum().takeIf { it > 0.0 })

    private fun replace(id: String, transform: (ActionLogEntity) -> ActionLogEntity) {
        val index = entries.indexOfFirst { it.id == id }
        if (index >= 0) entries[index] = transform(entries[index])
    }
}

private class InMemoryPlanDao : PlanDao {
    private val plans = mutableMapOf<String, PlanEntity>()
    private val steps = mutableMapOf<String, StepEntity>()

    override suspend fun insertPlan(plan: PlanEntity) { plans[plan.id] = plan }
    override suspend fun insertSteps(steps: List<StepEntity>) { steps.forEach { this.steps[it.id] = it } }
    override suspend fun updatePlanStatus(id: String, status: String, tainted: Boolean, taintSource: String?) {
        plans[id]?.let { plans[id] = it.copy(status = status, tainted = tainted, taintSource = taintSource) }
    }
    override suspend fun updateStep(id: String, status: String, blockReason: String?, postConditionPassed: Boolean?, outcomeDetail: String?, rollbackAvailable: Boolean) {
        steps[id]?.let { steps[id] = it.copy(status = status, blockReason = blockReason, postConditionPassed = postConditionPassed, outcomeDetail = outcomeDetail, rollbackAvailable = rollbackAvailable) }
    }
    override suspend fun getPlan(id: String): PlanEntity? = plans[id]
    override suspend fun stepsForPlan(planId: String): List<StepEntity> = steps.values.filter { it.planId == planId }.sortedBy { it.orderIndex }
    override suspend fun activePlan(): PlanEntity? = plans.values.lastOrNull { it.status in setOf("PROPOSED", "APPROVED", "RUNNING", "PAUSED") }
    override fun plansForSessionFlow(sessionId: String): Flow<List<PlanEntity>> = flowOf(plans.values.filter { it.sessionId == sessionId })
    override suspend fun deletePlan(id: String) { plans.remove(id) }
    override suspend fun deleteStepsForPlan(id: String) { steps.values.removeAll { it.planId == id } }
}

private class NoOpFeedDao : FeedDao {
    override fun feedStream(): Flow<List<FeedItemEntity>> = flowOf(emptyList())
    override suspend fun insert(item: FeedItemEntity) = Unit
    override suspend fun insertAll(items: List<FeedItemEntity>) = Unit
    override suspend fun updateStatus(id: String, status: FeedStatus, updatedAt: Long) = Unit
    override suspend fun archive(id: String, updatedAt: Long) = Unit
    override suspend fun markSeen(id: String, updatedAt: Long) = Unit
    override suspend fun getById(id: String): FeedItemEntity? = null
    override suspend fun getByThreadKey(threadKey: String): FeedItemEntity? = null
    override suspend fun getLatestByPackageAndCategory(packageName: String, category: FeedCategory): FeedItemEntity? = null
    override suspend fun getByPackageAndCategoryExcept(packageName: String, category: FeedCategory, keepId: String): List<FeedItemEntity> = emptyList()
    override suspend fun archiveByPackageAndCategoryExcept(packageName: String, category: FeedCategory, keepId: String, updatedAt: Long) = Unit
    override suspend fun countAll(): Int = 0
    override suspend fun clearAll() = Unit
    override suspend fun distinctPackages(): List<String> = emptyList()
    override suspend fun getAll(): List<FeedItemEntity> = emptyList()
}