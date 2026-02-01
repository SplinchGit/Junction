package com.splinch.junction.sync.firebase

import com.splinch.junction.feed.model.FeedCategory
import com.splinch.junction.feed.model.FeedItemEntity
import com.splinch.junction.feed.model.FeedStatus

internal fun FeedItemEntity.toFirestoreMap(userId: String): Map<String, Any?> {
    return mapOf(
        "userId" to userId,
        "source" to source,
        "packageName" to packageName,
        "category" to category.name,
        "title" to title,
        "body" to body,
        "timestamp" to timestamp,
        "priority" to priority,
        "status" to status.name,
        "threadKey" to threadKey,
        "actionHint" to actionHint,
        "updatedAt" to updatedAt
    )
}

internal fun feedItemFromFirestore(id: String, data: Map<String, Any?>): FeedItemEntity? {
    val source = data["source"] as? String ?: return null
    val category = (data["category"] as? String)?.let { runCatching { FeedCategory.valueOf(it) }.getOrNull() }
        ?: FeedCategory.OTHER
    val status = (data["status"] as? String)?.let { runCatching { FeedStatus.valueOf(it) }.getOrNull() }
        ?: FeedStatus.NEW
    val title = data["title"] as? String ?: return null
    val timestamp = (data["timestamp"] as? Number)?.toLong() ?: System.currentTimeMillis()
    val updatedAt = (data["updatedAt"] as? Number)?.toLong() ?: timestamp
    return FeedItemEntity(
        id = id,
        source = source,
        packageName = data["packageName"] as? String,
        category = category,
        title = title,
        body = data["body"] as? String,
        timestamp = timestamp,
        priority = (data["priority"] as? Number)?.toInt() ?: 5,
        status = status,
        threadKey = data["threadKey"] as? String,
        actionHint = data["actionHint"] as? String,
        updatedAt = updatedAt
    )
}
