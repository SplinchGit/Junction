package com.splinch.junction.data.sync.firebase

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.splinch.junction.R
import com.splinch.junction.app.JunctionApplication
import com.splinch.junction.app.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Keeps [RemoteCommandSyncManager] listening while Junction is off screen.
 *
 * Without this, the manager only lived as long as MainActivity's Composition -- the moment
 * the owner locked the phone or swiped Junction out of recents, Android was free to reclaim
 * the process, and a command sent from the PC companion would simply never arrive. A
 * foreground service holds the process at roughly the same priority as a visible Activity,
 * the same trick VoiceCallService uses to keep a call's microphone fed in the background.
 *
 * This service does not own the listener's logic, only its lifetime: [AppContainer][com.splinch.junction.app.AppContainer]
 * already builds one shared [RemoteCommandSyncManager] instance at Application scope, so
 * starting/stopping it here -- rather than constructing a new one -- keeps exactly one
 * listener alive regardless of how many times this service is (re)started.
 */
class RemoteCommandForegroundService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startNotification()
        val container = (application as JunctionApplication).container
        // Both idempotent (see AuthManager/RemoteCommandSyncManager): safe even if
        // MainActivity already started these while in the foreground, and self-sufficient
        // if this service is the first thing to run in a fresh process -- e.g. after the
        // system killed and restarted it (see onStartCommand's START_STICKY).
        container.authManager.start()
        container.remoteCommandSyncManager.start()

        // The owner turning remote commands off in Settings should take this notification
        // down promptly rather than leaving it running until the app happens to restart.
        scope.launch {
            container.prefs.firebaseSyncEnabledFlow.collect { enabled ->
                if (!enabled) stopSelf()
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Sticky, unlike VoiceCallService: a live call is a conversation that must not
        // silently resume without the owner present, but "be ready for the next remote
        // command" is exactly the kind of quiet background readiness that should come back
        // on its own after the system reclaims the process under memory pressure.
        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        // Swiping Junction out of recents would otherwise take this service down with it,
        // which defeats the point: remote commands are supposed to keep working precisely
        // when the app is not "open" at all.
        val restart = Intent(applicationContext, RemoteCommandForegroundService::class.java)
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                applicationContext.startForegroundService(restart)
            } else {
                applicationContext.startService(restart)
            }
        }.onFailure { Log.w(TAG, "Could not restart remote command service after task removal", it) }
    }

    override fun onDestroy() {
        super.onDestroy()
        runCatching { (application as JunctionApplication).container.remoteCommandSyncManager.stop() }
    }

    private fun startNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Junction remote commands",
                // LOW: this is a standing "I'm listening" state, not something urgent --
                // but it must stay visible, since a background channel the owner can't see
                // is a background channel they can't turn off either.
                NotificationManager.IMPORTANCE_LOW
            ).apply { setShowBadge(false) }
            manager?.createNotificationChannel(channel)
        }

        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_junction)
            .setContentTitle("Junction is available for remote commands")
            .setContentText("Commands from your PC companion can run on this phone. Tap to open, disable in Settings.")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setContentIntent(open)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        private const val TAG = "RemoteCommandService"
        private const val CHANNEL_ID = "junction_remote_commands"
        private const val NOTIFICATION_ID = 4712

        /**
         * Failures are swallowed on purpose, matching VoiceCallService: a foreground
         * service that cannot start (permission withheld, OEM restriction, background
         * start blocked) must not take the rest of Firebase sync down with it. Remote
         * commands simply stay unavailable in the background until the app is reopened,
         * which is strictly better than crashing the sync toggle entirely.
         */
        fun start(context: Context) {
            val intent = Intent(context, RemoteCommandForegroundService::class.java)
            runCatching {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            }.onFailure { Log.w(TAG, "Could not start remote command service", it) }
        }

        fun stop(context: Context) {
            runCatching { context.stopService(Intent(context, RemoteCommandForegroundService::class.java)) }
                .onFailure { Log.w(TAG, "Could not stop remote command service", it) }
        }
    }
}
