package com.splinch.junction.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

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

@Composable
fun JunctionTheme(content: @Composable () -> Unit) {
    val colors = if (isSystemInDarkTheme()) DarkColors else LightColors
    MaterialTheme(
        colorScheme = colors,
        typography = JunctionTypography,
        shapes = JunctionShapes,
        content = content
    )
}
