package com.splinch.junction.scheduler

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.splinch.junction.data.JunctionDatabase
import com.splinch.junction.feed.FeedPriority
import com.splinch.junction.feed.FeedRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class FeedDigestWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        return withContext(Dispatchers.Default) {
            val database = JunctionDatabase.getInstance(applicationContext)
            val repository = FeedRepository(database.feedDao())
            val events = repository.getEventsForDigest()
            val summary = buildSummary(events)
            if (summary.isNotBlank()) {
                NotificationHelper.showDigest(applicationContext, summary)
            }
            Result.success()
        }
    }

    private fun buildSummary(events: List<com.splinch.junction.feed.SocialEvent>): String {
        if (events.isEmpty()) return ""
        val top = events.sortedBy { priorityOrder(it.priority) }.take(3)
        return top.joinToString(" • ") { it.title }
    }

    private fun priorityOrder(priority: FeedPriority): Int {
        return when (priority) {
            FeedPriority.HIGH -> 0
            FeedPriority.MEDIUM -> 1
            FeedPriority.LOW -> 2
        }
    }
}
