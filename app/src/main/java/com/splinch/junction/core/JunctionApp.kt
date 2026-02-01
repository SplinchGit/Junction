package com.splinch.junction.core

import android.app.Application
import com.splinch.junction.data.JunctionDatabase
import com.splinch.junction.feed.FeedRepository
import com.splinch.junction.scheduler.NotificationHelper
import com.splinch.junction.scheduler.Scheduler
import com.splinch.junction.settings.SettingsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class JunctionApp : Application() {
    override fun onCreate() {
        super.onCreate()
        NotificationHelper.createChannels(this)

        val database = JunctionDatabase.getInstance(this)
        val feedRepository = FeedRepository(database.feedDao())
        val settingsRepository = SettingsRepository(this)

        CoroutineScope(Dispatchers.Default).launch {
            feedRepository.seedIfEmpty()
            val interval = settingsRepository.digestIntervalMinutesFlow.first().coerceAtLeast(15)
            Scheduler.scheduleFeedDigest(this@JunctionApp, interval.toLong())
        }
    }
}
