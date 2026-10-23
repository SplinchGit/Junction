package com.splinch.junction.feature.projects

import java.text.DateFormat
import java.util.Date

/**
 * Where Nethra is with an objective, as the owner asked to see it:
 * green = working on it right now, amber = in progress (queued, waiting for its next
 * check, or waiting on the owner), red = ended, grey = paused or blocked.
 */
enum class ObjectiveLight { GREEN, AMBER, RED, GREY }

data class ObjectiveStatus(val light: ObjectiveLight, val label: String, val ended: Boolean) {
    companion object {
        private val ENDED = setOf("COMPLETED", "CANCELLED", "FAILED")
        fun forConversation(objectives: List<Map<*, *>>, conversationId: String): List<Map<*, *>> =
            objectives.filter { it["conversationId"]?.toString() == conversationId }

        fun of(objective: Map<*, *>, now: Long = System.currentTimeMillis()): ObjectiveStatus {
            val status = objective["status"]?.toString().orEmpty()
            val live = objective["live"] == true
            val nextWake = (objective["nextWakeAt"] as? Number)?.toLong()
            return when {
                live -> ObjectiveStatus(ObjectiveLight.GREEN, "Working on it now", false)
                status == "COMPLETED" -> ObjectiveStatus(ObjectiveLight.RED, "Done", true)
                status == "CANCELLED" -> ObjectiveStatus(ObjectiveLight.RED, "Cancelled", true)
                status == "FAILED" -> ObjectiveStatus(ObjectiveLight.RED, "Stopped with an error", true)
                status == "WAITING_FOR_USER" -> ObjectiveStatus(ObjectiveLight.AMBER, "Needs your input", false)
                status == "BLOCKED" -> ObjectiveStatus(ObjectiveLight.GREY, "Blocked", false)
                status == "PAUSED" -> ObjectiveStatus(ObjectiveLight.GREY, "Paused", false)
                status == "SLEEPING" && nextWake != null && nextWake > now ->
                    ObjectiveStatus(ObjectiveLight.AMBER, "Next check ${DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(nextWake))}", false)
                else -> ObjectiveStatus(ObjectiveLight.AMBER, "Queued", false)
            }
        }

        /** "Step 2 of 4: Summarise sources", or null when no plan exists yet. */
        fun stepLine(objective: Map<*, *>): String? {
            val progress = objective["progress"] as? Map<*, *>
            val done = (progress?.get("done") as? Number)?.toInt() ?: 0
            val total = (progress?.get("total") as? Number)?.toInt() ?: 0
            val step = objective["step"]?.toString()?.takeIf { it.isNotBlank() && it != "null" }
            return when {
                total > 0 && step != null -> "Step ${minOf(done + 1, total)} of $total: $step"
                total > 0 -> "$done of $total steps done"
                else -> null
            }
        }

        /** Header summary: the brightest light across objectives that have not ended, and how many. */
        fun overall(objectives: List<Map<*, *>>, now: Long = System.currentTimeMillis()): Pair<ObjectiveLight, Int>? {
            val open = objectives.filterNot { it["status"]?.toString() in ENDED }
            if (open.isEmpty()) return null
            val lights = open.map { of(it, now).light }
            val light = when {
                ObjectiveLight.GREEN in lights -> ObjectiveLight.GREEN
                ObjectiveLight.AMBER in lights -> ObjectiveLight.AMBER
                else -> ObjectiveLight.GREY
            }
            return light to open.size
        }
    }
}
