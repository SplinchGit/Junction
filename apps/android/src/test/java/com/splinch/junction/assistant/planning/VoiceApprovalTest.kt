package com.splinch.junction.assistant.planning

import com.splinch.junction.assistant.context.Provenance
import com.splinch.junction.assistant.tools.RiskTier
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class VoiceApprovalTest {
    private fun offered() = VoiceApprovalGate().apply {
        offer("plan", "digest", "send", "Send the draft", "Email", "call", 0)
        promptCompleted(100)
    }

    @Test fun `confirmation is single use and bound to call and disclosure`() {
        val gate = offered()
        assertTrue(gate.handle("send it", 200, "call", "plan", "digest") is VoiceApprovalGate.Decision.Approve)
        assertTrue(gate.handle("send it", 201, "call", "plan", "digest") is VoiceApprovalGate.Decision.PassThrough)
        assertTrue(offered().handle("send it", 200, "other", "plan", "digest") is VoiceApprovalGate.Decision.PassThrough)
        assertTrue(offered().handle("send it", 200, "call", "plan", "changed") is VoiceApprovalGate.Decision.Say)
    }

    @Test fun `expired incidental and overlapping confirmations cannot approve`() {
        assertTrue(offered().handle("send it", 45101, "call", "plan", "digest") is VoiceApprovalGate.Decision.Say)
        assertTrue(offered().handle("yes", 200, "call", "plan", "digest") is VoiceApprovalGate.Decision.Say)
        assertTrue(offered().handle("send it", 100, "call", "plan", "digest") is VoiceApprovalGate.Decision.Say)
        assertTrue(offered().handle("cancel", 200, "call", "plan", "digest") is VoiceApprovalGate.Decision.Cancel)
        assertTrue(offered().handle("send it to Bob instead", 200, "call", "plan", "digest") is VoiceApprovalGate.Decision.PassThrough)
    }

    @Test fun `an email send is read aloud with its recipient and bound to the exact draft content`() {
        fun plan() = Plan(id = "p", goal = "Email", sessionId = "s", trigger = Provenance.OWNER,
            steps = mutableListOf(Step(callId = "c", tool = "email_send", arguments = JSONObject().put("draftId", "d"), summary = "Send", riskTier = RiskTier.OUTBOUND)))
        val heard = VoiceApprovalPolicy.disclose(plan(), { VoiceApprovalPolicy.DraftDisclosure("owner@example.test", "Reviewed body") }, { "same-draft-id" })
        assertTrue(heard is VoiceApprovalPolicy.Disclosure.Eligible)
        heard as VoiceApprovalPolicy.Disclosure.Eligible
        assertTrue(heard.spoken.contains("owner@example.test") && heard.spoken.contains("Reviewed body"))
        assertEquals("send", heard.verb)
        // A different draft body (edited elsewhere) produces a different binding.
        val edited = VoiceApprovalPolicy.disclose(plan(), { VoiceApprovalPolicy.DraftDisclosure("owner@example.test", "Edited body") }, { "same-draft-id" })
        assertTrue(edited is VoiceApprovalPolicy.Disclosure.Eligible && edited.digest != heard.digest)
        // Unknown drafts cannot be read back, so they stay on screen.
        assertTrue(VoiceApprovalPolicy.disclose(plan(), { null }, { "x" }) is VoiceApprovalPolicy.Disclosure.ScreenOnly)
    }

    @Test fun `a notification reply stays on screen because its target cannot be re-checked`() {
        val plan = Plan(id = "p", goal = "Reply", sessionId = "s", trigger = Provenance.OWNER,
            steps = mutableListOf(Step(callId = "c", tool = "reply_notification", arguments = JSONObject().put("notificationKey", "k").put("text", "On my way"), summary = "Reply", riskTier = RiskTier.OUTBOUND)))
        assertTrue(VoiceApprovalPolicy.disclose(plan, { null }, { "x" }) is VoiceApprovalPolicy.Disclosure.ScreenOnly)
    }

    @Test fun `code changes and merges never take voice approval`() {
        val plan = Plan(id = "p", goal = "Merge", sessionId = "s", trigger = Provenance.OWNER,
            steps = mutableListOf(Step(callId = "c", tool = "merge_github_change", arguments = JSONObject(), summary = "Merge PR", riskTier = RiskTier.DESTRUCTIVE)))
        assertTrue(VoiceApprovalPolicy.disclose(plan, { null }, { "x" }) is VoiceApprovalPolicy.Disclosure.ScreenOnly)
    }
}
