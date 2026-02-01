package com.splinch.junction.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.splinch.junction.feed.FeedPriority
import com.splinch.junction.feed.FeedSource
import com.splinch.junction.feed.SocialEvent
import java.time.Duration
import java.time.Instant

@Composable
fun FeedScreen(events: List<SocialEvent>, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxSize().padding(16.dp)) {
        Text(
            text = "Your Junction",
            style = MaterialTheme.typography.titleLarge
        )
        Text(
            text = "A calm pulse of what matters next",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(top = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(events) { event ->
                FeedCard(event)
            }
        }
    }
}

@Composable
private fun FeedCard(event: SocialEvent) {
    val cardColor = when (event.priority) {
        FeedPriority.HIGH -> MaterialTheme.colorScheme.errorContainer
        FeedPriority.MEDIUM -> MaterialTheme.colorScheme.secondaryContainer
        FeedPriority.LOW -> MaterialTheme.colorScheme.surfaceVariant
    }

    Card(
        colors = CardDefaults.cardColors(containerColor = cardColor),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                SourcePill(event.source)
                Text(
                    text = formatTime(event.timestamp),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Text(
                text = event.title,
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(top = 8.dp)
            )
            Text(
                text = event.summary,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 4.dp)
            )
            if (!event.actionLabel.isNullOrBlank()) {
                Text(
                    text = event.actionLabel.uppercase(),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(top = 10.dp)
                )
            }
        }
    }
}

@Composable
private fun SourcePill(source: FeedSource) {
    val label = when (source) {
        FeedSource.DISCORD -> "Discord"
        FeedSource.TWITCH -> "Twitch"
        FeedSource.YOUTUBE -> "YouTube"
        FeedSource.CALENDAR -> "Calendar"
        FeedSource.SOCIAL -> "Social"
        FeedSource.EMAIL -> "Email"
    }

    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 10.dp, vertical = 4.dp)
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

private fun formatTime(timestamp: Instant, now: Instant = Instant.now()): String {
    val duration = Duration.between(now, timestamp)
    val minutes = duration.toMinutes()
    return when {
        minutes >= 0 && minutes < 60 -> "in ${minutes}m"
        minutes >= 60 -> "in ${minutes / 60}h"
        minutes <= -60 -> "${kotlin.math.abs(minutes) / 60}h ago"
        else -> "${kotlin.math.abs(minutes)}m ago"
    }
}
