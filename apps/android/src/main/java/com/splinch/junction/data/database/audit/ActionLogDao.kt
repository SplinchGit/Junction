package com.splinch.junction.data.database.audit

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface ActionLogDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entry: ActionLogEntity)

    /** Write outcome fields after execution completes. */
    @Query("""
        UPDATE action_log
        SET outcome = :outcome,
            postConditionPassed = :postConditionPassed,
            outcomeDetail = :outcomeDetail,
            undoAvailable = :undoAvailable,
            latencyMs = :latencyMs
        WHERE id = :id
    """)
    suspend fun updateOutcome(
        id: String,
        outcome: String,
        postConditionPassed: Boolean?,
        outcomeDetail: String?,
        undoAvailable: Boolean,
        latencyMs: Long
    )

    @Query("""
        UPDATE action_log
        SET decision = 'blocked',
            blockReason = :blockReason,
            outcome = 'failure',
            postConditionPassed = 0,
            outcomeDetail = :outcomeDetail,
            latencyMs = :latencyMs
        WHERE id = :id
    """)
    suspend fun markBlocked(id: String, blockReason: String, outcomeDetail: String, latencyMs: Long)

    @Query("""
        UPDATE action_log
        SET decision = 'rejected',
            outcome = 'failure',
            outcomeDetail = :outcomeDetail
        WHERE id = :id
    """)
    suspend fun markRejected(id: String, outcomeDetail: String)

    @Query("SELECT * FROM action_log ORDER BY timestamp DESC LIMIT :limit")
    fun recentFlow(limit: Int = 100): Flow<List<ActionLogEntity>>

    @Query("SELECT * FROM action_log WHERE sessionId = :sessionId ORDER BY timestamp ASC")
    suspend fun forSession(sessionId: String): List<ActionLogEntity>

    /** §5.2 full history for on-demand telemetry export — a one-shot read, not a live Flow. */
    @Query("SELECT * FROM action_log ORDER BY timestamp DESC")
    suspend fun allOnce(): List<ActionLogEntity>

    @Query("SELECT * FROM action_log WHERE decision = 'blocked' OR decision = 'rejected' ORDER BY timestamp DESC LIMIT :limit")
    fun blockedFlow(limit: Int = 50): Flow<List<ActionLogEntity>>

    @Query("SELECT COUNT(*) FROM action_log WHERE tainted = 1 AND timestamp > :since")
    suspend fun taintedActionsSince(since: Long): Int

    @Query("SELECT COUNT(*) FROM action_log WHERE blockReason LIKE '%INJECTION%' OR blockReason LIKE '%TRIGGER_PROVENANCE%' ORDER BY timestamp DESC")
    suspend fun injectionAttemptCount(): Int

    @Query("SELECT SUM(costEstimate) FROM action_log WHERE timestamp > :since")
    suspend fun totalCostSince(since: Long): Double?

    /** §Cost control: reactive per-day running total for Settings — re-emits as new rows land. */
    @Query("SELECT SUM(costEstimate) FROM action_log WHERE timestamp > :since")
    fun totalCostSinceFlow(since: Long): Flow<Double?>
}
