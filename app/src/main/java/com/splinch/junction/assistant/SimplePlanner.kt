package com.splinch.junction.assistant

import org.json.JSONObject

interface Planner {
    fun plan(text: String): List<Action>
}

class SimplePlanner(private val appNameToPackage: Map<String, String> = emptyMap()) : Planner {
    override fun plan(text: String): List<Action> {
        val trimmed = text.trim()
        val lower = trimmed.lowercase()

        // Open app: "open twitter" or "open com.twitter.android"
        val openMatch = Regex("^open\\s+(.+)", RegexOption.IGNORE_CASE).find(trimmed)
        if (openMatch != null) {
            val name = openMatch.groupValues[1].trim()
            val pkg = when {
                name.contains('.') -> name
                appNameToPackage.containsKey(name.lowercase()) -> appNameToPackage[name.lowercase()]
                else -> null
            }
            val summary = "Open ${name}"
            return listOf(
                Action(
                    type = ActionType.OPEN_APP,
                    target = pkg ?: name,
                    risk = Risk.LOW,
                    summary = summary
                )
            )
        }

        // Deep link
        val urlMatch = Regex("https?://[^\\s]+", RegexOption.IGNORE_CASE).find(trimmed)
        if (urlMatch != null) {
            val url = urlMatch.value
            return listOf(
                Action(
                    type = ActionType.DEEP_LINK,
                    target = url,
                    risk = Risk.LOW,
                    summary = "Open link"
                )
            )
        }

        // Send message (simple heuristic)
        val msgMatch = Regex("^send\\s+message\\s+to\\s+([\\w @.]+):\\s*(.+)", RegexOption.IGNORE_CASE).find(trimmed)
        if (msgMatch != null) {
            val recipient = msgMatch.groupValues[1].trim()
            val body = msgMatch.groupValues[2].trim()
            val payload = JSONObject().put("recipient", recipient).put("body", body)
            return listOf(
                Action(
                    type = ActionType.SEND_MESSAGE,
                    payload = payload,
                    risk = Risk.MEDIUM,
                    summary = "Send message to $recipient"
                )
            )
        }

        // fallback: treat as chat
        return listOf(
            Action(
                type = ActionType.AI_CHAT,
                summary = "Chat: ${trimmed.take(100)}",
                payload = JSONObject().put("text", trimmed),
                risk = Risk.LOW
            )
        )
    }
}
