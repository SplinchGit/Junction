package com.splinch.junction.notifications

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Trampoline that makes Junction's own notifications tap through to whichever
 * app raised the original one.
 *
 * A [android.app.PendingIntent] captured from another app's notification can't
 * be handed to `setContentIntent` directly -- the platform only lets the owner
 * fire it. So Junction's notification points here instead, carrying the feed
 * item's thread key, and this receiver fires the stored intent on the owner's
 * behalf via [NotificationTapStore].
 *
 * Falls back to launching the source app when the stored intent has expired
 * (the store keeps entries for six hours), so a tap is never a no-op.
 */
class NotificationTapReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val threadKey = intent.getStringExtra(EXTRA_THREAD_KEY)
        val packageName = intent.getStringExtra(EXTRA_PACKAGE_NAME)
        val notificationId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, -1)

        val opened = (threadKey != null && NotificationTapStore.trySend(threadKey)) ||
            launchApp(context, packageName)

        if (!opened) {
            Log.w(TAG, "Nothing to open for threadKey=$threadKey package=$packageName")
        }

        // Dismiss Junction's copy either way -- leaving it behind after a tap
        // reads as "that didn't work" even when the source app did open.
        if (notificationId != -1) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            manager?.cancel(notificationId)
        }
    }

    private fun launchApp(context: Context, packageName: String?): Boolean {
        if (packageName.isNullOrBlank()) return false
        val launch = runCatching {
            context.packageManager.getLaunchIntentForPackage(packageName)
        }.getOrNull() ?: return false
        return runCatching {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(launch)
            true
        }.getOrDefault(false)
    }

    companion object {
        private const val TAG = "NotificationTapReceiver"
        const val ACTION_OPEN_SOURCE = "com.splinch.junction.action.OPEN_NOTIFICATION_SOURCE"
        const val EXTRA_THREAD_KEY = "thread_key"
        const val EXTRA_PACKAGE_NAME = "package_name"
        const val EXTRA_NOTIFICATION_ID = "notification_id"
    }
}
