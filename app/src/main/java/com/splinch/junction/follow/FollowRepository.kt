package com.splinch.junction.follow

import com.splinch.junction.follow.data.FollowDao
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class FollowRepository(private val dao: FollowDao) {
    fun followTargetsFlow(enabledOnly: Boolean = false): Flow<List<FollowTargetEntity>> {
        return if (enabledOnly) dao.activeFollowTargetsFlow() else dao.allFollowTargetsFlow()
    }

    fun interestRulesFlow(): Flow<List<InterestRuleEntity>> = dao.activeInterestRulesFlow()

    fun actionableSuggestionsFlow(now: () -> Long = { System.currentTimeMillis() }): Flow<List<SuggestionEntity>> {
        // Recompute "now" whenever upstream emits by mapping, without spinning a timer.
        return dao.actionableSuggestionsFlow(now()).map { it }
    }

    suspend fun upsertFollowTarget(target: FollowTargetEntity) = dao.upsertFollowTarget(target)

    suspend fun deleteFollowTarget(id: String) = dao.deleteFollowTarget(id)

    suspend fun upsertInterestRule(rule: InterestRuleEntity) = dao.upsertInterestRule(rule)

    suspend fun deleteInterestRule(id: String) = dao.deleteInterestRule(id)

    suspend fun upsertSuggestion(suggestion: SuggestionEntity) = dao.upsertSuggestion(suggestion)

    suspend fun dismissSuggestion(id: String) {
        // Keep it simple for now: delete. We can preserve history later if we want analytics.
        dao.deleteSuggestion(id)
    }

    suspend fun rejectSuggestionNever(key: String, sourceApp: SourceApp) {
        dao.upsertRejected(RejectedSuggestionEntity(key = key, sourceApp = sourceApp))
        dao.getSuggestionByKey(key)?.let { existing ->
            dao.upsertSuggestion(existing.copy(status = SuggestionStatus.REJECTED_NEVER, updatedAt = System.currentTimeMillis()))
        }
    }

    suspend fun isRejected(key: String): Boolean = dao.getRejected(key) != null
}

