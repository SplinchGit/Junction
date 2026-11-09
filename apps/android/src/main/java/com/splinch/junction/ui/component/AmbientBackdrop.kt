package com.splinch.junction.ui.component

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.res.painterResource
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.splinch.junction.data.preference.AppearancePrefs
import kotlin.math.PI
import kotlin.math.sin
import kotlin.random.Random

/** A right-aligned scene, with restrained motion beneath a readable content scrim. */
@Composable
fun AmbientBackdrop(appearance: AppearancePrefs, modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    val background = MaterialTheme.colorScheme.background
    val dark = background.luminance() < 0.5f
    val scene = ambientSceneProfile(appearance.artwork)
    Box(modifier.fillMaxSize().background(background).clipToBounds()) {
        if (scene != null) {
            val intensity = appearance.backgroundIntensity.coerceIn(0, 100) / 100f
            Image(
                painter = painterResource(scene.drawableRes),
                contentDescription = null,
                contentScale = ContentScale.FillHeight,
                alignment = Alignment.TopEnd,
                modifier = Modifier.fillMaxSize().alpha(intensity * if (dark) 0.85f else 0.45f)
            )
            val environment = ambientMotionEnvironment()
            val lifecycle = LocalLifecycleOwner.current.lifecycle
            val lifecycleState by lifecycle.currentStateFlow.collectAsState()
            val focused = LocalWindowInfo.current.isWindowFocused
            if (appearance.sceneAnimationAllowed(
                    environment.reduced, environment.powerSaving,
                    lifecycleState.isAtLeast(Lifecycle.State.RESUMED), focused
                )) {
                AmbientSceneLayer(scene, appearance.petalIntensity, appearance.backgroundIntensity, dark)
            }
            // Even at full photo intensity, dark-mode headers retain a strong contrast floor.
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(
                0f to background.copy(alpha = if (dark) .60f else .32f),
                .22f to background.copy(alpha = if (dark) .76f else .66f),
                .72f to background.copy(alpha = if (dark) .80f else .72f),
                1f to background.copy(alpha = if (dark) .65f else .45f)
            )))
            // On tablets the image stays on the right, fading smoothly behind the conversation.
            Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(
                0f to background.copy(alpha = if (dark) .25f else .34f),
                .58f to background.copy(alpha = .12f),
                1f to background.copy(alpha = 0f)
            )))
        }
        content()
    }
}

private data class MotionEnvironment(val reduced: Boolean, val powerSaving: Boolean)

@Composable
private fun ambientMotionEnvironment(): MotionEnvironment {
    val context = LocalContext.current
    var reduced by remember(context) { mutableStateOf(systemReducedMotion(context)) }
    var saving by remember(context) { mutableStateOf(powerSaving(context)) }
    DisposableEffect(context) {
        // These can change while the chat remains open; neither depends on another UI recomposition.
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) { reduced = systemReducedMotion(context) }
        }
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(receiverContext: Context?, intent: Intent?) { saving = powerSaving(context) }
        }
        runCatching {
            context.contentResolver.registerContentObserver(
                Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, observer
            )
        }
        runCatching {
            ContextCompat.registerReceiver(context, receiver,
                IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED)
        }
        reduced = systemReducedMotion(context)
        saving = powerSaving(context)
        onDispose {
            runCatching { context.contentResolver.unregisterContentObserver(observer) }
            runCatching { context.unregisterReceiver(receiver) }
        }
    }
    return MotionEnvironment(reduced, saving)
}

private fun systemReducedMotion(context: Context): Boolean =
    runCatching { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false)

private fun powerSaving(context: Context): Boolean =
    runCatching { (context.getSystemService(Context.POWER_SERVICE) as PowerManager).isPowerSaveMode }.getOrDefault(false)

private data class PetalSeed(
    val x: Float, val y: Float, val size: Float, val speed: Float, val drift: Float,
    val phase: Float, val angle: Float, val spin: Float, val alpha: Float
)

@Composable
private fun AmbientSceneLayer(scene: AmbientSceneProfile, intensity: Int, photoIntensity: Int, dark: Boolean) {
    val amount = intensity.coerceIn(0, 100) / 100f
    val count = 2 + (amount * (scene.maxPetals - 2)).toInt()
    val petals = remember(scene, count) {
        val random = Random(1906)
        List(count) {
            PetalSeed(
                x = .50f + random.nextFloat() * .55f, y = random.nextFloat(),
                size = scene.sourceWidth * (.0045f + random.nextFloat() * .004f),
                speed = .017f + random.nextFloat() * .018f,
                drift = -(.009f + random.nextFloat() * .015f),
                phase = random.nextFloat() * 6.28f, angle = random.nextFloat() * 180f,
                spin = (random.nextFloat() - .5f) * 24f,
                alpha = .28f + random.nextFloat() * .30f
            )
        }
    }
    var elapsedMillis by remember(scene) { mutableLongStateOf(0L) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle, scene, count) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            var last = 0L
            while (true) {
                withFrameMillis { now ->
                    if (sceneFrameDue(last, now)) {
                        if (last != 0L) elapsedMillis += (now - last).coerceAtMost(100L)
                        last = now
                    }
                }
            }
        }
    }
    val opacity = sceneEffectOpacity(photoIntensity, intensity)
    Canvas(Modifier.fillMaxSize()) {
        val seconds = elapsedMillis / 1000f // Read only in draw, avoiding composition on every frame.
        val viewport = sceneViewport(size.width, size.height, scene)
        if (viewport.scale <= 0f) return@Canvas
        clipRect {
            clipRect(viewport.left, viewport.top, viewport.left + viewport.width, viewport.top + viewport.height) {
                withTransform({
                    translate(viewport.left, viewport.top)
                    scale(viewport.scale, viewport.scale, pivot = Offset.Zero)
                }) {
                    drawSceneHighlights(scene, seconds, opacity, amount)
                    drawScenePetals(scene, petals, seconds, dark)
                }
            }
        }
    }
}

private fun DrawScope.drawSceneHighlights(scene: AmbientSceneProfile, seconds: Float, opacity: Float, amount: Float) {
    if (opacity <= 0f) return
    scene.glows.forEachIndexed { index, glow ->
        val center = Offset(glow.position.x * scene.sourceWidth, glow.position.y * scene.sourceHeight)
        val pulse = .72f + .12f * sin(seconds * .65f + index * 1.7f)
        drawCircle(
            brush = Brush.radialGradient(listOf(
                glow.color.copy(alpha = .32f * opacity * pulse),
                glow.color.copy(alpha = .09f * opacity * pulse), Color.Transparent
            ), center = center, radius = glow.radius),
            radius = glow.radius, center = center
        )
    }
    scene.flows.forEachIndexed { index, flow ->
        repeat(3) { trail ->
            val at = (seconds * .075f + index * .21f + trail / 3f) % 1f
            val path = Path()
            repeat(6) { step ->
                val point = flow.pointAt((at + step * .018f).coerceAtMost(1f))
                val x = point.x * scene.sourceWidth
                val y = point.y * scene.sourceHeight
                if (step == 0) path.moveTo(x, y) else path.lineTo(x, y)
            }
            val fade = sin(at * PI.toFloat()).coerceAtLeast(0f)
            drawPath(path, Color(0xFFB3DFFD).copy(alpha = .42f * opacity * fade), style = Stroke(flow.width, cap = StrokeCap.Round))
        }
    }
    scene.rain.forEachIndexed { regionIndex, rain ->
        val left = rain.left * scene.sourceWidth
        val top = rain.top * scene.sourceHeight
        val width = rain.width * scene.sourceWidth
        val height = rain.height * scene.sourceHeight
        clipRect(left, top, left + width, top + height) {
            repeat(3 + (amount * 7).toInt()) { index ->
                val seed = ((index + 1) * .618034f + regionIndex * .27f) % 1f
                val at = (seed + seconds * .11f) % 1f
                val x = left + ((seed * 1.73f) % 1f) * width
                val y = top + at * height
                drawLine(Color(0xFFBBDAEF).copy(alpha = .18f * opacity),
                    start = Offset(x, y), end = Offset(x - 1.2f, y + 10f), strokeWidth = .65f)
            }
        }
    }
    scene.reflections.forEachIndexed { index, reflection ->
        val x = reflection.x * scene.sourceWidth
        val top = reflection.top * scene.sourceHeight
        val height = (reflection.bottom - reflection.top) * scene.sourceHeight
        repeat(3) { ripple ->
            val at = (seconds * .055f + index * .19f + ripple / 3f) % 1f
            val y = top + at * height
            drawOval(Color(0xFF9CDEFF).copy(alpha = .22f * opacity * sin(at * PI.toFloat())),
                topLeft = Offset(x - 3f, y), size = Size(6f, 1.1f))
        }
    }
}

private fun DrawScope.drawScenePetals(scene: AmbientSceneProfile, petals: List<PetalSeed>, seconds: Float, dark: Boolean) {
    val color = if (dark) Color(0xFFECBCCB) else Color(0xFFC97A8F)
    for (petal in petals) {
        val at = (petal.y + seconds * petal.speed) % 1.06f
        val age = at / petal.speed
        val x = (petal.x + petal.drift * age) * scene.sourceWidth + sin(seconds / 1.6f + petal.phase) * 3f
        val y = (at - .03f) * scene.sourceHeight
        rotate(petal.angle + seconds * petal.spin, pivot = Offset(x, y)) {
            drawOval(color.copy(alpha = petal.alpha * if (dark) 1f else .7f),
                topLeft = Offset(x - petal.size, y - petal.size * .55f),
                size = Size(petal.size * 2f, petal.size * 1.1f))
        }
    }
}
