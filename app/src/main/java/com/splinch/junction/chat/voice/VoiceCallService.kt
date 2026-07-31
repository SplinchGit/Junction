package com.splinch.junction.chat.voice

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
import com.splinch.junction.MainActivity
import com.splinch.junction.R

/**
 * Lets the owner end a call from the notification without opening the app.
 *
 * Deliberately a plain holder rather than a broadcast: the only thing that can
 * legitimately hang up is the live [com.splinch.junction.chat.ChatManager], and routing
 * it through an exported receiver would let anything on the device end a call.
 */
object VoiceCallController {
    @Volatile
    var onHangUp: (() -> Unit)? = null
}

/**
 * Holds the process in the foreground for the duration of a voice call.
 *
 * Voice lives in `ChatManager` on the Activity's lifecycle, so without this a call died
 * the moment the owner locked the screen or switched apps -- Android stops delivering
 * microphone audio to a backgrounded process, and `SpeechRecognizer` simply goes quiet.
 * From the owner's side that is indistinguishable from Junction ignoring them, which is
 * the same illusion [HandsFreeLoop] exists to prevent.
 *
 * This service does not own the audio. [LocalVoiceSession] still runs the recogniser and
 * TTS exactly where it did; the only job here is to declare a microphone foreground
 * service so the system keeps that recogniser fed while the app is not on screen. Keeping
 * the audio pipeline in one place means a call behaves identically whether Junction is
 * open or backgrounded.
 */
class VoiceCallService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_HANG_UP) {
            // Tell ChatManager first so it tears the recogniser down properly; stopping
            // the service alone would leave the session live but unfed.
            runCatching { VoiceCallController.onHangUp?.invoke() }
                .onFailure { Log.e(TAG, "Hang-up handler failed", it) }
            stopSelf()
            return START_NOT_STICKY
        }
        startCallNotification()
        // Not sticky: a call is a live conversation. Silently resurrecting one after the
        // system killed the process would put a hot mic on the owner's phone without them
        // having asked for it.
        return START_NOT_STICKY
    }

    private fun startCallNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Junction voice call",
                // LOW, not MIN: an ongoing open microphone must be visible in the shade.
                // A call the owner cannot see is a call they cannot end.
                NotificationManager.IMPORTANCE_LOW
            ).apply { setShowBadge(false) }
            manager?.createNotificationChannel(channel)
        }

        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java)
                .putExtra(MainActivity.EXTRA_OPEN_VOICE, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val hangUp = PendingIntent.getService(
            this,
            1,
            Intent(this, VoiceCallService::class.java).setAction(ACTION_HANG_UP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_junction)
            .setContentTitle("On a call with Junction")
            .setContentText("Listening. Tap to open, or end the call.")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(0, "End call", hangUp)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        private const val TAG = "VoiceCallService"
        private const val CHANNEL_ID = "junction_voice_call"
        private const val NOTIFICATION_ID = 4711
        private const val ACTION_HANG_UP = "com.splinch.junction.action.HANG_UP"

        /**
         * Starts the call service. Failures are swallowed on purpose: a foreground service
         * that cannot start (permission withheld, OEM restriction, background start
         * blocked) must not take the call down with it. The call still works while
         * Junction is on screen, which is strictly better than no call at all.
         */
        fun start(context: Context) {
            val intent = Intent(context, VoiceCallService::class.java)
            runCatching {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            }.onFailure { Log.w(TAG, "Could not start call service; call stays foreground-only", it) }
        }

        fun stop(context: Context) {
            runCatching { context.stopService(Intent(context, VoiceCallService::class.java)) }
                .onFailure { Log.w(TAG, "Could not stop call service", it) }
        }
    }
}
