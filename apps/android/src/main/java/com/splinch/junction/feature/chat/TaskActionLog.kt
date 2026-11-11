package com.splinch.junction.feature.chat

/** A display-only split of the host's stored, plain-text task progress report. */
data class TaskActionLog(
    val before: String,
    val actions: String,
    val after: String,
    val count: Int
) {
    companion object {
        private val heading = Regex("^Recorded actions:\\r?\\n", RegexOption.MULTILINE)
        private val action = Regex("•[ \\t]+\\S[^\\r\\n]*(?:\\r?\\n|$)")

        fun parse(source: String): TaskActionLog? {
            if (!source.startsWith("Progress on \"")) return null
            val marker = heading.find(source) ?: return null
            val start = marker.range.last + 1
            var end = start
            var count = 0
            // Everything following the contiguous bullet list stays visible,
            // including next steps, owner questions and Nethra's own note.
            while (end < source.length) {
                val entry = action.matchAt(source, end) ?: break
                end = entry.range.last + 1
                count++
            }
            if (count == 0) return null
            return TaskActionLog(source.substring(0, marker.range.first), source.substring(start, end), source.substring(end), count)
        }
    }
}
