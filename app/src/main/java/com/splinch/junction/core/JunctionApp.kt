package com.splinch.junction.core

import android.app.Application
import com.splinch.junction.scheduler.NotificationHelper
import com.splinch.junction.scheduler.Scheduler

class JunctionApp : Application() {
    override fun onCreate() {
        super.onCreate()
        NotificationHelper.createChannels(this)
        Scheduler.scheduleFeedDigest(this)
    }
}
