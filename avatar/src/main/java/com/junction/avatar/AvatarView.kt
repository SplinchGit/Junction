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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
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
    /** Fixed square size. Pass null to fill whatever [modifier] sizes it to. */
    sizeDp: Int? = null,
    /** Background the avatar is drawn against — pass the host screen's surface colour. */
    backgroundColor: Color = Color(0xFF121212),
) {
    val context = LocalContext.current
    var renderer by remember { mutableStateOf<AvatarRenderer?>(null) }
    var emoteController by remember { mutableStateOf<EmoteController?>(null) }
    // Must survive recomposition, so it needs to be the remembered *holder*,
    // not a local var seeded from remember { } — assigning to that is discarded
    // on the next recomposition and the emote gate never sees a state change.
    val lastNonEmoteState = remember { mutableStateOf(AvatarState.IDLE) }

    AndroidView(
        modifier = if (sizeDp != null) modifier.size(sizeDp.dp) else modifier,
        factory = { ctx ->
            val surfaceView = SurfaceView(ctx)
            val r = AvatarRenderer(ctx, surfaceView, backgroundColor.toArgb())
            renderer = r
            r.startRenderLoop()

            val modelFile = if (AvatarStorage.hasCustomModel(ctx)) {
                AvatarStorage.activeModelFile(ctx)
            } else {
                // Copy bundled placeholder out of assets into a temp file Filament can read.
                // Always overwrite: a stale cache from a previous install would
                // otherwise shadow an updated placeholder forever. It's ~24KB.
                val tmp = File(ctx.cacheDir, "placeholder_avatar.glb")
                ctx.assets.open(AvatarStorage.bundledPlaceholder()).use { input ->
                    tmp.outputStream().use { output -> input.copyTo(output) }
                }
                tmp
            }
            r.loadModel(modelFile)

            val ec = EmoteController(r, isCurrentlyIdle = { lastNonEmoteState.value == AvatarState.IDLE })
            ec.start()
            emoteController = ec

            surfaceView
        },
        update = {
            if (state.loop) lastNonEmoteState.value = state
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
