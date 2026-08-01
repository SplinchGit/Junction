package com.splinch.junction.data.database.planning

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

/**
 * §2.1/§2.3 persistence for the typed Plan/Step pipeline. Supports resuming
 * an interrupted plan: [activePlan] finds the most recent plan still in a
 * non-terminal status so the app can offer to resume it on next launch or
 * next turn, re-checking taint and plan hash before continuing.
 */
@Dao
interface PlanDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPlan(plan: PlanEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSteps(steps: List<StepEntity>)

    @Transaction
    suspend fun insertPlanWithSteps(plan: PlanEntity, steps: List<StepEntity>) {
        insertPlan(plan)
        insertSteps(steps)
    }

    @Query("UPDATE plans SET status = :status, tainted = :tainted, taintSource = :taintSource WHERE id = :id")
    suspend fun updatePlanStatus(id: String, status: String, tainted: Boolean, taintSource: String?)

    @Query("""
        UPDATE plan_steps
        SET status = :status,
            blockReason = :blockReason,
            postConditionPassed = :postConditionPassed,
            outcomeDetail = :outcomeDetail,
            rollbackAvailable = :rollbackAvailable
        WHERE id = :id
    """)
    suspend fun updateStep(
        id: String,
        status: String,
        blockReason: String?,
        postConditionPassed: Boolean?,
        outcomeDetail: String?,
        rollbackAvailable: Boolean
    )

    @Query("SELECT * FROM plans WHERE id = :id")
    suspend fun getPlan(id: String): PlanEntity?

    @Query("SELECT * FROM plan_steps WHERE planId = :planId ORDER BY orderIndex ASC")
    suspend fun stepsForPlan(planId: String): List<StepEntity>

    /** Most recent plan still awaiting or mid execution — the one to offer resuming. */
    @Query("""
        SELECT * FROM plans
        WHERE status IN ('PROPOSED', 'APPROVED', 'RUNNING', 'PAUSED')
        ORDER BY createdAt DESC
        LIMIT 1
    """)
    suspend fun activePlan(): PlanEntity?

    @Query("SELECT * FROM plans WHERE sessionId = :sessionId ORDER BY createdAt DESC")
    fun plansForSessionFlow(sessionId: String): Flow<List<PlanEntity>>

    @Query("DELETE FROM plans WHERE id = :id")
    suspend fun deletePlan(id: String)

    @Query("DELETE FROM plan_steps WHERE planId = :id")
    suspend fun deleteStepsForPlan(id: String)
}
