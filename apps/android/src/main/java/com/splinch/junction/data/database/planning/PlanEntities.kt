package com.splinch.junction.data.database.planning

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * §2.1/§2.3 typed plan persistence. Plans survive interruption: an unrelated
 * exchange mid-plan pauses rather than destroys it, and Junction can resume
 * on request. Resumption re-checks taint and re-validates the plan hash
 * (see TrustGate.verifyBeforeExecute, called again per-step on resume).
 */
@Entity(tableName = "plans")
data class PlanEntity(
    @PrimaryKey val id: String,
    val goal: String,
    val sessionId: String,
    val trigger: String,       // Provenance name
    val status: String,        // PlanStatus name
    val tainted: Boolean,
    val taintSource: String?,
    val createdAt: Long
)

@Entity(tableName = "plan_steps")
data class StepEntity(
    @PrimaryKey val id: String,
    val planId: String,
    val callId: String,
    val orderIndex: Int,
    val tool: String,
    val argumentsJson: String,
    val summary: String,
    val riskTier: String,
    val dependsOnJson: String,     // JSON array of step ids this step waits on
    val status: String,            // StepStatus name
    val blockReason: String? = null,
    val postConditionPassed: Boolean? = null,
    val outcomeDetail: String? = null,
    val rollbackAvailable: Boolean = false
)
