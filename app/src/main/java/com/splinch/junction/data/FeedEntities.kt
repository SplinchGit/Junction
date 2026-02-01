package com.splinch.junction.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "feed_events")
data class FeedEventEntity(
    @PrimaryKey val id: String,
    val source: String,
    val title: String,
    val summary: String,
    val timestamp: Long,
    val priority: String,
    val actionLabel: String?
)
