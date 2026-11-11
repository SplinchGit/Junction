package com.splinch.junction.feature.projects

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class NethraPanelTest {
    @get:Rule val compose = createComposeRule()
    private val task = mapOf<String, Any?>("id" to "task-1", "goal" to "Business plan", "status" to "ACTIVE", "revision" to 1, "model" to "qwen3:30b")

    @Test fun stopAgentTargetsTheChildAndKeepsTheParentTask() {
        var stopPayload: Map<String, Any?>? = null
        compose.setContent {
            MaterialTheme {
                NethraPanel(Modifier.fillMaxSize(), initialTaskId = "task-1", requestTask = { type, payload ->
                    when (type) {
                        "nethra.list" -> mapOf("objectives" to listOf(task), "settings" to mapOf("childDelegation" to true))
                        "nethra.get" -> mapOf("task" to task, "children" to listOf(mapOf(
                            "id" to "agent-1", "scope" to "Check published grant criteria",
                            "status" to if (stopPayload == null) "ACTIVE" else "STOPPED"
                        )))
                        "nethra.child.stop" -> { stopPayload = payload; emptyMap() }
                        else -> emptyMap()
                    }
                })
            }
        }
        compose.waitUntil(10_000) { compose.onAllNodesWithText("Stop agent").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Stop agent").performScrollTo().performClick()
        compose.waitUntil(10_000) { stopPayload != null }
        assertEquals(mapOf("id" to "task-1", "childId" to "agent-1"), stopPayload)
        compose.waitUntil(10_000) { compose.onAllNodesWithText("Stopped · Check published grant criteria").fetchSemanticsNodes().isNotEmpty() }
    }

    @Test fun notificationPreferencesSaveThroughHostAndValidateQuietHours() {
        var settings = mapOf<String, Any?>("proactiveUpdates" to "ALL", "quietHours" to mapOf("enabled" to true, "start" to "22:00", "end" to "07:00"))
        val writes = mutableListOf<Map<String, Any?>>()
        compose.setContent {
            MaterialTheme {
                NethraPanel(Modifier.fillMaxSize(), requestTask = { type, payload ->
                    when (type) {
                        "nethra.list" -> mapOf("objectives" to emptyList<Map<String, Any?>>(), "settings" to settings)
                        "nethra.settings" -> { writes.add(payload); settings = settings + payload; mapOf("settings" to settings) }
                        else -> emptyMap()
                    }
                })
            }
        }
        compose.waitUntil(10_000) { compose.onAllNodesWithText("Notification settings").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Notification settings").performScrollTo().performClick()
        compose.onNodeWithText("Important updates only").performScrollTo().performClick()
        compose.waitUntil(10_000) { writes.any { it["proactiveUpdates"] == "IMPORTANT" } }
        compose.onNodeWithText("Edit quiet hours").performScrollTo().performClick()
        compose.onNodeWithText("Start (HH:mm)").performTextReplacement("25:00")
        compose.onNodeWithText("Save quiet hours").assertIsNotEnabled()
        compose.onNodeWithText("Start (HH:mm)").performTextReplacement("22:15")
        compose.onNodeWithText("End (HH:mm)").performTextReplacement("07:30")
        compose.onNodeWithText("Save quiet hours").performClick()
        compose.waitUntil(10_000) { writes.any { it["quietHours"] == mapOf("enabled" to true, "start" to "22:15", "end" to "07:30") } }
    }

    @Test fun deleteIsVisibleBeforeLongDetailsAndRequiresConfirmation() {
        var deleted = false
        var confirmed = false
        compose.setContent {
            MaterialTheme {
                NethraPanel(Modifier.fillMaxSize(), initialTaskId = "task-1", requestTask = { type, payload ->
                    when (type) {
                        "nethra.list" -> mapOf("objectives" to if (deleted) emptyList<Map<String, Any?>>() else listOf(task), "settings" to emptyMap<String, Any?>())
                        "nethra.get" -> mapOf("task" to task, "events" to (1..100).map { mapOf("kind" to "MODEL_STEP", "detail" to "Long technical record $it") })
                        "nethra.delete" -> { confirmed = payload["confirm"] == true; deleted = true; mapOf("deleted" to true, "id" to "task-1") }
                        else -> emptyMap()
                    }
                })
            }
        }
        compose.waitUntil(10_000) { compose.onAllNodesWithText("Delete").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Delete").assertIsDisplayed().performClick()
        compose.onNodeWithText("Delete this task?").assertIsDisplayed()
        assertFalse(deleted)
        compose.onNodeWithText("Keep it").performClick()
        assertFalse(deleted)
        compose.onNodeWithText("Delete").performClick()
        compose.onAllNodesWithText("Delete").onLast().performClick()
        compose.waitUntil(10_000) { deleted }
        assertTrue(confirmed)
        compose.waitUntil(10_000) { compose.onAllNodesWithText("Business plan").fetchSemanticsNodes().isEmpty() }
    }

    @Test fun unavailableDetailsDoNotHideDeleteAndLargeFontsKeepItAtTheTop() {
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(1f, 1.8f)) {
                MaterialTheme {
                    Column(Modifier.width(320.dp).height(480.dp)) {
                        TaskDetailHeader(null, connected = false, busy = false, onBack = {}, onChat = {}, onControl = {}, onEdit = {}, onDelete = {})
                    }
                }
            }
        }
        compose.onNodeWithText("Delete").assertIsDisplayed().assertIsNotEnabled()
        compose.onNodeWithText("Connect to your Windows host to change this task.").assertExists()
    }

    @Test fun taskListExposesDeletionForEndedTasks() {
        compose.setContent {
            MaterialTheme {
                NethraPanel(Modifier.fillMaxSize(), requestTask = { type, _ ->
                    if (type == "nethra.list") mapOf("objectives" to listOf(task + ("status" to "COMPLETED")), "settings" to emptyMap<String, Any?>()) else emptyMap()
                })
            }
        }
        compose.waitUntil(10_000) { compose.onAllNodesWithContentDescription("Delete task").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("Delete task").performScrollTo().assertIsDisplayed().performClick()
        compose.onNodeWithText("Delete this task?").assertIsDisplayed()
    }
}
