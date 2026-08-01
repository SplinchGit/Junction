package com.splinch.junction.feature.scheduler

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.workDataOf
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object Scheduler {
    private const val FEED_DIGEST_WORK = "junction_feed_digest"

    fun configureFeedDigest(context: Context, enabled: Boolean, intervalMinutes: Long) {
        if (enabled) scheduleFeedDigest(context, intervalMinutes) else cancelFeedDigest(context)
    }

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

    fun scheduleCalendarReminder(context: Context, eventId: String, title: String, detail: String, triggerAtMillis: Long): Boolean {
        val delay = triggerAtMillis - System.currentTimeMillis()
        if (delay <= 0L) return false
        val request = OneTimeWorkRequestBuilder<CalendarReminderWorker>()
            .setInitialDelay(delay, TimeUnit.MILLISECONDS)
            .setInputData(workDataOf(CalendarReminderWorker.KEY_TITLE to title, CalendarReminderWorker.KEY_DETAIL to detail))
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork("junction_calendar_reminder_$eventId", androidx.work.ExistingWorkPolicy.REPLACE, request)
        return true
    }
    fun cancelFeedDigest(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(FEED_DIGEST_WORK)
    }
}
