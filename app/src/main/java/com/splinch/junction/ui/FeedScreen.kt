package com.splinch.junction.ui

import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.DismissDirection
import androidx.compose.material.DismissValue
import androidx.compose.material.ExperimentalMaterialApi
import androidx.compose.material.SwipeToDismiss
import androidx.compose.material.rememberDismissState
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.splinch.junction.feed.FeedRepository
import com.splinch.junction.feed.model.FeedCategory
import com.splinch.junction.feed.model.FeedItem
import com.splinch.junction.feed.model.FeedStatus
import com.splinch.junction.notifications.NotificationTapStore
import com.splinch.junction.update.UpdateInfo
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
@OptIn(ExperimentalMaterialApi::class, ExperimentalMaterial3Api::class)
fun FeedScreen(
    items: List<FeedItem>,
    lastOpenedAt: Long,
    feedRepository: FeedRepository,
    updateInfo: UpdateInfo?,
    onAskChat: (voice: Boolean) -> Unit = {},
    modifier: Modifier = Modifier
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }
    var selectedItem by remember { mutableStateOf<FeedItem?>(null) }
    var showUpdateBanner by remember { mutableStateOf(updateInfo != null) }
    var showChatChooser by remember { mutableStateOf(false) }

    LaunchedEffect(updateInfo) {
        showUpdateBanner = updateInfo != null
        if (updateInfo != null) {
            delay(6000)
            showUpdateBanner = false
        }
    }

    val activeItems = items.filter { it.status != FeedStatus.ARCHIVED }
    val grouped = activeItems.groupBy { it.category }
    val newSinceOpen = activeItems.count { it.timestamp > lastOpenedAt }
    val topCategories = activeItems
        .filter { it.timestamp > lastOpenedAt }
        .groupBy { it.category }
        .mapValues { (_, list) -> list.size }
        .entries
        .sortedByDescending { it.value }
        .take(3)

    Scaffold(snackbarHost = { SnackbarHost(snackbarHostState) }) { padding ->
        Column(
            modifier = modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(text = "Your Junction", style = MaterialTheme.typography.titleLarge)
                if (updateInfo != null) {
                    UpdateDot()
                }
            }

            if (updateInfo != null && showUpdateBanner) {
                UpdateBanner(updateInfo = updateInfo, onOpen = {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(updateInfo.url))
                    context.startActivity(intent)
                })
            }

            Text(
                text = "New since last open: $newSinceOpen",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (topCategories.isNotEmpty()) {
                Text(
                    text = "Top categories: " + topCategories.joinToString { "${it.key.label()} (${it.value})" },
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            if (activeItems.isEmpty()) {
                Text(
                    text = "All clear. No new items right now.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 16.dp)
                )
            } else {
                LazyColumn(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .padding(top = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    grouped.forEach { (category, categoryItems) ->
                        item {
                            CategoryHeader(category, categoryItems)
                        }
                        items(categoryItems, key = { it.id }) { item ->
                            val dismissState = rememberDismissState(confirmStateChange = { value ->
                                if (value == DismissValue.DismissedToEnd || value == DismissValue.DismissedToStart) {
                                    val previousStatus = item.status
                                    scope.launch {
                                        feedRepository.archive(item.id)
                                        val result = snackbarHostState.showSnackbar(
                                            message = "Archived",
                                            actionLabel = "Undo"
                                        )
                                        if (result == androidx.compose.material3.SnackbarResult.ActionPerformed) {
                                            feedRepository.updateStatus(item.id, previousStatus)
                                        }
                                    }
                                }
                                false
                            })

                            SwipeToDismiss(
                                state = dismissState,
                                directions = setOf(DismissDirection.EndToStart, DismissDirection.StartToEnd),
                                background = { SwipeBackground() },
                                dismissContent = {
                                    FeedCard(
                                        item = item,
                                        onClick = {
                                            scope.launch { feedRepository.markSeen(item.id) }
                                            selectedItem = item
                                        }
                                    )
                                }
                            )
                        }
                    }
                }
            }
        }
    }

    if (selectedItem != null) {
        ModalBottomSheet(onDismissRequest = { selectedItem = null }) {
            FeedActionSheet(
                item = selectedItem!!,
                onDismiss = { selectedItem = null },
                onArchive = {
                    val item = selectedItem ?: return@FeedActionSheet
                    scope.launch { feedRepository.archive(item.id) }
                    selectedItem = null
                },
                onMarkSeen = {
                    val item = selectedItem ?: return@FeedActionSheet
                    scope.launch { feedRepository.markSeen(item.id) }
                    selectedItem = null
                },
                onAskChat = {
                    // Ask voice/text in a separate prompt so it's always explicit.
                    showChatChooser = true
                    selectedItem = null
                },
                onOpen = {
                    val item = selectedItem ?: return@FeedActionSheet
                    val opened = item.threadKey?.let { NotificationTapStore.trySend(it) } == true
                    if (!opened) {
                        val packageName = item.packageName
                        if (!packageName.isNullOrBlank()) {
                            val launchIntent = context.packageManager.getLaunchIntentForPackage(packageName)
                            if (launchIntent != null) {
                                context.startActivity(launchIntent)
                            } else {
                                Toast.makeText(context, "Unable to open app", Toast.LENGTH_SHORT).show()
                            }
                        }
                    }
                    selectedItem = null
                }
            )
        }
    }

    if (showChatChooser) {
        ModalBottomSheet(onDismissRequest = { showChatChooser = false }) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(text = "Open JunctionGPT", style = MaterialTheme.typography.titleMedium)
                ActionRow("Text chat") {
                    showChatChooser = false
                    onAskChat(false)
                }
                ActionRow("Voice chat") {
                    showChatChooser = false
                    onAskChat(true)
                }
            }
        }
    }
}

@Composable
private fun UpdateDot() {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(MaterialTheme.colorScheme.primary)
            .sizeIn(minWidth = 10.dp, minHeight = 10.dp)
    )
}

@Composable
private fun UpdateBanner(updateInfo: UpdateInfo, onOpen: () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 10.dp, bottom = 10.dp)
            .clickable { onOpen() }
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(
                text = "Update available",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onPrimaryContainer
            )
            Text(
                text = "Version ${updateInfo.version} is ready. Tap to view release.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onPrimaryContainer
            )
        }
    }
}

@Composable
private fun CategoryHeader(category: FeedCategory, items: List<FeedItem>) {
    val unreadCount = items.count { it.status == FeedStatus.NEW }
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = category.label(),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold
        )
        if (unreadCount > 0) {
            Text(
                text = "$unreadCount new",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary
            )
        }
    }
}

@Composable
private fun FeedCard(item: FeedItem, onClick: () -> Unit) {
    val cardColor = when (item.status) {
        FeedStatus.NEW -> MaterialTheme.colorScheme.secondaryContainer
        FeedStatus.SEEN -> MaterialTheme.colorScheme.surfaceVariant
        FeedStatus.ARCHIVED -> MaterialTheme.colorScheme.surfaceVariant
    }

    Card(
        colors = CardDefaults.cardColors(containerColor = cardColor),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.clickable { onClick() }
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = item.source,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = formatTime(item.timestamp),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Text(
                text = item.title,
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(top = 6.dp)
            )
            if (!item.body.isNullOrBlank()) {
                Text(
                    text = item.body!!,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }
            if (item.status == FeedStatus.NEW) {
                Text(
                    text = if (item.aggregateCount > 1) "NEW • ${item.aggregateCount} updates" else "NEW",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(top = 8.dp)
                )
            } else if (item.aggregateCount > 1) {
                Text(
                    text = "${item.aggregateCount} updates",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp)
                )
            }
        }
    }
}

@Composable
private fun SwipeBackground() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .clip(RoundedCornerShape(16.dp))
            .background(MaterialTheme.colorScheme.errorContainer)
            .padding(16.dp),
        contentAlignment = Alignment.CenterStart
    ) {
        Text(
            text = "Archive",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onErrorContainer
        )
    }
}

@Composable
private fun FeedActionSheet(
    item: FeedItem,
    onDismiss: () -> Unit,
    onArchive: () -> Unit,
    onMarkSeen: () -> Unit,
    onAskChat: () -> Unit,
    onOpen: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(text = item.title, style = MaterialTheme.typography.titleMedium)
        when (item.category) {
            FeedCategory.FRIENDS_FAMILY -> {
                ActionRow("Open", onOpen)
                ActionRow("Ask JunctionGPT", onAskChat)
                ActionRow("Mark seen", onMarkSeen)
                ActionRow("Dismiss", onArchive)
            }
            FeedCategory.PROJECTS -> {
                ActionRow("Open", onOpen)
                ActionRow("Ask JunctionGPT", onAskChat)
                ActionRow("Mark done", onMarkSeen)
                ActionRow("Snooze", onDismiss)
            }
            FeedCategory.NEWS -> {
                ActionRow("Read", onOpen)
                ActionRow("Ask JunctionGPT", onAskChat)
                ActionRow("Save", onDismiss)
                ActionRow("Dismiss", onArchive)
            }
            FeedCategory.SYSTEM -> {
                ActionRow("Open app", onOpen)
                ActionRow("Ask JunctionGPT", onAskChat)
                ActionRow("Dismiss", onArchive)
            }
            else -> {
                ActionRow("Open", onOpen)
                ActionRow("Ask JunctionGPT", onAskChat)
                ActionRow("Mark seen", onMarkSeen)
                ActionRow("Dismiss", onArchive)
            }
        }
    }
}

@Composable
private fun ActionRow(label: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .clickable { onClick() }
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(text = label, style = MaterialTheme.typography.bodyMedium)
    }
}

private fun FeedCategory.label(): String {
    return name.replace('_', ' ').lowercase().replaceFirstChar { it.uppercase() }
}

private fun formatTime(timestamp: Long): String {
    val instant = Instant.ofEpochMilli(timestamp)
    val formatter = DateTimeFormatter.ofPattern("h:mm a")
    return formatter.format(instant.atZone(ZoneId.systemDefault()))
}
