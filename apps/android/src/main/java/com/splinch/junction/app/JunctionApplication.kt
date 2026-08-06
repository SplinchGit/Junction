package com.splinch.junction.app

import android.app.Application
import android.util.Log
import com.splinch.junction.feature.scheduler.NotificationHelper
import com.splinch.junction.feature.scheduler.Scheduler
import com.splinch.junction.data.preference.UserPrefsRepository
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.SupervisorJob

class JunctionApplication : Application() {
    private val exceptionHandler = CoroutineExceptionHandler { _, throwable ->
        Log.e(TAG, "Background task failed", throwable)
    }
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default + exceptionHandler)

    // Built lazily rather than eagerly in onCreate: touching it for the first time is what
    // constructs ChatManager and friends, and the app should not pay that cost (or start
    // pulling in the Room database) on every cold start before anything actually needs it.
    // MainActivity and RemoteCommandForegroundService both read this same instance, so
    // whichever one runs first builds it and the other reuses it.
    val container: AppContainer by lazy { AppContainer(this) }

    override fun onCreate() {
        super.onCreate()
        runCatching { NotificationHelper.createChannels(this) }
            .onFailure { Log.e(TAG, "Failed to create notification channels", it) }

        val prefsRepository = UserPrefsRepository(this)

        appScope.launch {
            val interval = prefsRepository.digestIntervalMinutesFlow.first().coerceAtLeast(15)
            val enabled = prefsRepository.digestEnabledFlow.first()
            Scheduler.configureFeedDigest(this@JunctionApplication, enabled, interval.toLong())
        }
    }

    private companion object {
        private const val TAG = "JunctionApplication"
    }
}
