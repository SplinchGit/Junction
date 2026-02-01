package com.splinch.junction.scheduler

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.splinch.junction.data.JunctionDatabase
import com.splinch.junction.feed.FeedRepository
import com.splinch.junction.feed.model.FeedStatus
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
            val items = repository.getAll().filter { it.status != FeedStatus.ARCHIVED }
            val summary = buildSummary(items)
            if (summary.isNotBlank()) {
                NotificationHelper.showDigest(applicationContext, summary)
            }
            Result.success()
        }
    }

    private fun buildSummary(items: List<com.splinch.junction.feed.model.FeedItem>): String {
        if (items.isEmpty()) return ""
        val top = items.sortedByDescending { it.priority }.take(3)
        return top.joinToString(" • ") { it.title }
    }
}
