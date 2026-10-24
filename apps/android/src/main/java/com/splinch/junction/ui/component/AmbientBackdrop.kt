package com.splinch.junction.ui.component

import android.content.Context
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.splinch.junction.R
import com.splinch.junction.data.preference.AppearancePrefs
import kotlin.math.PI
import kotlin.math.sin
import kotlin.random.Random

/**
 * Optional artwork behind a screen: the scene frames the header and the bottom edge while a
 * scrim keeps the message area calm and readable. Petals are a separate, sparse layer that
 * runs only while the screen is resumed, motion is allowed and power saving is off.
 */
@Composable
fun AmbientBackdrop(appearance: AppearancePrefs, modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    val background = MaterialTheme.colorScheme.background
    val dark = background.luminance() < 0.5f
    Box(modifier.fillMaxSize()) {
        if (appearance.artwork == "sakura-mountain") {
            val intensity = appearance.backgroundIntensity / 100f
            Image(
                painter = painterResource(R.drawable.sakura_mountain),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                alignment = Alignment.TopEnd,
                modifier = Modifier.fillMaxSize().alpha(intensity * if (dark) 0.85f else 0.45f)
            )
            // Heavier in the middle where messages sit; the scene shows at the top and bottom edges.
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(
                0f to background.copy(alpha = 0.30f),
                0.22f to background.copy(alpha = 0.80f),
                0.72f to background.copy(alpha = 0.86f),
                1f to background.copy(alpha = 0.55f)
            )))
            val context = LocalContext.current
            if (appearance.petalsAllowed(systemReducedMotion(context), powerSaving(context))) PetalLayer(appearance.petalIntensity, dark)
        }
        content()
    }
}

private fun systemReducedMotion(context: Context): Boolean =
    runCatching { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false)

private fun powerSaving(context: Context): Boolean =
    runCatching { (context.getSystemService(Context.POWER_SERVICE) as PowerManager).isPowerSaveMode }.getOrDefault(false)

private class Petal(var x: Float, var y: Float, val size: Float, val speed: Float, val drift: Float, val phase: Float, var angle: Float, val spin: Float, val alpha: Float)

@Composable
private fun PetalLayer(intensity: Int, dark: Boolean) {
    val count = 2 + (intensity / 100f * 8).toInt()
    val petals = remember(count) { mutableListOf<Petal>() }
    var frame by remember { mutableLongStateOf(0L) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    // Frames are requested only while resumed; leaving the screen or the app stops them.
    LaunchedEffect(lifecycle, count) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            var last = 0L
            while (true) {
                withFrameMillis { now ->
                    // ~24 fps is plenty for slow petals and leaves the GPU alone.
                    if (now - last >= 41L) {
                        val dt = if (last == 0L) 0f else ((now - last).coerceAtMost(100L)) / 1000f
                        last = now
                        for (petal in petals) {
                            petal.y += petal.speed * dt
                            petal.x += (petal.drift + sin(now / 1600f + petal.phase) * 6f) * dt
                            petal.angle += petal.spin * dt
                        }
                        frame = now
                    }
                }
            }
        }
    }
    val color = if (dark) Color(0xFFECBCCB) else Color(0xFFC97A8F)
    Canvas(Modifier.fillMaxSize()) {
        if (frame < 0L) return@Canvas // reading the frame clock redraws the layer each tick
        if (petals.isEmpty()) repeat(count) { petals += spawn(size, spread = true) }
        for (index in petals.indices) {
            val petal = petals[index]
            if (petal.y > size.height + 20f || petal.x < -20f) petals[index] = spawn(size, spread = false)
            val p = petals[index]
            rotate(degrees = p.angle * 180f / PI.toFloat(), pivot = Offset(p.x, p.y)) {
                drawOval(color.copy(alpha = p.alpha * if (dark) 1f else 0.7f), topLeft = Offset(p.x - p.size, p.y - p.size * 0.55f), size = Size(p.size * 2f, p.size * 1.1f))
            }
        }
    }
}

private fun spawn(area: Size, spread: Boolean): Petal = Petal(
    // From the tree's side, drifting slowly down and left.
    x = area.width * (0.5f + Random.nextFloat() * 0.55f),
    y = if (spread) Random.nextFloat() * area.height else -20f - Random.nextFloat() * area.height * 0.3f,
    size = 6f + Random.nextFloat() * 6f,
    speed = 22f + Random.nextFloat() * 24f,
    drift = -(8f + Random.nextFloat() * 14f),
    phase = Random.nextFloat() * 6.28f,
    angle = Random.nextFloat() * 3.14f,
    spin = (Random.nextFloat() - 0.5f) * 0.6f,
    alpha = 0.28f + Random.nextFloat() * 0.3f
)
