package com.splinch.junction.follow.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.splinch.junction.follow.FollowTargetEntity
import com.splinch.junction.follow.InterestRuleEntity
import com.splinch.junction.follow.RejectedSuggestionEntity
import com.splinch.junction.follow.SuggestionEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface FollowDao {
    // Follow targets
    @Query("SELECT * FROM follow_targets WHERE isEnabled = 1 ORDER BY importance DESC, updatedAt DESC")
    fun activeFollowTargetsFlow(): Flow<List<FollowTargetEntity>>

    @Query("SELECT * FROM follow_targets ORDER BY importance DESC, updatedAt DESC")
    fun allFollowTargetsFlow(): Flow<List<FollowTargetEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertFollowTarget(target: FollowTargetEntity)

    @Query("DELETE FROM follow_targets WHERE id = :id")
    suspend fun deleteFollowTarget(id: String)

    // Interest rules
    @Query("SELECT * FROM interest_rules WHERE isEnabled = 1 ORDER BY updatedAt DESC")
    fun activeInterestRulesFlow(): Flow<List<InterestRuleEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertInterestRule(rule: InterestRuleEntity)

    @Query("DELETE FROM interest_rules WHERE id = :id")
    suspend fun deleteInterestRule(id: String)

    // Suggestions
    @Query(
        """
        SELECT * FROM suggestions
        WHERE status = 'PENDING'
           OR (status = 'SNOOZED' AND (snoozedUntil IS NULL OR snoozedUntil <= :now))
        ORDER BY updatedAt DESC
        """
    )
    fun actionableSuggestionsFlow(now: Long): Flow<List<SuggestionEntity>>

    @Query("SELECT * FROM suggestions WHERE key = :key LIMIT 1")
    suspend fun getSuggestionByKey(key: String): SuggestionEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertSuggestion(suggestion: SuggestionEntity)

    @Query("DELETE FROM suggestions WHERE id = :id")
    suspend fun deleteSuggestion(id: String)

    // Rejected suggestions
    @Query("SELECT * FROM rejected_suggestions WHERE key = :key LIMIT 1")
    suspend fun getRejected(key: String): RejectedSuggestionEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertRejected(rejected: RejectedSuggestionEntity)
}

