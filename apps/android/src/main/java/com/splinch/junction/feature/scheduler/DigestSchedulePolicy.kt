package com.splinch.junction.feature.scheduler

import java.time.Instant
import java.time.ZoneId
import com.splinch.junction.feature.feed.model.FeedCategory

data class DigestQuietHours(
    val enabled: Boolean,
    val startHour: Int,
    val endHour: Int
)

enum class DigestProfile(val label: String) {
    ALL("All"),
    FOCUS("Focus"),
    PERSONAL("Personal")
}

object DigestSchedulePolicy {
    fun suppressesAt(timestamp: Long, quietHours: DigestQuietHours, zoneId: ZoneId = ZoneId.systemDefault()): Boolean {
        val hour = Instant.ofEpochMilli(timestamp).atZone(zoneId).hour
        return suppressesAtHour(hour, quietHours)
    }

    fun suppressesAtHour(hour: Int, quietHours: DigestQuietHours): Boolean {
        if (!quietHours.enabled || quietHours.startHour == quietHours.endHour) return false
        return if (quietHours.startHour < quietHours.endHour) {
            hour in quietHours.startHour until quietHours.endHour
        } else {
            hour >= quietHours.startHour || hour < quietHours.endHour
        }
    }

    fun includesCategory(profile: DigestProfile, category: FeedCategory): Boolean = when (profile) {
        DigestProfile.ALL -> true
        DigestProfile.FOCUS -> category in setOf(FeedCategory.WORK, FeedCategory.PROJECTS, FeedCategory.SYSTEM)
        DigestProfile.PERSONAL -> category in setOf(FeedCategory.FRIENDS_FAMILY, FeedCategory.COMMUNITIES)
    }
}