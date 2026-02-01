package com.splinch.junction.feed.model

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.util.UUID

enum class FeedCategory {
    FRIENDS_FAMILY,
    WORK,
    PROJECTS,
    COMMUNITIES,
    NEWS,
    SYSTEM,
    OTHER
}

enum class FeedStatus {
    NEW,
    SEEN,
    ARCHIVED
}

@Entity(tableName = "feed_items")
data class FeedItemEntity(
    @PrimaryKey val id: String = UUID.randomUUID().toString(),
    val source: String,
    val packageName: String?,
    val category: FeedCategory,
    val title: String,
    val body: String?,
    val timestamp: Long,
    val priority: Int = 5,
    val status: FeedStatus = FeedStatus.NEW,
    val threadKey: String?,
    val actionHint: String?
)

data class FeedItem(
    val id: String,
    val source: String,
    val packageName: String?,
    val category: FeedCategory,
    val title: String,
    val body: String?,
    val timestamp: Long,
    val priority: Int,
    val status: FeedStatus,
    val threadKey: String?,
    val actionHint: String?
)
