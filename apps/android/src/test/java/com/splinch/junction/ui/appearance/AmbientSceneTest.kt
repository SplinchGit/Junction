package com.splinch.junction.ui.appearance

import com.splinch.junction.R
import com.splinch.junction.data.preference.AppearancePrefs
import com.splinch.junction.ui.component.*
import java.io.File
import javax.imageio.ImageIO
import org.junit.Assert.*
import org.junit.Test

class AmbientSceneTest {
    @Test fun `every selectable scene maps to its packaged image and actual source dimensions`() {
        val assets = mapOf(
            "sakura-mountain" to (R.drawable.sakura_mountain to "sakura_mountain.webp"),
            "sakura-waterfall" to (R.drawable.sakura_waterfall to "sakura_waterfall.jpg"),
            "sakura-airport" to (R.drawable.sakura_airport to "sakura_airport.jpg"),
            "sakura-city" to (R.drawable.sakura_city to "sakura_city.jpg")
        )
        for (id in AppearancePrefs.ARTWORK) {
            val scene = ambientSceneProfile(id)
            if (id == "none") { assertNull(scene); continue }
            requireNotNull(scene)
            val (resource, name) = assets.getValue(id)
            assertEquals(resource, scene.drawableRes)
            // JPEGs are intentionally packaged verbatim; read their headers rather than trust metadata.
            if (name.endsWith(".jpg")) {
                val image = ImageIO.read(File("src/main/res/drawable-nodpi/$name"))
                assertEquals(image.width.toFloat(), scene.sourceWidth, 0f)
                assertEquals(image.height.toFloat(), scene.sourceHeight, 0f)
            } else {
                assertTrue(File("src/main/res/drawable-nodpi/$name").isFile)
                assertEquals(941f, scene.sourceWidth, 0f)
                assertEquals(1672f, scene.sourceHeight, 0f)
            }
        }
        assertNull(ambientSceneProfile("missing"))
    }

    @Test fun `scene effects follow their distinct water lantern and rain features`() {
        val mountain = requireNotNull(ambientSceneProfile("sakura-mountain"))
        val falls = requireNotNull(ambientSceneProfile("sakura-waterfall"))
        val airport = requireNotNull(ambientSceneProfile("sakura-airport"))
        val city = requireNotNull(ambientSceneProfile("sakura-city"))
        assertTrue(mountain.flows.isEmpty() && mountain.glows.isEmpty() && mountain.rain.isEmpty())
        assertEquals(3, falls.flows.size)
        assertEquals(2, falls.glows.size)
        assertTrue(falls.rain.isEmpty())
        assertTrue(airport.flows.isEmpty())
        assertEquals(2, airport.rain.size)
        assertEquals(3, airport.reflections.size)
        assertTrue(airport.glows.isNotEmpty())
        assertEquals(3, city.flows.size)
        assertTrue(city.glows.any { it.color.red > it.color.green })
        assertTrue(city.glows.any { it.color.blue > it.color.red })
        assertTrue(city.rain.isEmpty())
    }

    @Test fun `scene anchors and rain regions stay within the original artwork`() {
        for (id in AppearancePrefs.ARTWORK) {
            val scene = ambientSceneProfile(id) ?: continue
            for (flow in scene.flows) {
                assertTrue(flow.points.size >= 2)
                assertTrue(flow.points.zipWithNext().all { (a, b) -> b.y > a.y })
                flow.points.forEach { assertPointInside(it) }
            }
            scene.glows.forEach { assertPointInside(it.position) }
            for (rain in scene.rain) {
                assertTrue(rain.left >= 0 && rain.top >= 0)
                assertTrue(rain.left + rain.width <= 1f && rain.top + rain.height <= 1f)
            }
            for (reflection in scene.reflections) {
                assertTrue(reflection.x in 0f..1f)
                assertTrue(reflection.top in 0f..reflection.bottom && reflection.bottom <= 1f)
            }
        }
    }

    @Test fun `portrait landscape and tablet transforms preserve the right edge without cropping height`() {
        val source = requireNotNull(ambientSceneProfile("sakura-waterfall"))
        val portrait = sceneViewport(360f, 800f, source)
        assertEquals(0.625f, portrait.scale, 0f)
        assertEquals(0f, portrait.left, 0f)
        assertEquals(800f, portrait.height, 0f)
        val landscape = sceneViewport(800f, 360f, source)
        assertEquals(0.28125f, landscape.scale, 0f)
        assertEquals(638f, landscape.left, 0f)
        val anchor = landscape.map(ScenePoint(0.5f, 0.5f))
        assertEquals(719f, anchor.x, 0.001f)
        assertEquals(180f, anchor.y, 0.001f)
        val tablet = sceneViewport(1280f, 800f, source)
        assertEquals(920f, tablet.left, 0f)
        assertEquals(1280f, tablet.left + tablet.width, 0f)
        // Narrow phones crop only the left edge, using the same transform as FillHeight/TopEnd.
        assertEquals(-90f, sceneViewport(270f, 800f, source).left, 0f)
        assertEquals(0f, sceneViewport(0f, 0f, source).scale, 0f)
        val original = requireNotNull(ambientSceneProfile("sakura-mountain"))
        val oldViewport = sceneViewport(1280f, 836f, original)
        assertEquals(0.5f, oldViewport.scale, 0f)
        assertEquals(809.5f, oldViewport.left, 0f)
    }

    @Test fun `animation pauses for disabled reduced power hidden and unfocused states`() {
        for (artwork in listOf("sakura-mountain", "sakura-waterfall", "sakura-airport", "sakura-city")) {
            val prefs = AppearancePrefs(artwork = artwork)
            assertTrue(prefs.sceneAnimationAllowed(false, false, true, true))
            assertFalse(prefs.sceneAnimationAllowed(true, false, true, true))
            assertFalse(prefs.sceneAnimationAllowed(false, true, true, true))
            assertFalse(prefs.sceneAnimationAllowed(false, false, false, true))
            assertFalse(prefs.sceneAnimationAllowed(false, false, true, false))
            assertFalse(prefs.copy(petals = false).sceneAnimationAllowed(false, false, true, true))
            assertFalse(prefs.copy(petalIntensity = 0).sceneAnimationAllowed(false, false, true, true))
            assertFalse(prefs.copy(motion = "reduced").sceneAnimationAllowed(false, false, true, true))
            assertTrue(prefs.copy(motion = "full").sceneAnimationAllowed(true, false, true, true))
            assertFalse(prefs.copy(motion = "full").sceneAnimationAllowed(true, true, true, true))
        }
        assertFalse(AppearancePrefs().sceneAnimationAllowed(false, false, true, true))
        assertFalse(AppearancePrefs(artwork = "missing").sceneAnimationAllowed(false, false, true, true))
    }

    @Test fun `scene highlights disappear with the photo and animation intensity`() {
        assertEquals(0f, sceneEffectOpacity(0, 100), 0f)
        assertEquals(0f, sceneEffectOpacity(100, 0), 0f)
        assertEquals(0.25f, sceneEffectOpacity(50, 50), 0.001f)
        assertEquals(1f, sceneEffectOpacity(200, 200), 0f)
        assertEquals(0f, sceneEffectOpacity(-5, 40), 0f)
    }

    @Test fun `frame updates never exceed twenty four per second`() {
        assertTrue(sceneFrameDue(0, 1000))
        assertFalse(sceneFrameDue(1000, 1016))
        assertFalse(sceneFrameDue(1000, 1032))
        assertFalse(sceneFrameDue(1000, 1041))
        assertTrue(sceneFrameDue(1000, 1042))
        assertFalse(sceneFrameDue(1000, 990))
    }

    private fun assertPointInside(point: ScenePoint) {
        assertTrue(point.x in 0f..1f && point.y in 0f..1f)
    }
}
