package com.splinch.junction.chat

import java.time.Instant

sealed class CommandResult {
    data class Help(val text: String) : CommandResult()
    object Clear : CommandResult()
    data class Stats(val text: String) : CommandResult()
    data class Export(val format: String) : CommandResult()
    data class MemorySearch(val query: String) : CommandResult()
    object Who : CommandResult()
    data class Set(val option: String, val value: String) : CommandResult()
    data class Error(val message: String) : CommandResult()
}

data class ProcessedMessage(
    val content: String,
    val commandResult: CommandResult? = null
)

class MessageHandler {
    fun processMessage(content: String, sender: Sender): ProcessedMessage {
        val trimmed = content.trim()
        if (trimmed.startsWith("/")) {
            val parts = trimmed.split(" ")
            val command = parts.firstOrNull()?.lowercase() ?: ""
            val args = if (parts.size > 1) parts.drop(1) else emptyList()
            return ProcessedMessage("", handleCommand(command, args, sender))
        }

        val filtered = applyFilters(trimmed)
        val formatted = formatMentions(filtered)
        return ProcessedMessage(formatted, null)
    }

    fun validateMessage(content: String): Pair<Boolean, String?> {
        if (content.isBlank()) {
            return false to "Message cannot be empty"
        }
        if (content.length > 4000) {
            return false to "Message too long (max 4000 characters)"
        }
        val uniqueChars = content.toSet().size
        if (uniqueChars < 3 && content.length > 10) {
            return false to "Message appears to be spam"
        }
        return true to null
    }

    private fun handleCommand(command: String, args: List<String>, sender: Sender): CommandResult {
        return when (command) {
            "/help" -> CommandResult.Help(buildHelpText())
            "/clear" -> CommandResult.Clear
            "/stats" -> CommandResult.Stats("Requesting stats")
            "/export" -> CommandResult.Export(args.firstOrNull() ?: "json")
            "/memory" -> CommandResult.MemorySearch(args.joinToString(" "))
            "/who" -> CommandResult.Who
            "/set" -> {
                if (args.size < 2) {
                    CommandResult.Error("Usage: /set <option> <value>")
                } else {
                    CommandResult.Set(args[0], args.drop(1).joinToString(" "))
                }
            }
            else -> CommandResult.Error("Unknown command: $command")
        }
    }

    private fun applyFilters(content: String): String {
        var filtered = content
        filtered = filtered.replace(Regex("\\s+"), " ").trim()
        filtered = filtered.replace(Regex("([!?.]){4,}"), "$1$1$1")
        return filtered
    }

    private fun formatMentions(content: String): String {
        return content
    }

    private fun buildHelpText(): String {
        return """
Available Commands:
  /help            - Show this help message
  /clear           - Clear the current chat session
  /stats           - Show chat statistics
  /export [format] - Export conversation (json/text)
  /memory [query]  - Search memory for information
  /who             - Show participant information
  /set <option> <value> - Change settings

Chat Features:
  - Single assistant conversation (JunctionGPT)
  - Session-level message storage
  - @mentions preserved for future formatting
""".trimIndent()
    }
}
