package com.splinch.junction.feed

import com.splinch.junction.data.FeedDao
import com.splinch.junction.data.FeedEventEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.time.Instant

class FeedRepository(private val feedDao: FeedDao) {
    val eventsFlow: Flow<List<SocialEvent>> = feedDao.observeEvents().map { entities ->
        entities.map { it.toModel() }
    }

    suspend fun seedIfEmpty() {
        if (feedDao.countEvents() == 0) {
            val seed = MockFeedData.build().map { it.toEntity() }
            feedDao.insertEvents(seed)
        }
    }

    suspend fun getEventsForDigest(): List<SocialEvent> {
        return feedDao.getEvents().map { it.toModel() }
    }

    private fun FeedEventEntity.toModel(): SocialEvent {
        return SocialEvent(
            id = id,
            source = FeedSource.valueOf(source),
            title = title,
            summary = summary,
            timestamp = Instant.ofEpochMilli(timestamp),
            priority = FeedPriority.valueOf(priority),
            actionLabel = actionLabel
        )
    }

    private fun SocialEvent.toEntity(): FeedEventEntity {
        return FeedEventEntity(
            id = id,
            source = source.name,
            title = title,
            summary = summary,
            timestamp = timestamp.toEpochMilli(),
            priority = priority.name,
            actionLabel = actionLabel
        )
    }
}
