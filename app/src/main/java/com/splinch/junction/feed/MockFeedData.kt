package com.splinch.junction.feed

import java.time.Instant

object MockFeedData {
    fun build(now: Instant = Instant.now()): List<SocialEvent> {
        return listOf(
            SocialEvent(
                source = FeedSource.DISCORD,
                title = "Discord: Design Council",
                summary = "3 new messages in #junction-ui. Last: \"Do we want a calmer tone for onboarding?\"",
                timestamp = now.minusSeconds(15 * 60),
                priority = FeedPriority.MEDIUM,
                actionLabel = "Open thread"
            ),
            SocialEvent(
                source = FeedSource.TWITCH,
                title = "Twitch: LumaNova is live",
                summary = "Stream started 5 minutes ago. 1.2k viewers. Topic: " +
                    "‘Building kinder notification systems’.",
                timestamp = now.minusSeconds(5 * 60),
                priority = FeedPriority.LOW,
                actionLabel = "Watch"
            ),
            SocialEvent(
                source = FeedSource.YOUTUBE,
                title = "YouTube: ZED uploaded",
                summary = "New upload: ‘Scheduling your socials without burnout’.",
                timestamp = now.minusSeconds(2 * 60 * 60),
                priority = FeedPriority.LOW,
                actionLabel = "Queue"
            ),
            SocialEvent(
                source = FeedSource.CALENDAR,
                title = "Calendar: Sponsor call",
                summary = "Call with CyanWorks in 25 minutes. Agenda: Q1 collab plan.",
                timestamp = now.plusSeconds(25 * 60),
                priority = FeedPriority.HIGH,
                actionLabel = "Join"
            ),
            SocialEvent(
                source = FeedSource.SOCIAL,
                title = "Inbox: 7 DMs need triage",
                summary = "3 from creators, 2 from community mods, 2 from brands.",
                timestamp = now.minusSeconds(3 * 60 * 60),
                priority = FeedPriority.MEDIUM,
                actionLabel = "Triage"
            ),
            SocialEvent(
                source = FeedSource.EMAIL,
                title = "Email: Partnership brief",
                summary = "Draft proposal from Ravel Labs. Response due tomorrow.",
                timestamp = now.minusSeconds(6 * 60 * 60),
                priority = FeedPriority.HIGH,
                actionLabel = "Review"
            )
        )
    }
}
