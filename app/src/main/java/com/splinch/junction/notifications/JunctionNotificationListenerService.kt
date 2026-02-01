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

class JunctionNotificationListenerService : NotificationListenerService() {
    private val scope = CoroutineScope(Dispatchers.IO)

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val notification = sbn.notification
        val extras = notification.extras
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim()
        val packageName = sbn.packageName
        val threadKey = buildThreadKey(packageName, title, text, sbn)
        val now = System.currentTimeMillis()

        if (isDuplicate(threadKey, now)) return

        scope.launch {
            val prefs = UserPrefsRepository(applicationContext)
            if (!prefs.isPackageEnabled(packageName)) return@launch

            val repository = FeedRepository(JunctionDatabase.getInstance(applicationContext).feedDao())
            val source = resolveAppLabel(packageManager, packageName)
            val category = mapCategory(packageName)

            val item = FeedItemEntity(
                source = source,
                packageName = packageName,
                category = category,
                title = if (title.isNotBlank()) title else source,
                body = text,
                timestamp = now,
                priority = 5,
                status = FeedStatus.NEW,
                threadKey = threadKey,
                actionHint = "open"
            )
            repository.add(item)
        }
    }

    private fun buildThreadKey(
        packageName: String,
        title: String,
        text: String?,
        sbn: StatusBarNotification
    ): String {
        val base = listOf(packageName, title, text.orEmpty(), sbn.tag.orEmpty(), sbn.id.toString())
        return base.joinToString("|")
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
