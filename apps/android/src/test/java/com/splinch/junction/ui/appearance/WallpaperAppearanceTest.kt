package com.splinch.junction.ui.appearance

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import com.splinch.junction.data.preference.AppearancePrefs
import com.splinch.junction.ui.theme.junctionColorScheme
import org.junit.Assert.*
import org.junit.Test

class WallpaperAppearanceTest {
    @Test fun `supplied wallpapers survive preference normalization independently of palettes`() {
        for (wallpaper in listOf("sakura-waterfall", "sakura-airport", "sakura-city")) {
            for (palette in listOf("lavender", "peach", "mint", "sky", "butter")) {
                val saved = AppearancePrefs(artwork = wallpaper, palette = palette, petals = false, petalIntensity = 71)
                assertEquals(saved, saved.normalized())
            }
        }
    }

    @Test fun `old preferences retain defaults and invalid values still recover`() {
        assertEquals(AppearancePrefs(), AppearancePrefs().normalized())
        assertEquals("sakura-mountain", AppearancePrefs(artwork = "sakura-mountain").normalized().artwork)
        assertEquals("none", AppearancePrefs(artwork = "missing").normalized().artwork)
        assertEquals("junction", AppearancePrefs(palette = "missing").normalized().palette)
        assertEquals(0, AppearancePrefs(petalIntensity = -9).normalized().petalIntensity)
        assertEquals(100, AppearancePrefs(backgroundIntensity = 210).normalized().backgroundIntensity)
    }

    @Test fun `each pastel palette has its own accent in both modes`() {
        for (dark in listOf(false, true)) {
            val schemes = listOf("junction", "sakura", "moss", "lavender", "peach", "mint", "sky", "butter")
                .map { junctionColorScheme(it, dark) }
            assertEquals(8, schemes.map { it.primary }.toSet().size)
        }
    }

    @Test fun `pastel text and controls meet normal text contrast in light and dark modes`() {
        for (palette in listOf("lavender", "peach", "mint", "sky", "butter")) {
            for (dark in listOf(false, true)) {
                val scheme = junctionColorScheme(palette, dark)
                val textPairs = listOf(
                    scheme.onPrimary to scheme.primary,
                    scheme.onPrimaryContainer to scheme.primaryContainer,
                    scheme.onSecondary to scheme.secondary,
                    scheme.onSecondaryContainer to scheme.secondaryContainer,
                    scheme.onBackground to scheme.background,
                    scheme.onSurface to scheme.surface,
                    scheme.onSurfaceVariant to scheme.surfaceVariant,
                    scheme.onSurface to scheme.surfaceContainerHigh,
                    scheme.onSurface to scheme.surfaceContainerHighest
                )
                for ((foreground, background) in textPairs) {
                    assertTrue("$palette dark=$dark text contrast ${contrast(foreground, background)}", contrast(foreground, background) >= 4.5f)
                }
            }
        }
    }

    private fun contrast(a: Color, b: Color): Float {
        val first = a.luminance()
        val second = b.luminance()
        return (maxOf(first, second) + 0.05f) / (minOf(first, second) + 0.05f)
    }
}
