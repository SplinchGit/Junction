package com.splinch.junction.feature.voice.model

/**
 * The voice that is actually producing speech, read from the engine at the moment it
 * speaks: never inferred from what the assistant says about itself.
 */
data class TtsIdentity(
    /** "Azure AI Speech" or "Android TextToSpeech". */
    val provider: String,
    /** TTS engine package for on-device speech (for example com.google.android.tts). */
    val engine: String?,
    val voice: String?,
    val locale: String?,
    /** True when synthesis needs the network (Azure, or an online on-device voice). */
    val network: Boolean,
    /** Output encoding where known, e.g. "MP3 24 kHz 48 kbps". */
    val format: String? = null,
    /** Android Voice quality constant (100 = very low … 500 = very high) when reported. */
    val quality: Int? = null,
    /** Set when a cloud voice failed and the on-device engine spoke instead. */
    val fallbackFrom: String? = null
) {
    fun describe(): String = buildString {
        append(provider)
        voice?.let { append(" · ").append(it) }
        locale?.let { append(" · ").append(it) }
        append(if (network) " · network synthesis" else " · on-device synthesis")
        format?.let { append(" · ").append(it) }
        engine?.let { append(" · engine ").append(it) }
        fallbackFrom?.let { append(" (fallback: ").append(it).append(" was unavailable)") }
    }
}

fun azureFormatLabel(format: String): String = when (format) {
    "audio-48khz-192kbitrate-mono-mp3" -> "MP3 48 kHz 192 kbps mono"
    "audio-24khz-48kbitrate-mono-mp3" -> "MP3 24 kHz 48 kbps mono"
    "audio-48khz-96kbitrate-mono-mp3" -> "MP3 48 kHz 96 kbps mono"
    else -> format
}
