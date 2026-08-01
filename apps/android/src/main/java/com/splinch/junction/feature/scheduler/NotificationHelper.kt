package com.splinch.junction.feature.scheduler

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.splinch.junction.app.MainActivity
import com.splinch.junction.R
import com.splinch.junction.feature.feed.model.FeedItem
import com.splinch.junction.feature.notification.NotificationTapReceiver

object NotificationHelper {
    private const val CHANNEL_ID = "junction_digest"
    private const val CHANNEL_NAME = "Junction Digest"
    private const val CHANNEL_DESCRIPTION = "Scheduled summaries from Junction"
    private const val DIGEST_ID = 1001

    private const val ITEM_CHANNEL_ID = "junction_items"
    private const val ITEM_CHANNEL_NAME = "Junction Items"
    private const val ITEM_CHANNEL_DESCRIPTION = "Individual items Junction surfaced, tap to open the source app"

    /** Groups the per-item notifications under the digest so they collapse tidily. */
    private const val GROUP_KEY = "com.splinch.junction.FEED"
    private const val ITEM_ID_BASE = 2000
    private const val MAX_ITEM_NOTIFICATIONS = 6

    /** Brand accent, matching BrandBlue in ui/theme/Color.kt. */
    private const val BRAND_ACCENT = 0xFF4F7CFF.toInt()

    fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply { description = CHANNEL_DESCRIPTION }
            )

            manager.createNotificationChannel(
                NotificationChannel(
                    ITEM_CHANNEL_ID,
                    ITEM_CHANNEL_NAME,
                    // Low: these mirror notifications the owner has already been
                    // alerted to once by the source app, so re-buzzing is noise.
                    NotificationManager.IMPORTANCE_LOW
                ).apply { description = ITEM_CHANNEL_DESCRIPTION }
            )
        }
    }

    fun showDigest(context: Context, summary: String) {
        val openIntent = Intent(context, MainActivity::class.java).apply {
            putExtra(MainActivity.EXTRA_OPEN_CHAT, true)
        }
        val openPendingIntent = PendingIntent.getActivity(
            context,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val voiceIntent = Intent(context, MainActivity::class.java).apply {
            putExtra(MainActivity.EXTRA_OPEN_VOICE, true)
        }
        val voicePendingIntent = PendingIntent.getActivity(
            context,
            1,
            voiceIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_junction)
            .setContentTitle("Your Junction")
            .setContentText(summary)
            .setStyle(NotificationCompat.BigTextStyle().bigText(summary))
            .setContentIntent(openPendingIntent)
            .addAction(R.drawable.ic_junction, "Open", openPendingIntent)
            .addAction(R.drawable.ic_junction, "Voice", voicePendingIntent)
            .setColor(BRAND_ACCENT)
            .setColorized(true)
            .setCategory(NotificationCompat.CATEGORY_SOCIAL)
            .setGroup(GROUP_KEY)
            .setGroupSummary(true)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .build()

        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(DIGEST_ID, notification)
    }

    /**
     * Posts one tappable notification per feed item, each opening the app that
     * raised the original notification rather than opening Junction. The digest
     * above stays as the group summary, so the shade shows a single collapsed
     * "Your Junction" entry that expands into the individual items.
     */
    fun showFeedItems(context: Context, items: List<FeedItem>) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        items.take(MAX_ITEM_NOTIFICATIONS).forEachIndexed { index, item ->
            val notificationId = ITEM_ID_BASE + index
            val tapIntent = Intent(context, NotificationTapReceiver::class.java).apply {
                action = NotificationTapReceiver.ACTION_OPEN_SOURCE
                putExtra(NotificationTapReceiver.EXTRA_THREAD_KEY, item.threadKey)
                putExtra(NotificationTapReceiver.EXTRA_PACKAGE_NAME, item.packageName)
                putExtra(NotificationTapReceiver.EXTRA_NOTIFICATION_ID, notificationId)
            }
            // requestCode must be unique per item or the extras of the first
            // PendingIntent get reused for every subsequent one.
            val tapPendingIntent = PendingIntent.getBroadcast(
                context,
                notificationId,
                tapIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val body = item.body?.takeIf { it.isNotBlank() }
            val builder = NotificationCompat.Builder(context, ITEM_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_junction)
                .setContentTitle(item.title)
                .setSubText(item.source)
                .setContentIntent(tapPendingIntent)
                .setColor(BRAND_ACCENT)
                .setGroup(GROUP_KEY)
                .setOnlyAlertOnce(true)
                .setAutoCancel(true)

            if (body != null) {
                builder.setContentText(body)
                builder.setStyle(NotificationCompat.BigTextStyle().bigText(body))
            }

            manager.notify(notificationId, builder.build())
        }
    }

    fun cancelDigest(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.cancel(DIGEST_ID)
        for (index in 0 until MAX_ITEM_NOTIFICATIONS) {
            manager.cancel(ITEM_ID_BASE + index)
        }
    }
}
