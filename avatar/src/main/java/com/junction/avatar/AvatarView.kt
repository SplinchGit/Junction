package com.junction.avatar

import android.view.SurfaceView
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import java.io.File

/**
 * Drop-in Composable for the Chat screen. Optional — Chat works fine without
 * it. Pass in the current [AvatarState] and it handles rendering + emotes.
 *
 * Usage:
 *   AvatarView(state = if (isTalking) AvatarState.TALKING else AvatarState.IDLE)
 */
@Composable
fun AvatarView(
    state: AvatarState,
    modifier: Modifier = Modifier,
    sizeDp: Int = 96,
) {
    val context = LocalContext.current
    var renderer by remember { mutableStateOf<AvatarRenderer?>(null) }
    var emoteController by remember { mutableStateOf<EmoteController?>(null) }
    var lastNonEmoteState = remember { AvatarState.IDLE }

    AndroidView(
        modifier = modifier.size(sizeDp.dp),
        factory = { ctx ->
            val surfaceView = SurfaceView(ctx)
            val r = AvatarRenderer(ctx, surfaceView)
            renderer = r
            r.startRenderLoop()

            val modelFile = if (AvatarStorage.hasCustomModel(ctx)) {
                AvatarStorage.activeModelFile(ctx)
            } else {
                // Copy bundled placeholder out of assets into a temp file Filament can read.
                val tmp = File(ctx.cacheDir, "placeholder_avatar.glb")
                if (!tmp.exists()) {
                    ctx.assets.open(AvatarStorage.bundledPlaceholder()).use { input ->
                        tmp.outputStream().use { output -> input.copyTo(output) }
                    }
                }
                tmp
            }
            r.loadModel(modelFile)

            val ec = EmoteController(r, isCurrentlyIdle = { lastNonEmoteState == AvatarState.IDLE })
            ec.start()
            emoteController = ec

            surfaceView
        },
        update = {
            if (state.loop) lastNonEmoteState = state
            renderer?.setState(state)
        },
    )

    DisposableEffect(Unit) {
        onDispose {
            emoteController?.stop()
            renderer?.destroy()
        }
    }
}
