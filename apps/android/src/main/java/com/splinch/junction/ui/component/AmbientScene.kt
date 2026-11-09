package com.splinch.junction.ui.component

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import com.splinch.junction.R

/** Coordinates are fractions of the unchanged source image, never of the screen. */
internal data class ScenePoint(val x: Float, val y: Float)
internal data class SceneFlow(val points: List<ScenePoint>, val width: Float = 1.25f)
internal data class SceneGlow(val position: ScenePoint, val radius: Float, val color: Color)
internal data class SceneRain(val left: Float, val top: Float, val width: Float, val height: Float)
internal data class SceneReflection(val x: Float, val top: Float, val bottom: Float)

internal data class AmbientSceneProfile(
    val drawableRes: Int,
    val sourceWidth: Float,
    val sourceHeight: Float,
    val flows: List<SceneFlow> = emptyList(),
    val glows: List<SceneGlow> = emptyList(),
    val rain: List<SceneRain> = emptyList(),
    val reflections: List<SceneReflection> = emptyList(),
    val maxPetals: Int = 8
)

private val WarmLantern = Color(0xFFFFC98C)
private val CyanLight = Color(0xFF9CDEFF)
private val VioletLight = Color(0xFFD5B0FF)

private val MountainScene = AmbientSceneProfile(R.drawable.sakura_mountain, 941f, 1672f, maxPetals = 10)
private val FallsScene = AmbientSceneProfile(
    R.drawable.sakura_waterfall, 576f, 1280f,
    flows = listOf(
        SceneFlow(listOf(ScenePoint(.916f, .658f), ScenePoint(.895f, .679f), ScenePoint(.882f, .715f), ScenePoint(.871f, .754f), ScenePoint(.849f, .774f))),
        SceneFlow(listOf(ScenePoint(.797f, .815f), ScenePoint(.779f, .829f), ScenePoint(.766f, .845f))),
        SceneFlow(listOf(ScenePoint(.665f, .867f), ScenePoint(.635f, .896f), ScenePoint(.617f, .936f), ScenePoint(.592f, .970f)), 1.5f)
    ),
    glows = listOf(
        SceneGlow(ScenePoint(.772f, .563f), 18f, WarmLantern),
        SceneGlow(ScenePoint(.960f, .548f), 17f, WarmLantern)
    )
)
private val AirportScene = AmbientSceneProfile(
    R.drawable.sakura_airport, 576f, 1280f,
    glows = listOf(
        SceneGlow(ScenePoint(.876f, .276f), 24f, CyanLight),
        SceneGlow(ScenePoint(.737f, .359f), 20f, CyanLight),
        SceneGlow(ScenePoint(.607f, .603f), 18f, CyanLight),
        SceneGlow(ScenePoint(.285f, .646f), 14f, CyanLight),
        SceneGlow(ScenePoint(.526f, .634f), 15f, CyanLight),
        SceneGlow(ScenePoint(.967f, .587f), 32f, WarmLantern),
        SceneGlow(ScenePoint(.908f, .711f), 22f, WarmLantern)
    ),
    rain = listOf(SceneRain(.08f, .625f, .66f, .31f), SceneRain(.56f, .42f, .20f, .23f)),
    reflections = listOf(SceneReflection(.284f, .666f, .790f), SceneReflection(.526f, .668f, .818f), SceneReflection(.608f, .670f, .852f)),
    maxPetals = 5
)
private val CityScene = AmbientSceneProfile(
    R.drawable.sakura_city, 576f, 1280f,
    flows = listOf(
        SceneFlow(listOf(ScenePoint(.834f, .468f), ScenePoint(.825f, .493f), ScenePoint(.803f, .526f), ScenePoint(.780f, .566f), ScenePoint(.764f, .579f))),
        SceneFlow(listOf(ScenePoint(.766f, .608f), ScenePoint(.742f, .644f), ScenePoint(.718f, .679f), ScenePoint(.686f, .708f))),
        SceneFlow(listOf(ScenePoint(.894f, .687f), ScenePoint(.867f, .703f), ScenePoint(.840f, .730f), ScenePoint(.805f, .755f)))
    ),
    glows = listOf(
        SceneGlow(ScenePoint(.866f, .394f), 26f, CyanLight),
        SceneGlow(ScenePoint(.950f, .281f), 42f, VioletLight),
        SceneGlow(ScenePoint(.876f, .309f), 24f, CyanLight),
        SceneGlow(ScenePoint(.777f, .502f), 22f, VioletLight),
        SceneGlow(ScenePoint(.962f, .624f), 28f, WarmLantern),
        SceneGlow(ScenePoint(.660f, .823f), 19f, WarmLantern)
    ),
    maxPetals = 7
)

internal fun ambientSceneProfile(artwork: String): AmbientSceneProfile? = when (artwork) {
    "sakura-mountain" -> MountainScene
    "sakura-waterfall" -> FallsScene
    "sakura-airport" -> AirportScene
    "sakura-city" -> CityScene
    else -> null
}

/** Exactly matches Image(ContentScale.FillHeight, Alignment.TopEnd). The caller clips to its box. */
internal data class SceneViewport(val left: Float, val top: Float, val scale: Float, val width: Float, val height: Float) {
    fun map(point: ScenePoint): Offset = Offset(left + point.x * width, top + point.y * height)
}

internal fun sceneViewport(width: Float, height: Float, scene: AmbientSceneProfile): SceneViewport {
    if (width <= 0f || height <= 0f || !width.isFinite() || !height.isFinite()) return SceneViewport(0f, 0f, 0f, 0f, 0f)
    val scale = height / scene.sourceHeight
    val imageWidth = scene.sourceWidth * scale
    return SceneViewport(width - imageWidth, 0f, scale, imageWidth, height)
}

internal fun sceneEffectOpacity(backgroundIntensity: Int, animationIntensity: Int): Float =
    backgroundIntensity.coerceIn(0, 100) / 100f * (animationIntensity.coerceIn(0, 100) / 100f)

// Round up from 1000/24: no source-mapped effect can invalidate the canvas above 24 fps.
internal fun sceneFrameDue(previousMillis: Long, nowMillis: Long): Boolean =
    previousMillis == 0L || nowMillis - previousMillis >= 42L

internal fun SceneFlow.pointAt(progress: Float): ScenePoint {
    val at = progress.coerceIn(0f, 1f) * (points.size - 1)
    val index = at.toInt().coerceAtMost(points.lastIndex - 1)
    val local = at - index
    val from = points[index]
    val to = points[index + 1]
    return ScenePoint(from.x + (to.x - from.x) * local, from.y + (to.y - from.y) * local)
}
