package com.splinch.junction.assistant.provider

import java.util.Locale

/**
 * Formats the verbose run metrics the Windows host sends with `chat.complete`.
 *
 * The host reports generation speed from the model runtime's own eval timing,
 * so a missing rate means "not measured" and is omitted rather than shown as
 * zero. Only metrics are read here; reasoning text is never part of this line.
 */
object HostTelemetry {

    private fun Map<String, Any?>.number(key: String): Double? =
        when (val value = this[key]) {
            is Number -> value.toDouble()
            is String -> value.toDoubleOrNull()
            else -> null
        }

    private fun seconds(ms: Double): String =
        String.format(Locale.US, if (ms < 10_000) "%.2fs" else "%.1fs", ms / 1000.0)

    private fun count(value: Double): String = String.format(Locale.US, "%,d", value.toLong())

    /** Decode rate for the compact "tokens/s" label, or null when unmeasured. */
    fun tokensPerSecond(payload: Map<String, Any?>?): Double? =
        payload?.number("tokensPerSecond")?.takeIf { it > 0 }

    /** One owner-facing metrics line, or null when nothing useful was reported. */
    fun line(payload: Map<String, Any?>?): String? {
        if (payload == null) return null
        val parts = mutableListOf<String>()
        (payload["model"] as? String)?.takeIf { it.isNotBlank() }?.let { parts.add(it) }
        tokensPerSecond(payload)?.let { parts.add(String.format(Locale.US, "%.1f tok/s", it)) }
        payload.number("generatedTokens")?.takeIf { it > 0 }?.let { parts.add("${count(it)} out") }
        payload.number("inputTokens")?.takeIf { it > 0 }?.let { parts.add("${count(it)} in") }
        payload.number("durationMs")?.takeIf { it > 0 }?.let { parts.add("${seconds(it)} total") }
        payload.number("loadMs")?.takeIf { it > 0 }?.let { parts.add("${seconds(it)} model load") }
        payload.number("evalMs")?.takeIf { it > 0 }?.let { parts.add("${seconds(it)} generating") }
        payload.number("modelCalls")?.takeIf { it > 0 }?.let {
            parts.add("${it.toLong()} model call${if (it.toLong() == 1L) "" else "s"}")
        }
        val executed = payload.number("toolsExecuted") ?: 0.0
        val requested = payload.number("toolCalls") ?: 0.0
        if (executed > 0) {
            @Suppress("UNCHECKED_CAST")
            val names = (payload["toolNames"] as? List<Any?>)?.mapNotNull { it?.toString() }.orEmpty()
            val suffix = if (names.isEmpty()) "" else " (${names.joinToString(", ")})"
            parts.add("${executed.toLong()} tool${if (executed.toLong() == 1L) "" else "s"}$suffix")
        } else if (requested > 0) {
            parts.add("${requested.toLong()} tool request${if (requested.toLong() == 1L) "" else "s"}; none executed")
        }
        val thinkingCharacters = payload.number("thinkingCharacters") ?: 0.0
        when (payload["thinkingState"] as? String) {
            "reported" -> if (thinkingCharacters > 0) parts.add("${count(thinkingCharacters)} thinking chars")
            "enabled_no_output" -> parts.add("thinking on; none reported")
            "off" -> parts.add("thinking off")
        }
        return parts.takeIf { it.isNotEmpty() }?.joinToString(" · ")
    }
}
