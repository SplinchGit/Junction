package com.splinch.junction.feature.projects

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** Kept outside the scrollable work record in both Tasks and the chat task sheet. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun TaskDetailHeader(
    task: Map<*, *>?, connected: Boolean, busy: Boolean,
    onBack: () -> Unit, onChat: () -> Unit, onControl: () -> Unit,
    onEdit: () -> Unit, onDelete: () -> Unit
) {
    val status = task?.get("status")?.toString()
    val terminal = status in setOf("COMPLETED", "CANCELLED", "FAILED")
    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = onBack) { Text("All tasks") }
            OutlinedButton(onClick = onDelete, enabled = !busy && connected,
                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("Delete") }
        }
        Text(task?.get("goal")?.toString() ?: "Task details", style = MaterialTheme.typography.titleMedium,
            maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(listOfNotNull(status, task?.get("model")?.toString()).joinToString(" · "), style = MaterialTheme.typography.bodySmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            TextButton(onClick = onChat, enabled = !busy && connected) { Text("Open conversation") }
            TextButton(onClick = onEdit, enabled = !busy && task != null) { Text("Edit") }
            if (!terminal && status != null) TextButton(onClick = onControl, enabled = !busy && connected) {
                Text(if (status == "PAUSED") "Resume" else "Pause")
            }
        }
        if (!connected) Text("Connect to your Windows host to change this task.", style = MaterialTheme.typography.bodySmall)
        HorizontalDivider()
    }
}
