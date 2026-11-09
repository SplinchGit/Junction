package com.splinch.junction.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import com.splinch.junction.data.preference.AppearancePrefs

private val LightColors = lightColorScheme(
    primary = md_light_primary,
    onPrimary = md_light_onPrimary,
    primaryContainer = md_light_primaryContainer,
    onPrimaryContainer = md_light_onPrimaryContainer,
    secondary = md_light_secondary,
    onSecondary = md_light_onSecondary,
    secondaryContainer = md_light_secondaryContainer,
    onSecondaryContainer = md_light_onSecondaryContainer
)

private val DarkColors = darkColorScheme(
    primary = md_dark_primary,
    onPrimary = md_dark_onPrimary,
    primaryContainer = md_dark_primaryContainer,
    onPrimaryContainer = md_dark_onPrimaryContainer,
    secondary = md_dark_secondary,
    onSecondary = md_dark_onSecondary,
    secondaryContainer = md_dark_secondaryContainer,
    onSecondaryContainer = md_dark_onSecondaryContainer
)

// Restrained palettes matching the Windows renderer's [data-palette] tokens.
private val SakuraDark = darkColorScheme(
    primary = Color(0xFFECBCCB), onPrimary = Color(0xFF4A1C2C),
    primaryContainer = Color(0xFF5C3443), onPrimaryContainer = Color(0xFFFFD9E2),
    secondary = Color(0xFFD8BFD9), onSecondary = Color(0xFF3B2A3F),
    secondaryContainer = Color(0xFF4D3A52), onSecondaryContainer = Color(0xFFF6DCF8),
    background = Color(0xFF15121A), surface = Color(0xFF15121A), surfaceVariant = Color(0xFF2A2430)
)
private val SakuraLight = lightColorScheme(
    primary = Color(0xFFA14A63), onPrimary = Color.White,
    primaryContainer = Color(0xFFFFD9E2), onPrimaryContainer = Color(0xFF3E0019),
    secondary = Color(0xFF7D5585), onSecondary = Color.White,
    secondaryContainer = Color(0xFFF6DCF8), onSecondaryContainer = Color(0xFF30113A),
    background = Color(0xFFFFF8F9), surface = Color(0xFFFFF8F9)
)
private val MossDark = darkColorScheme(
    primary = Color(0xFFB6D4BB), onPrimary = Color(0xFF213527),
    primaryContainer = Color(0xFF2F4636), onPrimaryContainer = Color(0xFFD2ECD6),
    secondary = Color(0xFFC9D0B0), onSecondary = Color(0xFF2F3420),
    secondaryContainer = Color(0xFF3D4530), onSecondaryContainer = Color(0xFFE1E8C8),
    background = Color(0xFF111512), surface = Color(0xFF111512), surfaceVariant = Color(0xFF26302A)
)
private val MossLight = lightColorScheme(
    primary = Color(0xFF3F6248), onPrimary = Color.White,
    primaryContainer = Color(0xFFD2ECD6), onPrimaryContainer = Color(0xFF0B2013),
    secondary = Color(0xFF5C6440), onSecondary = Color.White,
    secondaryContainer = Color(0xFFE1E8C8), onSecondaryContainer = Color(0xFF1A1E07),
    background = Color(0xFFF7FBF5), surface = Color(0xFFF7FBF5)
)

private data class PastelTokens(
    val accent: Long, val onAccent: Long, val container: Long, val onContainer: Long,
    val surface: Long, val onSurface: Long, val variant: Long, val onVariant: Long
)

private data class PastelPalette(val light: PastelTokens, val dark: PastelTokens)

// The same accents, containers and page colours are used by the Windows palettes.
private val Pastels = mapOf(
    "lavender" to PastelPalette(
        light = PastelTokens(0xFF685182, 0xFFFFFFFF, 0xFFEBDDF7, 0xFF281738,
            0xFFFCF8FF, 0xFF211B28, 0xFFE9E0F0, 0xFF514858),
        dark = PastelTokens(0xFFD9C8F2, 0xFF30233D, 0xFF3D304D, 0xFFF0E5FF,
            0xFF14111A, 0xFFEEE8F1, 0xFF302837, 0xFFD0C4D8)
    ),
    "peach" to PastelPalette(
        light = PastelTokens(0xFF8C5745, 0xFFFFFFFF, 0xFFFFDBCB, 0xFF35170D,
            0xFFFFF8F5, 0xFF2B1D17, 0xFFF2E0D8, 0xFF5D4940),
        dark = PastelTokens(0xFFF2C5B2, 0xFF442A20, 0xFF51382F, 0xFFFFE0D2,
            0xFF1B1311, 0xFFF3E7E1, 0xFF382B26, 0xFFDAC5BA)
    ),
    "mint" to PastelPalette(
        light = PastelTokens(0xFF406958, 0xFFFFFFFF, 0xFFD2EDDF, 0xFF102D21,
            0xFFF5FCF7, 0xFF18251E, 0xFFDFEBE3, 0xFF43564A),
        dark = PastelTokens(0xFFB7DECB, 0xFF17382A, 0xFF2B4439, 0xFFD2F0E1,
            0xFF101814, 0xFFE3EEE7, 0xFF26372D, 0xFFBFD2C5)
    ),
    "sky" to PastelPalette(
        light = PastelTokens(0xFF4B667D, 0xFFFFFFFF, 0xFFD8EAF9, 0xFF172D40,
            0xFFF6FAFF, 0xFF1C242C, 0xFFE1E9F2, 0xFF475461),
        dark = PastelTokens(0xFFBDD9EF, 0xFF203647, 0xFF304354, 0xFFD9EDFF,
            0xFF11161C, 0xFFE5EDF5, 0xFF29343F, 0xFFC2D0DF)
    ),
    "butter" to PastelPalette(
        light = PastelTokens(0xFF756536, 0xFFFFFFFF, 0xFFF2E5B7, 0xFF2C2408,
            0xFFFFFBEF, 0xFF282313, 0xFFEEE7D1, 0xFF59513B),
        dark = PastelTokens(0xFFE6D6A3, 0xFF3C3218, 0xFF49412B, 0xFFF7E9BA,
            0xFF18160F, 0xFFF0EBD9, 0xFF363124, 0xFFD1C8AD)
    )
)

private fun pastelColorScheme(tokens: PastelTokens, dark: Boolean): ColorScheme {
    val accent = Color(tokens.accent)
    val onAccent = Color(tokens.onAccent)
    val container = Color(tokens.container)
    val onContainer = Color(tokens.onContainer)
    val surface = Color(tokens.surface)
    val onSurface = Color(tokens.onSurface)
    val variant = Color(tokens.variant)
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = accent, onPrimary = onAccent,
        primaryContainer = container, onPrimaryContainer = onContainer,
        secondary = accent, onSecondary = onAccent,
        secondaryContainer = container, onSecondaryContainer = onContainer,
        tertiary = accent, onTertiary = onAccent,
        tertiaryContainer = container, onTertiaryContainer = onContainer,
        background = surface, onBackground = onSurface,
        surface = surface, onSurface = onSurface,
        surfaceVariant = variant, onSurfaceVariant = Color(tokens.onVariant),
        surfaceTint = accent,
        surfaceDim = if (dark) surface else lerp(surface, variant, 0.75f),
        surfaceBright = if (dark) lerp(surface, variant, 0.85f) else surface,
        surfaceContainerLowest = surface,
        surfaceContainerLow = lerp(surface, variant, 0.25f),
        surfaceContainer = lerp(surface, variant, 0.45f),
        surfaceContainerHigh = lerp(surface, variant, 0.65f),
        surfaceContainerHighest = variant,
        outline = lerp(Color(tokens.onVariant), variant, 0.30f),
        outlineVariant = lerp(Color(tokens.onVariant), variant, 0.70f)
    )
}

/** Picks the colour scheme for a palette and resolved light/dark mode. */
fun junctionColorScheme(palette: String, dark: Boolean): ColorScheme {
    Pastels[palette]?.let { return pastelColorScheme(if (dark) it.dark else it.light, dark) }
    return when (palette) {
        "sakura" -> if (dark) SakuraDark else SakuraLight
        "moss" -> if (dark) MossDark else MossLight
        else -> if (dark) DarkColors else LightColors
    }
}

/** Resolves the owner's mode against the system setting. */
fun resolveDark(mode: String, systemDark: Boolean): Boolean = when (mode) {
    "light" -> false
    "dark" -> true
    else -> systemDark
}

@Composable
fun JunctionTheme(appearance: AppearancePrefs = AppearancePrefs(), content: @Composable () -> Unit) {
    val dark = resolveDark(appearance.mode, isSystemInDarkTheme())
    MaterialTheme(
        colorScheme = junctionColorScheme(appearance.palette, dark),
        typography = JunctionTypography,
        shapes = JunctionShapes,
        content = content
    )
}
