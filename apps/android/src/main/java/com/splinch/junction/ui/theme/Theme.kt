package com.splinch.junction.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
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

/** Picks the colour scheme for a palette and resolved light/dark mode. */
fun junctionColorScheme(palette: String, dark: Boolean): ColorScheme = when (palette) {
    "sakura" -> if (dark) SakuraDark else SakuraLight
    "moss" -> if (dark) MossDark else MossLight
    else -> if (dark) DarkColors else LightColors
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
