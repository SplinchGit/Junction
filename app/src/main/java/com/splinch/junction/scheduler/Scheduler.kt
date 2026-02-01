package com.splinch.junction.scheduler

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object Scheduler {
    private const val FEED_DIGEST_WORK = "junction_feed_digest"

    fun scheduleFeedDigest(context: Context, intervalMinutes: Long = 30) {
        val safeInterval = intervalMinutes.coerceAtLeast(15)
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.NOT_REQUIRED)
            .build()

        val request = PeriodicWorkRequestBuilder<FeedDigestWorker>(safeInterval, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build()

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            FEED_DIGEST_WORK,
            ExistingPeriodicWorkPolicy.UPDATE,
            request
        )
    }
}
