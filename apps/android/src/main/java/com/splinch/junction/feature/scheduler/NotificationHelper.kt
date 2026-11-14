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
    private const val REMINDER_CHANNEL_ID = "junction_reminders"
    private const val REMINDER_CHANNEL_NAME = "Junction Reminders"

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
                    REMINDER_CHANNEL_ID,
                    REMINDER_CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_HIGH
                )
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

    fun taskIntent(context: Context, taskId: String, approvalId: String? = null, reply: Boolean = false, invitationQuestionId: String? = null, invitationCommandId: String? = null): Intent = Intent(context, MainActivity::class.java).apply {
        data = android.net.Uri.Builder().scheme("junction").authority("task").appendPath(taskId).apply {
            if (approvalId != null) appendPath("approval").appendPath(approvalId)
            if (reply) appendPath("reply")
            if (invitationQuestionId != null) {
                appendPath("invitation").appendPath(invitationQuestionId)
                invitationCommandId?.let { appendPath(it) }
            }
        }.build()
        putExtra(MainActivity.EXTRA_TASK_ID, taskId)
        if (approvalId != null) putExtra(MainActivity.EXTRA_APPROVAL_ID, approvalId)
        if (reply) putExtra(MainActivity.EXTRA_REPLY_TO_TASK, true)
        if (invitationQuestionId != null) putExtra(MainActivity.EXTRA_INVITATION_QUESTION_ID, invitationQuestionId)
        if (invitationCommandId != null) putExtra(MainActivity.EXTRA_INVITATION_COMMAND_ID, invitationCommandId)
        addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }

    /** Persist in the existing feed before alerting. Retries preserve read/dismiss state. */
    suspend fun showTaskOutcome(context: Context, args: org.json.JSONObject, commandId: String? = null, allowOwnerActions: Boolean = false, instanceId: String? = null, trackOutcomes: Boolean = false): org.json.JSONObject {
        val eventId = args.getString("eventId")
        val taskId = args.getString("taskId")
        require(eventId.length in 1..160 && taskId.length in 1..160)
        val approvalId = args.optString("approvalId").takeIf { it.matches(Regex("[A-Za-z0-9_-]{1,160}")) }
        val title = args.getString("title").take(180)
        val body = args.getString("body").take(600)
        val dao = com.splinch.junction.data.database.JunctionDatabase.getInstance(context).feedDao()
        val inserted = dao.insertNotificationOnce(com.splinch.junction.feature.feed.model.FeedItemEntity(
            id = eventId, source = "Nethra", packageName = context.packageName,
            category = com.splinch.junction.feature.feed.model.FeedCategory.PROJECTS,
            title = title, body = body, timestamp = System.currentTimeMillis(), priority = 8,
            status = com.splinch.junction.feature.feed.model.FeedStatus.NEW,
            threadKey = "nethra-task:$taskId", actionHint = approvalId?.let { "review_approval:$it" } ?: "open_task", provenance = "PAIRED_HOST"
        ))
        if (inserted == -1L) return org.json.JSONObject().put("historySaved", true).put("duplicate", true)
        createChannels(context)
        val manager = androidx.core.app.NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return org.json.JSONObject().put("historySaved", true).put("alertPosted", false).put("reason", "notifications_disabled")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            manager.getNotificationChannel(CHANNEL_ID)?.importance == NotificationManager.IMPORTANCE_NONE) {
            return org.json.JSONObject().put("historySaved", true).put("alertPosted", false).put("reason", "channel_disabled")
        }
        fun trackOpen(intent: Intent): Intent = intent.apply {
            if (trackOutcomes && !commandId.isNullOrBlank() && !instanceId.isNullOrBlank()) {
                data = data?.buildUpon()?.appendQueryParameter("delivery", commandId)?.build()
                putExtra(MainActivity.EXTRA_NOTIFICATION_DELIVERY, commandId)
                putExtra(MainActivity.EXTRA_NOTIFICATION_HOST, instanceId)
            }
        }
        val open = PendingIntent.getActivity(context, 0, trackOpen(taskIntent(context, taskId, approvalId)), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val invitation = args.optString("questionId").takeIf { approvalId == null && !commandId.isNullOrBlank() && args.optBoolean("voiceInvite") && it.matches(Regex("[A-Za-z0-9_-]{1,160}")) }
        val reply = approvalId == null && args.optBoolean("reply")
        val primaryAction = if (reply || invitation != null) PendingIntent.getActivity(context, 0, trackOpen(taskIntent(context, taskId, reply = true, invitationQuestionId = invitation, invitationCommandId = commandId.takeIf { invitation != null })), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) else open
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_junction).setContentTitle(title).setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body)).setContentIntent(open)
            .addAction(R.drawable.ic_junction, if (invitation != null) "Answer" else if (reply) "Reply" else if (approvalId == null) "Open task" else "Review approval", primaryAction)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setOnlyAlertOnce(true).setAutoCancel(true)
        if (allowOwnerActions && !commandId.isNullOrBlank() && !instanceId.isNullOrBlank()) {
            fun choice(action: String) = PendingIntent.getBroadcast(context, 0,
                taskChoiceIntent(context, commandId, eventId, instanceId, action), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val dismiss = choice("DISMISS")
            builder.addAction(R.drawable.ic_junction, if (invitation != null) "Later" else "Remind later", choice("SNOOZE"))
                .addAction(R.drawable.ic_junction, if (invitation != null) "Decline" else "Dismiss", dismiss).setDeleteIntent(dismiss)
        }
        manager.notify(eventId, 0, builder.build())
        if (trackOutcomes && !commandId.isNullOrBlank() && !instanceId.isNullOrBlank()) {
            com.splinch.junction.data.sync.lan.DeviceCommandSync(context).recordNotificationPosted(commandId, instanceId)
        }
        return org.json.JSONObject().put("historySaved", true).put("alertPosted", true)
    }

    fun taskChoiceIntent(context: Context, commandId: String, eventId: String, instanceId: String, choice: String): Intent {
        require(choice in setOf("SNOOZE", "DISMISS"))
        return Intent(context, NotificationTapReceiver::class.java).apply {
            action = NotificationTapReceiver.ACTION_TASK_CHOICE
            data = android.net.Uri.Builder().scheme("junction").authority("notification-choice").appendPath(commandId).appendPath(choice).build()
            putExtra(NotificationTapReceiver.EXTRA_COMMAND_ID, commandId)
            putExtra(NotificationTapReceiver.EXTRA_EVENT_ID, eventId)
            putExtra(NotificationTapReceiver.EXTRA_HOST_ID, instanceId)
            putExtra(NotificationTapReceiver.EXTRA_CHOICE, choice)
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

    fun showReminder(context: Context, title: String, detail: String) {
        val openIntent = PendingIntent.getActivity(context, title.hashCode(), Intent(context, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, REMINDER_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_junction).setContentTitle(title).setContentText(detail)
            .setStyle(NotificationCompat.BigTextStyle().bigText(detail)).setContentIntent(openIntent)
            .setColor(BRAND_ACCENT).setAutoCancel(true).build()
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(title.hashCode(), notification)
    }
    fun cancelDigest(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.cancel(DIGEST_ID)
        for (index in 0 until MAX_ITEM_NOTIFICATIONS) {
            manager.cancel(ITEM_ID_BASE + index)
        }
    }
}
