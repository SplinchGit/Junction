package com.splinch.junction.notifications

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.splinch.junction.data.JunctionDatabase
import com.splinch.junction.feed.FeedRepository
import com.splinch.junction.feed.model.FeedCategory
import com.splinch.junction.feed.model.FeedItemEntity
import com.splinch.junction.feed.model.FeedStatus
import com.splinch.junction.settings.UserPrefsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.first

class JunctionNotificationListenerService : NotificationListenerService() {
    private val scope = CoroutineScope(Dispatchers.IO)

    override fun onListenerConnected() {
        scope.launch {
            val prefs = UserPrefsRepository(applicationContext)
            prefs.setNotificationListenerEnabled(true)
            if (!prefs.notificationAccessAcknowledgedFlow.first()) {
                prefs.setNotificationAccessAcknowledged(true)
            }
        }
        activeNotifications?.forEach { enqueueNotification(it) }
    }

    override fun onListenerDisconnected() {
        scope.launch {
            UserPrefsRepository(applicationContext).setNotificationListenerEnabled(false)
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        enqueueNotification(sbn)
    }

    private fun enqueueNotification(sbn: StatusBarNotification) {
        val notification = sbn.notification
        val extras = notification.extras
        val title = listOf(
            extras.getCharSequence(Notification.EXTRA_TITLE),
            extras.getCharSequence(Notification.EXTRA_TITLE_BIG)
        ).firstOrNull { !it.isNullOrBlank() }?.toString()?.trim().orEmpty()
        val lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
            ?.mapNotNull { it?.toString()?.trim() }
            ?.filter { it.isNotBlank() }
            ?.joinToString("\n")
            ?.takeIf { it.isNotBlank() }
        val text = listOf(
            extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.trim(),
            lines,
            extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim(),
            extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString()?.trim()
        ).firstOrNull { !it.isNullOrBlank() }
        val packageName = sbn.packageName
        if (packageName == applicationContext.packageName) return
        if (title.isBlank() && text.isNullOrBlank()) return

        // Collapse all notifications from an app into a single "widget" item to avoid spam.
        val aggregateId = "app:$packageName"
        NotificationTapStore.put(aggregateId, notification.contentIntent)
        val eventKey = sbn.key
        val now = if (sbn.postTime > 0L) sbn.postTime else System.currentTimeMillis()
        val dedupTime = System.currentTimeMillis()

        if (isDuplicate(eventKey, dedupTime)) return

        scope.launch {
            val prefs = UserPrefsRepository(applicationContext)
            val acknowledged = prefs.notificationAccessAcknowledgedFlow.first()
            if (!acknowledged) {
                prefs.setNotificationAccessAcknowledged(true)
            }
            if (!prefs.isPackageEnabled(packageName)) return@launch

            val database = JunctionDatabase.getInstance(applicationContext)
            val repository = FeedRepository(database.feedDao())
            val source = resolveAppLabel(packageManager, packageName)
            val category = mapCategory(packageName)

            val previous = repository.getEntityById(aggregateId)
            val nextCount = (previous?.aggregateCount ?: 0) + 1

            // If enabled, suppress the original app notification so Junction becomes the inbox.
            val suppressOriginal = prefs.junctionOnlyNotificationsFlow.first()
            if (suppressOriginal &&
                (notification.flags and Notification.FLAG_ONGOING_EVENT) == 0 &&
                notification.category != Notification.CATEGORY_CALL
            ) {
                runCatching { cancelNotification(sbn.key) }
            }

            val item = FeedItemEntity(
                id = aggregateId,
                source = source,
                packageName = packageName,
                category = category,
                title = if (title.isNotBlank()) title else source,
                body = text,
                timestamp = now,
                priority = 5,
                status = FeedStatus.NEW,
                threadKey = aggregateId,
                actionHint = "open",
                aggregateCount = nextCount
            )
            repository.add(item)
        }
    }

    private fun mapCategory(packageName: String): FeedCategory {
        return when {
            packageName in messagingApps -> FeedCategory.FRIENDS_FAMILY
            packageName in workApps -> FeedCategory.WORK
            packageName in projectApps -> FeedCategory.PROJECTS
            packageName in communityApps -> FeedCategory.COMMUNITIES
            packageName in newsApps -> FeedCategory.NEWS
            packageName in systemApps -> FeedCategory.SYSTEM
            else -> FeedCategory.OTHER
        }
    }

    companion object {
        private val recentKeys = LinkedHashMap<String, Long>()
        private const val DEDUP_WINDOW_MS = 8_000L

        private val messagingApps = setOf(
            "com.google.android.apps.messaging",
            "com.whatsapp",
            "com.facebook.orca",
            "com.instagram.android",
            "com.snapchat.android"
        )

        private val workApps = setOf(
            "com.slack",
            "com.microsoft.teams",
            "com.google.android.gm",
            "com.google.android.calendar"
        )

        private val projectApps = setOf(
            "com.github.android",
            "com.gitlab.android",
            "com.atlassian.android.jira.core"
        )

        private val communityApps = setOf(
            "com.discord",
            "tv.twitch.android.app",
            "com.reddit.frontpage"
        )

        private val newsApps = setOf(
            "com.google.android.youtube",
            "com.android.chrome",
            "org.mozilla.firefox"
        )

        private val systemApps = setOf(
            "com.android.systemui"
        )

        private fun resolveAppLabel(
            packageManager: android.content.pm.PackageManager,
            packageName: String
        ): String {
            return try {
                val appInfo = packageManager.getApplicationInfo(packageName, 0)
                packageManager.getApplicationLabel(appInfo).toString()
            } catch (_: Exception) {
                packageName
            }
        }

        private fun isDuplicate(threadKey: String, now: Long): Boolean {
            synchronized(recentKeys) {
                val iterator = recentKeys.entries.iterator()
                while (iterator.hasNext()) {
                    val entry = iterator.next()
                    if (now - entry.value > DEDUP_WINDOW_MS) {
                        iterator.remove()
                    }
                }

                val last = recentKeys[threadKey]
                if (last != null && now - last < DEDUP_WINDOW_MS) {
                    return true
                }
                recentKeys[threadKey] = now
                return false
            }
        }
    }
}
