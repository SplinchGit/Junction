package com.splinch.junction.feature.projects

import java.util.Locale

object ObjectivePerformance {
    fun lines(report: Map<*, *>?): List<String> {
        val objective = report?.get("objective") as? Map<*, *> ?: emptyMap<String, Any>()
        val chat = report?.get("chat") as? Map<*, *> ?: emptyMap<String, Any>()
        fun count(row: Map<*, *>) = ((row["sampleCount"] as? Number)?.toInt() ?: 0).coerceAtLeast(0)
        fun seconds(value: Any?): String? = (value as? Number)?.toDouble()?.takeIf { it > 0 && it.isFinite() }
            ?.let { String.format(Locale.US, "%.1f s", it / 1000) }
        val taskCount = count(objective)
        val chatCount = count(chat)
        val taskLine = if (taskCount > 0 && seconds(objective["medianInferenceMs"]) != null)
            "$taskCount task model call${if (taskCount == 1) "" else "s"} · median inference ${seconds(objective["medianInferenceMs"])}"
        else "No measured samples for this task in the last 7 days."
        val chatLine = if (chatCount > 0 && seconds(chat["medianResponseMs"]) != null) {
            val speed = (chat["medianTokensPerSecond"] as? Number)?.toDouble()?.takeIf { it > 0 && it.isFinite() }
            "$chatCount local chat repl${if (chatCount == 1) "y" else "ies"} · median response ${seconds(chat["medianResponseMs"])}" +
                (speed?.let { " · ${it.toInt()} tokens/s" } ?: "")
        } else "No measured samples for local chat in the last 7 days."
        return listOf(taskLine, chatLine)
    }
}
