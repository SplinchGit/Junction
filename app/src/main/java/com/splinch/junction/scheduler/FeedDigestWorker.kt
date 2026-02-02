package com.splinch.junction.scheduler

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.splinch.junction.data.JunctionDatabase
import com.splinch.junction.feed.FeedRepository
import com.splinch.junction.feed.model.FeedStatus
import com.splinch.junction.settings.UserPrefsRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext

class FeedDigestWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        return withContext(Dispatchers.Default) {
            val database = JunctionDatabase.getInstance(applicationContext)
            val repository = FeedRepository(database.feedDao())
            val prefs = UserPrefsRepository(applicationContext)
            val items = repository.getAll().filter { it.status != FeedStatus.ARCHIVED }
            val summary = buildSummary(items)
            if (summary.isNotBlank()) {
                val now = System.currentTimeMillis()
                val lastDigestAt = prefs.lastDigestAtFlow.first()
                val lastSummary = prefs.lastDigestSummaryFlow.first()
                val hasNewItems = items.any { it.timestamp > lastDigestAt }
                val unchanged = summary == lastSummary
                val withinCooldown = now - lastDigestAt < DIGEST_COOLDOWN_MS
                if (hasNewItems && !(unchanged && withinCooldown)) {
                    NotificationHelper.showDigest(applicationContext, summary)
                    prefs.updateDigest(summary, now)
                }
            } else {
                NotificationHelper.cancelDigest(applicationContext)
            }
            Result.success()
        }
    }

    private fun buildSummary(items: List<com.splinch.junction.feed.model.FeedItem>): String {
        if (items.isEmpty()) return ""
        val top = items.sortedByDescending { it.priority }.take(3)
        return top.joinToString(" - ") { it.title }
    }

    companion object {
        private const val DIGEST_COOLDOWN_MS = 2 * 60 * 60 * 1000L
    }
}
