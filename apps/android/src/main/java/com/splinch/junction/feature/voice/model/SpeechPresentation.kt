package com.splinch.junction.feature.voice.model

import java.util.Locale

/** Presentation cleanup only; the original reply stays visible in the conversation. */
fun speechText(text: String): String = text
    .replace(Regex("```[^\\n]*\\n[\\s\\S]*?(?:```|$)"), "Code is shown in the chat.")
    .replace(Regex("!?\\[([^]\\n]+)]\\(https?://[^\\s)]+\\)"), "$1")
    .replace(Regex("\\[S\\d+(?:\\.p\\d+)?]"), "")
    .replace(Regex("(?m)^\\s{0,3}(?:#{1,6}\\s+|[-*+]\\s+|>\\s*)"), "")
    .replace(Regex("\\*\\*([^*]+)\\*\\*"), "$1")
    .replace(Regex("__([^_]+)__"), "$1")
    .replace(Regex("`([^`]+)`"), "$1")
    .replace(Regex("[ \\t]+"), " ")
    .replace(Regex(" *\\n *"), "\n")
    .trim()

data class SpeechVoice(
    val name: String,
    val locale: Locale,
    val quality: Int,
    val latency: Int,
    val networkRequired: Boolean = false,
    val installed: Boolean = true
)

/** Never opt an offline voice into network synthesis or trigger a voice download. */
fun preferredSpeechVoice(voices: List<SpeechVoice>, locale: Locale): String? = voices
    .filter { it.installed && !it.networkRequired && it.locale.language == locale.language }
    .sortedWith(compareByDescending<SpeechVoice> { it.locale == locale }
        .thenByDescending { it.locale.country == locale.country }
        .thenByDescending { it.quality }
        .thenBy { it.latency }
        .thenBy { it.name })
    .firstOrNull()?.name
