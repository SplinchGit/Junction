package com.splinch.junction.feed

import java.time.Instant
import java.util.UUID

enum class FeedSource {
    DISCORD,
    TWITCH,
    YOUTUBE,
    CALENDAR,
    SOCIAL,
    EMAIL
}

enum class FeedPriority {
    HIGH,
    MEDIUM,
    LOW
}

data class SocialEvent(
    val id: String = UUID.randomUUID().toString(),
    val source: FeedSource,
    val title: String,
    val summary: String,
    val timestamp: Instant,
    val priority: FeedPriority,
    val actionLabel: String? = null
)
