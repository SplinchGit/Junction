package com.splinch.junction.data.preference

/**
 * Appearance shared in concept with Windows (`appearance-store.js`): the same mode,
 * palette, artwork, intensity and motion vocabulary, persisted per device.
 */
data class AppearancePrefs(
    val mode: String = "system",
    val palette: String = "junction",
    val artwork: String = "none",
    val backgroundIntensity: Int = 55,
    val petals: Boolean = true,
    val petalIntensity: Int = 35,
    val motion: String = "system"
) {
    fun normalized(): AppearancePrefs = AppearancePrefs(
        mode = mode.takeIf { it in MODES } ?: "system",
        palette = palette.takeIf { it in PALETTES } ?: "junction",
        artwork = artwork.takeIf { it in ARTWORK } ?: "none",
        backgroundIntensity = backgroundIntensity.coerceIn(0, 100),
        petals = petals,
        petalIntensity = petalIntensity.coerceIn(0, 100),
        motion = motion.takeIf { it in MOTION } ?: "system"
    )

    /** Petals run only with artwork, when enabled, and when motion is allowed right now. */
    fun petalsAllowed(systemReducedMotion: Boolean, powerSave: Boolean): Boolean =
        artwork != "none" && petals && petalIntensity > 0 && !powerSave &&
            (motion == "full" || (motion == "system" && !systemReducedMotion))

    companion object {
        val MODES = listOf("system", "light", "dark")
        val PALETTES = listOf("junction", "sakura", "moss")
        val ARTWORK = listOf("none", "sakura-mountain")
        val MOTION = listOf("system", "reduced", "full")
    }
}

/**
 * Voice output choices. Preserve the original voice identity and phone fallback. New
 * quality preferences use 48 kHz / 192 kbps; explicitly saved quality choices are retained.
 */
data class VoicePrefs(
    val azureVoice: String = AZURE_DEFAULT_VOICE,
    val azureQuality: String = "studio",
    val deviceVoice: String = DEVICE_ENGINE_DEFAULT
) {
    companion object {
        const val AZURE_DEFAULT_VOICE = "en-GB-OllieMultilingualNeural"
        /** Azure's high-definition model of the same Ollie persona (network, may bill at the HD rate). */
        const val AZURE_HD_VOICE = "en-GB-Ollie:DragonHDLatestNeural"
        const val DEVICE_ENGINE_DEFAULT = ""
        /** Best installed offline voice for the locale (the earlier automatic selection, now opt-in). */
        const val DEVICE_BEST_OFFLINE = "auto:best-offline"
        val AZURE_QUALITY = mapOf(
            "standard" to "audio-24khz-48kbitrate-mono-mp3",
            "high" to "audio-48khz-96kbitrate-mono-mp3",
            "studio" to "audio-48khz-192kbitrate-mono-mp3"
        )
    }
}
