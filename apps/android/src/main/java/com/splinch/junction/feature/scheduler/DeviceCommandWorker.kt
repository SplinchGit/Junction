package com.splinch.junction.feature.scheduler

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.splinch.junction.data.sync.lan.DeviceCommandSync
import com.splinch.junction.data.sync.lan.LanIdentityStore
import java.util.concurrent.TimeUnit

/** Background pull of signed PC device commands; the minimum WorkManager period is 15 minutes. */
class DeviceCommandWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        runCatching { DeviceCommandSync(applicationContext).runOnce() }
        return Result.success()
    }

    companion object {
        private const val WORK = "junction_device_commands"

        fun schedule(context: Context) {
            if (LanIdentityStore(context).loadPairing() == null) return
            val request = PeriodicWorkRequestBuilder<DeviceCommandWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
