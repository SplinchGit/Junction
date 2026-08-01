package com.splinch.junction.data.database.audit

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Append-only audit log.
 * Every path through the executor writes exactly one row — including rejections,
 * policy blocks, plan-hash mismatches and undos.
 * Only [outcome], [postConditionPassed], and [outcomeDetail] are written after
 * the initial insert (when the action completes).
 */
@Entity(tableName = "action_log")
data class ActionLogEntity(
    @PrimaryKey val id: String,
    val timestamp: Long,
    val sessionId: String,
    val planId: String? = null,
    val stepId: String? = null,
    val toolName: String,
    val argumentsJson: String,
    val planText: String? = null,
    val planHash: String? = null,
    // Risk
    val riskTier: String,             // RiskTier name
    val effectiveTier: String,        // after taint escalation
    // Provenance
    val triggerProvenance: String,    // Provenance name
    val tainted: Boolean = false,
    val taintSource: String? = null,
    // Decision
    val decision: String,             // "auto" | "confirmed" | "rejected" | "blocked"
    val blockReason: String? = null,
    // Outcome — written after execution
    val outcome: String? = null,      // "success" | "failure" | "undone"
    val postConditionPassed: Boolean? = null,
    val outcomeDetail: String? = null,
    val undoAvailable: Boolean = false,
    // Performance
    val latencyMs: Long? = null,
    // Provider
    val provider: String? = null,
    val model: String? = null,
    val tokensIn: Int? = null,
    val tokensOut: Int? = null,
    val costEstimate: Double? = null
)
