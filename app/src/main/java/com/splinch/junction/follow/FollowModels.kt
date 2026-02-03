package com.splinch.junction.follow

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.util.UUID

enum class SourceApp {
    DISCORD,
    SPOTIFY,
    YOUTUBE,
    EMAIL,
    BLUESKY,
    TWITCH,
    OTHER
}

enum class FollowTargetType {
    USER,
    CHANNEL,
    SERVER,
    KEYWORD
}

enum class MatchType {
    CONTAINS,
    REGEX,
    EXACT
}

@Entity(tableName = "follow_targets")
data class FollowTargetEntity(
    @PrimaryKey val id: String = UUID.randomUUID().toString(),
    val type: FollowTargetType,
    val sourceApp: SourceApp,
    val label: String,
    // A string used to match notifications/content (e.g. display name, channel name, keyword).
    val match: String,
    val importance: Int = 50, // 0..100
    val isEnabled: Boolean = true,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = createdAt
)

@Entity(tableName = "interest_rules")
data class InterestRuleEntity(
    @PrimaryKey val id: String = UUID.randomUUID().toString(),
    val sourceApp: SourceApp,
    val matchType: MatchType,
    val pattern: String,
    val scoreDelta: Int,
    val isEnabled: Boolean = true,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = createdAt
)

enum class SuggestionType {
    FOLLOW_TARGET
}

enum class SuggestionStatus {
    PENDING,
    ACCEPTED,
    DISMISSED,
    SNOOZED,
    REJECTED_NEVER
}

@Entity(tableName = "suggestions")
data class SuggestionEntity(
    @PrimaryKey val id: String = UUID.randomUUID().toString(),
    val type: SuggestionType,
    val sourceApp: SourceApp,
    // A stable key that identifies the suggested thing (e.g. "bluesky:@handle", "discord:#general").
    val key: String,
    val title: String,
    val reason: String? = null,
    val status: SuggestionStatus = SuggestionStatus.PENDING,
    val snoozedUntil: Long? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = createdAt
)

@Entity(tableName = "rejected_suggestions")
data class RejectedSuggestionEntity(
    @PrimaryKey val key: String,
    val sourceApp: SourceApp,
    val rejectedAt: Long = System.currentTimeMillis()
)

