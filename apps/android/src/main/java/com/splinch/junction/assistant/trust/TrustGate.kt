package com.splinch.junction.assistant.trust

import com.splinch.junction.assistant.context.*
import com.splinch.junction.assistant.conversation.*
import com.splinch.junction.assistant.planning.*
import com.splinch.junction.assistant.provider.*
import com.splinch.junction.assistant.runtime.*
import com.splinch.junction.assistant.tools.*
import com.splinch.junction.assistant.trust.*

import com.splinch.junction.assistant.tools.RiskTier
import com.splinch.junction.assistant.tools.ToolRegistry
import com.splinch.junction.assistant.tools.isStateChanging
import com.splinch.junction.data.database.audit.ActionLogDao
import com.splinch.junction.data.database.audit.ActionLogEntity
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import org.json.JSONArray
import org.json.JSONObject

// ─── Public types ────────────────────────────────────────────────────────────

sealed class TrustDecision {
    /** Tool call approved to execute. Null when the call belongs to no plan. */
    data class Allow(val planId: String?) : TrustDecision()

    /** Requires explicit owner confirmation before execution. */
    data class RequireConfirmation(
        val planId: String?,
        val tainted: Boolean,
        val taintSource: String?
    ) : TrustDecision()

    /** Rejected – will not execute under any circumstances this turn. */
    data class Block(val reason: String) : TrustDecision()
}

object BlockReasons {
    const val TRIGGER_PROVENANCE = "TRIGGER_PROVENANCE"
    const val PLAN_MISMATCH = "PLAN_MISMATCH"
    const val UNKNOWN_TOOL = "UNKNOWN_TOOL"
    const val MISSING_PROVENANCE = "MISSING_PROVENANCE"
    const val EGRESS_DESTINATION_NOT_ALLOWED = "EGRESS_DESTINATION_NOT_ALLOWED"
}

// ─── TrustGate ───────────────────────────────────────────────────────────────

/**
 * Evaluates every pending tool call against the spec's trust model:
 *
 *  • Only OWNER-triggered turns may initiate state-changing tools.
 *  • If UNTRUSTED content entered recent context (N=3), always-allow
 *    promotions are suspended and risk tiers escalated.
 *  • Plan-hash binding: SHA-256 of canonical args stored at proposal
 *    time; verified before execution. Mismatch → PLAN_MISMATCH block.
 *  • Audit log: every evaluation writes exactly one ActionLogEntity row.
 */
class TrustGate(
    private val auditDao: ActionLogDao,
    private val sessionId: String,
    private val taintWindowSize: Int = 3,
    /**
     * §1.7 egress constraints, centralized: given a would-be egress tool call,
     * return a block reason if its destination isn't allowed, or null to let
     * the normal tier/taint rules decide. Runs before any auto-allow path so
     * a stray "always allow" grant on an egress tool can never bypass it.
     */
    private val egressValidator: suspend (toolName: String, args: JSONObject) -> String? = { _, _ -> null }
) {
    // Context blocks recorded this session (most recent last)
    private val contextBlocks = mutableListOf<ContextBlockRecord>()

    // Always-allow grants: toolName → granted
    private val alwaysAllowed = mutableSetOf<String>()

    // Pending plan hashes: callId → hex(SHA-256(canonical args))
    private val pendingPlanHashes = ConcurrentHashMap<String, String>()

    // Each evaluated call owns one append-only audit row whose outcome is completed in place.
    private val pendingAuditIds = ConcurrentHashMap<String, String>()

    /**
     * Record that a context block with the given provenance was injected
     * into the current context window.
     */
    fun recordContextBlock(provenance: Provenance, sourceRef: String) {
        contextBlocks.add(ContextBlockRecord(provenance, sourceRef))
        // Keep only the last taintWindowSize blocks
        while (contextBlocks.size > taintWindowSize) {
            contextBlocks.removeAt(0)
        }
    }

    /**
     * Grant permanent always-allow for a tool in this session.
     * Suspended automatically when session becomes tainted.
     */
    fun grantAlwaysAllow(toolName: String) {
        if (ToolRegistry.get(toolName)?.riskTier != RiskTier.DESTRUCTIVE) {
            alwaysAllowed.add(toolName)
        }
    }

    /** Revoke a previously granted always-allow promotion. */
    fun revokeAlwaysAllow(toolName: String) {
        alwaysAllowed.remove(toolName)
    }

    /** Load persisted grants (e.g. from UserPrefsRepository) into this session. */
    fun seedAlwaysAllowed(toolNames: Set<String>) {
        alwaysAllowed.clear()
        alwaysAllowed.addAll(toolNames.filter { ToolRegistry.get(it)?.riskTier != RiskTier.DESTRUCTIVE })
    }

    fun currentAlwaysAllowed(): Set<String> = alwaysAllowed.toSet()

    /**
     * Evaluate a pending tool call and return the trust decision.
     * Writes an audit row for every evaluation.
     *
     * [planId] must be the id of the plan this call belongs to, so every step
     * of one plan shares it, and null for a standalone call that belongs to no
     * plan. This used to mint a fresh UUID per call, which meant the audit
     * trail could not tell "one plan, three steps" from "three unrelated single
     * actions" — see ActionAuditEvaluator, which groups by exactly this column
     * and treats a null as its own single-action task.
     */
    suspend fun evaluate(
        call: PendingToolCall,
        triggerProvenance: Provenance,
        costEstimate: Double? = null,
        planId: String? = null
    ): TrustDecision {
        val taintInfo = sessionTaint()

        // Determine registration/tier early for provenance gating logic.
        val registration = ToolRegistry.get(call.name)
        if (registration == null) {
            val decision = TrustDecision.Block(BlockReasons.UNKNOWN_TOOL)
            writeAuditRow(
                planId = planId,
                call = call,
                triggerProvenance = triggerProvenance,
                tainted = taintInfo != null,
                taintSource = taintInfo,
                decision = "blocked",
                blockReason = BlockReasons.UNKNOWN_TOOL,
                effectiveTier = "UNKNOWN",
                costEstimate = costEstimate
            )
            return decision
        }

        val effectiveTier = if (taintInfo != null) registration.riskTier.escalated() else registration.riskTier

        // Rule 1: only OWNER-triggered turns may initiate state-changing tools.
        if (triggerProvenance != Provenance.OWNER && effectiveTier.isStateChanging) {
            val decision = TrustDecision.Block(BlockReasons.TRIGGER_PROVENANCE)
            writeAuditRow(
                planId = planId,
                call = call,
                triggerProvenance = triggerProvenance,
                tainted = taintInfo != null,
                taintSource = taintInfo,
                decision = "blocked",
                blockReason = BlockReasons.TRIGGER_PROVENANCE,
                effectiveTier = effectiveTier.name,
                costEstimate = costEstimate
            )
            return decision
        }

        // Rule 2: centralized egress-destination constraint (§1.7). Checked
        // ahead of every auto-allow path, including always-allow.
        if (registration.isEgressTool) {
            val egressBlockReason = egressValidator(call.name, call.arguments)
            if (egressBlockReason != null) {
                val decision = TrustDecision.Block(egressBlockReason)
                writeAuditRow(
                    planId = planId,
                    call = call,
                    triggerProvenance = triggerProvenance,
                    tainted = taintInfo != null,
                    taintSource = taintInfo,
                    decision = "blocked",
                    blockReason = egressBlockReason,
                    effectiveTier = effectiveTier.name,
                    costEstimate = costEstimate
                )
                return decision
            }
        }

        // Rule 3: READ tier with no taint → auto-allow
        if (effectiveTier == RiskTier.READ && taintInfo == null) {
            val decision = TrustDecision.Allow(planId)
            pendingAuditIds[call.callId] = writeAuditRow(
                planId = planId,
                call = call,
                triggerProvenance = triggerProvenance,
                tainted = false,
                taintSource = null,
                decision = "allowed",
                blockReason = null,
                effectiveTier = effectiveTier.name,
                costEstimate = costEstimate
            )
            return decision
        }

        // Rule 4: always-allow grants (suspended when tainted)
        if (registration.riskTier != RiskTier.DESTRUCTIVE && alwaysAllowed.contains(call.name) && taintInfo == null) {
            val decision = TrustDecision.Allow(planId)
            pendingAuditIds[call.callId] = writeAuditRow(
                planId = planId,
                call = call,
                triggerProvenance = triggerProvenance,
                tainted = false,
                taintSource = null,
                decision = "allowed",
                blockReason = null,
                effectiveTier = effectiveTier.name,
                costEstimate = costEstimate
            )
            return decision
        }

        // Rule 5: all other cases → require confirmation; store plan hash
        val hash = planHash(call)
        pendingPlanHashes[call.callId] = hash

        val decision = TrustDecision.RequireConfirmation(
            planId = planId,
            tainted = taintInfo != null,
            taintSource = taintInfo
        )
        pendingAuditIds[call.callId] = writeAuditRow(
            planId = planId,
            call = call,
            triggerProvenance = triggerProvenance,
            tainted = taintInfo != null,
            taintSource = taintInfo,
            decision = "pending_confirmation",
            blockReason = null,
            effectiveTier = effectiveTier.name,
            costEstimate = costEstimate
        )
        return decision
    }

    /**
     * Verify plan hash before executing a previously confirmed call.
     * Returns null if OK, Block(PLAN_MISMATCH) if args were mutated.
     */
    suspend fun verifyBeforeExecute(call: PendingToolCall): TrustDecision.Block? {
        val stored = pendingPlanHashes[call.callId] ?: return null
        val current = planHash(call)
        if (stored == current) {
            pendingPlanHashes.remove(call.callId)
            return null
        }
        val block = TrustDecision.Block(BlockReasons.PLAN_MISMATCH)
        pendingPlanHashes.remove(call.callId)
        pendingAuditIds.remove(call.callId)?.let { auditId ->
            auditDao.markBlocked(
                id = auditId,
                blockReason = BlockReasons.PLAN_MISMATCH,
                outcomeDetail = "Plan hash mismatch at execution time — arguments changed after approval.",
                latencyMs = 0L
            )
        }
        return block
    }

    suspend fun recordOutcome(
        call: PendingToolCall,
        succeeded: Boolean,
        postConditionPassed: Boolean?,
        detail: String,
        undoAvailable: Boolean,
        latencyMs: Long
    ) {
        pendingAuditIds.remove(call.callId)?.let { auditId ->
            auditDao.updateOutcome(
                id = auditId,
                outcome = if (succeeded) "success" else "failure",
                postConditionPassed = postConditionPassed,
                outcomeDetail = detail,
                undoAvailable = undoAvailable,
                latencyMs = latencyMs
            )
        }
    }

    suspend fun recordRejection(call: PendingToolCall, detail: String) {
        pendingPlanHashes.remove(call.callId)
        pendingAuditIds.remove(call.callId)?.let { auditId ->
            auditDao.markRejected(auditId, detail)
        }
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    /** Returns the sourceRef of the first UNTRUSTED block in the window, or null. */
    private fun sessionTaint(): String? {
        return contextBlocks.firstOrNull { it.provenance == Provenance.UNTRUSTED }?.sourceRef
    }

    private fun planHash(call: PendingToolCall): String {
        val canonical = "${call.name}:${canonicalizeJson(call.arguments)}"
        val digest = MessageDigest.getInstance("SHA-256")
        return digest.digest(canonical.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }

    private fun canonicalizeJson(value: Any?): String {
        return when (value) {
            null -> "null"
            is JSONObject -> {
                val keys = value.keys().asSequence().toList().sorted()
                buildString {
                    append('{')
                    keys.forEachIndexed { idx, key ->
                        if (idx > 0) append(',')
                        append(JSONObject.quote(key)).append(':')
                        append(canonicalizeJson(value.opt(key)))
                    }
                    append('}')
                }
            }
            is JSONArray -> {
                buildString {
                    append('[')
                    for (i in 0 until value.length()) {
                        if (i > 0) append(',')
                        append(canonicalizeJson(value.opt(i)))
                    }
                    append(']')
                }
            }
            is String -> JSONObject.quote(value)
            is Number, is Boolean -> value.toString()
            else -> JSONObject.quote(value.toString())
        }
    }

    private suspend fun writeAuditRow(
        planId: String?,
        call: PendingToolCall,
        triggerProvenance: Provenance,
        tainted: Boolean,
        taintSource: String?,
        decision: String,
        blockReason: String?,
        effectiveTier: String,
        costEstimate: Double? = null
    ): String {
        val registration = ToolRegistry.get(call.name)
        val auditId = UUID.randomUUID().toString()
        auditDao.insert(
            ActionLogEntity(
                id = auditId,
                timestamp = System.currentTimeMillis(),
                sessionId = sessionId,
                planId = planId,
                stepId = null,
                toolName = call.name,
                argumentsJson = call.arguments.toString(),
                planText = call.summary,
                planHash = planHash(call),
                riskTier = registration?.riskTier?.name ?: "UNKNOWN",
                effectiveTier = effectiveTier,
                triggerProvenance = triggerProvenance.name,
                tainted = tainted,
                taintSource = taintSource,
                decision = decision,
                blockReason = blockReason,
                outcome = null,
                postConditionPassed = null,
                outcomeDetail = null,
                undoAvailable = false,
                latencyMs = null,
                provider = null,
                model = null,
                tokensIn = null,
                tokensOut = null,
                costEstimate = costEstimate
            )
        )
        return auditId
    }
}

private data class ContextBlockRecord(
    val provenance: Provenance,
    val sourceRef: String
)
