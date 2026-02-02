package com.splinch.junction.core

import android.app.Application
import android.util.Log
import com.splinch.junction.data.JunctionDatabase
import com.splinch.junction.feed.FeedRepository
import com.splinch.junction.scheduler.NotificationHelper
import com.splinch.junction.scheduler.Scheduler
import com.splinch.junction.settings.UserPrefsRepository
import com.splinch.junction.sync.firebase.FirebaseProvider
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.SupervisorJob

class JunctionApp : Application() {
    private val exceptionHandler = CoroutineExceptionHandler { _, throwable ->
        Log.e(TAG, "Background task failed", throwable)
    }
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default + exceptionHandler)

    override fun onCreate() {
        super.onCreate()
        runCatching { NotificationHelper.createChannels(this) }
            .onFailure { Log.e(TAG, "Failed to create notification channels", it) }
        runCatching { FirebaseProvider.initialize(this) }
            .onFailure { Log.e(TAG, "Failed to initialize Firebase", it) }

        val database = JunctionDatabase.getInstance(this)
        val feedRepository = FeedRepository(database.feedDao())
        val prefsRepository = UserPrefsRepository(this)

        appScope.launch {
            feedRepository.seedIfEmpty()
            val interval = prefsRepository.digestIntervalMinutesFlow.first().coerceAtLeast(15)
            Scheduler.scheduleFeedDigest(this@JunctionApp, interval.toLong())
        }
    }

    private companion object {
        private const val TAG = "JunctionApp"
    }
}
