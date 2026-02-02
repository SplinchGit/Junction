package com.splinch.junction.feed

import com.splinch.junction.feed.data.FeedDao
import com.splinch.junction.feed.model.FeedCategory
import com.splinch.junction.feed.model.FeedItem
import com.splinch.junction.feed.model.FeedItemEntity
import com.splinch.junction.feed.model.FeedStatus
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

interface FeedRemoteSync {
    suspend fun onLocalUpsert(item: FeedItemEntity)
}

class FeedRepository(
    private val feedDao: FeedDao,
    private val remoteSync: FeedRemoteSync? = null
) {
    val feedFlow: Flow<List<FeedItem>> = feedDao.feedStream().map { entities ->
        entities.map { it.toModel() }
    }

    suspend fun seedIfEmpty() {
        if (feedDao.countAll() > 0) return

        val now = System.currentTimeMillis()
        val seedItems = listOf(
            FeedItemEntity(
                source = "Junction",
                packageName = null,
                category = FeedCategory.SYSTEM,
                title = "Digest: 3 new community updates",
                body = "Your community space is active today.",
                timestamp = now - 15 * 60 * 1000L,
                priority = 6,
                status = FeedStatus.NEW,
                threadKey = null,
                actionHint = "review",
                updatedAt = now
            ),
            FeedItemEntity(
                source = "GitHub",
                packageName = "com.github.android",
                category = FeedCategory.PROJECTS,
                title = "Project: PR needs review",
                body = "PR #128 is ready for review.",
                timestamp = now - 45 * 60 * 1000L,
                priority = 7,
                status = FeedStatus.NEW,
                threadKey = "github_pr_128",
                actionHint = "open",
                updatedAt = now
            ),
            FeedItemEntity(
                source = "Messages",
                packageName = "com.google.android.apps.messaging",
                category = FeedCategory.FRIENDS_FAMILY,
                title = "Friends/Family: new message",
                body = "Hey, are we still on for tonight?",
                timestamp = now - 30 * 60 * 1000L,
                priority = 8,
                status = FeedStatus.NEW,
                threadKey = "sms_thread",
                actionHint = "reply",
                updatedAt = now
            ),
            FeedItemEntity(
                source = "Calendar",
                packageName = "com.google.android.calendar",
                category = FeedCategory.WORK,
                title = "Work: standup in 25 minutes",
                body = "Team sync at 10:30 AM.",
                timestamp = now + 25 * 60 * 1000L,
                priority = 7,
                status = FeedStatus.NEW,
                threadKey = "calendar_standup",
                actionHint = "open",
                updatedAt = now
            ),
            FeedItemEntity(
                source = "Discord",
                packageName = "com.discord",
                category = FeedCategory.COMMUNITIES,
                title = "Community: 5 new posts",
                body = "#junction feedback channel has new replies.",
                timestamp = now - 2 * 60 * 60 * 1000L,
                priority = 5,
                status = FeedStatus.NEW,
                threadKey = "discord_junction",
                actionHint = "open",
                updatedAt = now
            ),
            FeedItemEntity(
                source = "YouTube",
                packageName = "com.google.android.youtube",
                category = FeedCategory.NEWS,
                title = "News: new creator upload",
                body = "New video: Designing calmer software.",
                timestamp = now - 3 * 60 * 60 * 1000L,
                priority = 4,
                status = FeedStatus.NEW,
                threadKey = "youtube_upload",
                actionHint = "read",
                updatedAt = now
            ),
            FeedItemEntity(
                source = "System",
                packageName = null,
                category = FeedCategory.SYSTEM,
                title = "System: 2 notifications muted",
                body = "You muted low-priority pings during focus time.",
                timestamp = now - 4 * 60 * 60 * 1000L,
                priority = 3,
                status = FeedStatus.NEW,
                threadKey = "system_muted",
                actionHint = "review",
                updatedAt = now
            ),
            FeedItemEntity(
                source = "Email",
                packageName = "com.google.android.gm",
                category = FeedCategory.WORK,
                title = "Work: partnership brief",
                body = "Draft proposal ready for feedback.",
                timestamp = now - 6 * 60 * 60 * 1000L,
                priority = 6,
                status = FeedStatus.NEW,
                threadKey = "email_partner",
                actionHint = "open",
                updatedAt = now
            )
        )

        feedDao.insertAll(seedItems)
    }

    suspend fun markSeen(id: String) {
        val updatedAt = System.currentTimeMillis()
        feedDao.markSeen(id, updatedAt)
        feedDao.getById(id)?.let { remoteSync?.onLocalUpsert(it.copy(updatedAt = updatedAt)) }
    }

    suspend fun archive(id: String) {
        val updatedAt = System.currentTimeMillis()
        feedDao.archive(id, updatedAt)
        feedDao.getById(id)?.let { remoteSync?.onLocalUpsert(it.copy(updatedAt = updatedAt)) }
    }

    suspend fun updateStatus(id: String, status: FeedStatus) {
        val updatedAt = System.currentTimeMillis()
        feedDao.updateStatus(id, status, updatedAt)
        feedDao.getById(id)?.let { remoteSync?.onLocalUpsert(it.copy(updatedAt = updatedAt)) }
    }

    suspend fun add(item: FeedItemEntity) {
        val updated = item.copy(updatedAt = System.currentTimeMillis())
        feedDao.insert(updated)
        remoteSync?.onLocalUpsert(updated)
    }

    suspend fun getAll(): List<FeedItem> {
        return feedDao.getAll().map { it.toModel() }
    }

    suspend fun getById(id: String): FeedItem? {
        return feedDao.getById(id)?.toModel()
    }

    suspend fun getDistinctPackages(): List<String> {
        return feedDao.distinctPackages().filter { it.isNotBlank() }
    }

    suspend fun getEntityById(id: String): FeedItemEntity? {
        return feedDao.getById(id)
    }

    private fun FeedItemEntity.toModel(): FeedItem {
        return FeedItem(
            id = id,
            source = source,
            packageName = packageName,
            category = category,
            title = title,
            body = body,
            timestamp = timestamp,
            priority = priority,
            status = status,
            threadKey = threadKey,
            actionHint = actionHint,
            updatedAt = updatedAt
        )
    }
}
