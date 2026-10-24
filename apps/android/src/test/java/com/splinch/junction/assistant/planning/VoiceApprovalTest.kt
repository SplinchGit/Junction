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

    @Test fun `mutable remote drafts require screen approval until immutable send is available`() {
        val plan = Plan(id = "p", goal = "Email", sessionId = "s", trigger = Provenance.OWNER,
            steps = mutableListOf(Step(callId = "c", tool = "email_send", arguments = JSONObject().put("draftId", "d"), summary = "Send", riskTier = RiskTier.OUTBOUND)))
        val disclosure = VoiceApprovalPolicy.disclose(plan,
            { VoiceApprovalPolicy.DraftDisclosure("owner@example.test", "Reviewed body") }, { "same-draft-id" })
        assertTrue(disclosure is VoiceApprovalPolicy.Disclosure.ScreenOnly)
    }
}
