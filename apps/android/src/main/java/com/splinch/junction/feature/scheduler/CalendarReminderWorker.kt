package com.splinch.junction.feature.scheduler

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

class CalendarReminderWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val title = inputData.getString(KEY_TITLE).orEmpty().ifBlank { "Calendar reminder" }
        val detail = inputData.getString(KEY_DETAIL).orEmpty().ifBlank { "Upcoming calendar event" }
        NotificationHelper.showReminder(applicationContext, title, detail)
        return Result.success()
    }

    companion object {
        const val KEY_TITLE = "title"
        const val KEY_DETAIL = "detail"
    }
}