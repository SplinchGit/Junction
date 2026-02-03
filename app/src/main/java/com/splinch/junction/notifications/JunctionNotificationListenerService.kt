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

        // Collapse notifications by package + category into a single "widget" item to avoid spam.
        val category = mapCategory(packageName)
        val now = if (sbn.postTime > 0L) sbn.postTime else System.currentTimeMillis()
        if (category == FeedCategory.SYSTEM && !shouldKeepSystemNotification(title, text, now)) return
        val bucketKey = "app:$packageName:${category.name}"
        NotificationTapStore.put(bucketKey, notification.contentIntent)
        val eventKey = sbn.key
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
            val previous = repository.getEntityById(bucketKey)
                ?: repository.getEntityByThreadKey(bucketKey)
                ?: repository.getLatestByPackageAndCategory(packageName, category)
            // If the incoming notification has the same title+body as the previous
            // within a short merge window, don't increment the count -- just refresh timestamp.
            val MERGE_WINDOW_MS = 5 * 60 * 1000L
            val normalizedTitle = if (title.isNotBlank()) title else source
            val normalizedBody = text ?: ""
            val nextCount = if (previous != null
                && previous.title == normalizedTitle
                && (previous.body ?: "") == normalizedBody
                && now - previous.updatedAt < MERGE_WINDOW_MS
            ) {
                previous.aggregateCount
            } else {
                (previous?.aggregateCount ?: 0) + 1
            }

            // If enabled, suppress the original app notification so Junction becomes the inbox.
            val suppressOriginal = prefs.junctionOnlyNotificationsFlow.first()
            if (suppressOriginal &&
                (notification.flags and Notification.FLAG_ONGOING_EVENT) == 0 &&
                notification.category != Notification.CATEGORY_CALL
            ) {
                runCatching { cancelNotification(sbn.key) }
            }

            val item = FeedItemEntity(
                id = bucketKey,
                source = source,
                packageName = packageName,
                category = category,
                title = normalizedTitle,
                body = text,
                timestamp = now,
                priority = 5,
                status = FeedStatus.NEW,
                threadKey = bucketKey,
                actionHint = "open",
                aggregateCount = nextCount
            )
            repository.add(item)
            repository.archiveByPackageAndCategoryExcept(packageName, category, bucketKey)
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
        private val systemLock = Any()
        private const val DEDUP_WINDOW_MS = 8_000L
        private const val SYSTEM_MIN_INTERVAL_MS = 30 * 60 * 1000L
        private const val SYSTEM_GENERIC_COOLDOWN_MS = 2 * 60 * 60 * 1000L
        private val batteryThresholds = listOf(15, 30, 50, 80, 100)
        private val batteryPercentRegex = Regex("(\\d{1,3})%")
        private var lastSystemBatteryPercent: Int? = null
        private var lastSystemCharging: Boolean? = null
        private var lastSystemNotifyAt: Long = 0L

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

        private fun shouldKeepSystemNotification(title: String, body: String?, now: Long): Boolean {
            val combined = listOfNotNull(title, body).joinToString(" ").lowercase()
            val percent = batteryPercentRegex.find(combined)
                ?.groupValues
                ?.getOrNull(1)
                ?.toIntOrNull()
                ?.coerceIn(0, 100)
            val charging = combined.contains("charging") || combined.contains("charged")
            val batteryRelated = combined.contains("battery") || percent != null || charging

            synchronized(systemLock) {
                if (batteryRelated) {
                    val lastPercent = lastSystemBatteryPercent
                    val lastCharging = lastSystemCharging
                    val crossed = percent != null &&
                        lastPercent != null &&
                        crossedThreshold(lastPercent, percent)
                    val stateChanged = lastCharging != null && charging != lastCharging
                    val bigMove = percent != null &&
                        lastPercent != null &&
                        kotlin.math.abs(percent - lastPercent) >= 10
                    val timePassed = now - lastSystemNotifyAt >= SYSTEM_MIN_INTERVAL_MS
                    val shouldKeep = lastSystemNotifyAt == 0L || crossed || stateChanged || bigMove || timePassed
                    if (shouldKeep) {
                        if (percent != null) {
                            lastSystemBatteryPercent = percent
                        }
                        lastSystemCharging = charging
                        lastSystemNotifyAt = now
                    }
                    return shouldKeep
                }

                val timePassed = now - lastSystemNotifyAt >= SYSTEM_GENERIC_COOLDOWN_MS
                if (timePassed) {
                    lastSystemNotifyAt = now
                }
                return timePassed
            }
        }

        private fun crossedThreshold(previous: Int, current: Int): Boolean {
            if (previous == current) return false
            val low = kotlin.math.min(previous, current) + 1
            val high = kotlin.math.max(previous, current)
            return batteryThresholds.any { it in low..high }
        }
    }
}
