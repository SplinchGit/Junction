package com.junction.avatar

import android.content.Context
import android.view.Choreographer
import android.view.SurfaceView
import com.google.android.filament.Engine
import com.google.android.filament.EntityManager
import com.google.android.filament.LightManager
import com.google.android.filament.Renderer
import com.google.android.filament.Scene
import com.google.android.filament.Skybox
import com.google.android.filament.SwapChain
import com.google.android.filament.View
import com.google.android.filament.Viewport
import com.google.android.filament.android.DisplayHelper
import com.google.android.filament.android.UiHelper
import com.google.android.filament.gltfio.Animator
import com.google.android.filament.gltfio.AssetLoader
import com.google.android.filament.gltfio.FilamentAsset
import com.google.android.filament.gltfio.Gltfio
import com.google.android.filament.gltfio.ResourceLoader
import com.google.android.filament.gltfio.UbershaderProvider
import java.io.File
import java.nio.ByteBuffer
import kotlin.math.atan
import kotlin.math.tan

/**
 * Owns the Filament engine, loads a .glb, and plays named animation clips
 * with a simple crossfade so state changes don't look like a hard cut.
 *
 * This class only ever reads mesh + animation data from the supplied file
 * and draws it. It has no reference to and no access to any other Junction
 * subsystem (wallet, RPC, chat state) — render-only, one-way.
 */
class AvatarRenderer(
    private val context: Context,
    private val surfaceView: SurfaceView,
    /**
     * sRGB background the avatar is drawn against, as 0xAARRGGBB. Defaults to
     * a dark surface; pass the host screen's actual background so the view
     * blends in rather than reading as a grey tile.
     */
    private val backgroundSrgb: Int = 0xFF121212.toInt(),
) {
    private val engine: Engine = Engine.create()
    private val filamentScene: Scene = engine.createScene()
    private val view: View = engine.createView()
    private val camera = engine.createCamera(EntityManager.get().create())
    private val uiHelper = UiHelper(UiHelper.ContextErrorPolicy.DONT_CHECK)
    private val displayHelper = DisplayHelper(context)
    private val renderer: Renderer = engine.createRenderer()
    private var swapChain: SwapChain? = null

    private val assetLoader = AssetLoader(engine, UbershaderProvider(engine), EntityManager.get())
    private val resourceLoader = ResourceLoader(engine)

    private var asset: FilamentAsset? = null
    private var animator: Animator? = null

    private var currentClipIndex = -1
    private var currentState: AvatarState = AvatarState.IDLE
    private var currentClipStart = 0L

    // Previous clip, kept alive for the length of a crossfade so the outgoing
    // pose keeps advancing instead of freezing at the moment of the switch.
    private var crossfadeFrom: Int = -1
    private var crossfadeFromStart = 0L
    private var crossfadeStart = 0L
    private val crossfadeDurationMs = 250L

    private var pendingEmoteReturn: AvatarState? = null

    // Framing is derived from the loaded model's bounds rather than hardcoded,
    // so an arbitrary Blender export lands in shot whatever scale it was
    // authored at (Blender's default metres vs. centimetres alone is a 100x
    // difference, and a hardcoded camera would show nothing).
    private var modelCenter = floatArrayOf(0f, 0f, 0f)
    private var modelHalfExtent = floatArrayOf(1f, 1f, 1f)
    private var viewWidth = 0
    private var viewHeight = 0

    private val choreographer = Choreographer.getInstance()
    private val frameCallback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            renderFrame(frameTimeNanos)
            choreographer.postFrameCallback(this)
        }
    }

    init {
        setUpFilament()
    }

    private fun setUpFilament() {
        uiHelper.renderCallback = object : UiHelper.RendererCallback {
            override fun onNativeWindowChanged(surface: android.view.Surface?) {
                swapChain?.let { engine.destroySwapChain(it) }
                swapChain = surface?.let { engine.createSwapChain(it) }
                displayHelper.attach(renderer, surfaceView.display)
            }

            override fun onDetachedFromSurface() {
                displayHelper.detach()
                swapChain?.let {
                    engine.destroySwapChain(it)
                    engine.flushAndWait()
                    swapChain = null
                }
            }

            override fun onResized(width: Int, height: Int) {
                view.viewport = Viewport(0, 0, width, height)
                viewWidth = width
                viewHeight = height
                val aspect = width.toDouble() / height.toDouble()
                camera.setProjection(FOV_DEGREES, aspect, 0.05, 1000.0, com.google.android.filament.Camera.Fov.VERTICAL)
                frameModel()
            }
        }
        uiHelper.attachTo(surfaceView)

        // Filament works in linear space; Android colours are sRGB.
        filamentScene.skybox = Skybox.Builder()
            .color(
                srgbToLinear((backgroundSrgb shr 16) and 0xFF),
                srgbToLinear((backgroundSrgb shr 8) and 0xFF),
                srgbToLinear(backgroundSrgb and 0xFF),
                1.0f,
            )
            .build(engine)
        view.scene = filamentScene
        view.camera = camera

        val light = EntityManager.get().create()
        LightManager.Builder(LightManager.Type.DIRECTIONAL)
            .color(1.0f, 1.0f, 1.0f)
            .intensity(110_000.0f)
            .direction(-0.5f, -1.0f, -0.3f)
            .castShadows(false)
            .build(engine, light)
        filamentScene.addEntity(light)

        frameModel()
    }

    /**
     * Pulls the camera back far enough to fit the model's bounding *box*, so
     * any export frames correctly regardless of the scale it was authored at.
     *
     * Fitting the bounding sphere instead would be simpler but framing a tall
     * narrow character in a portrait viewport would then waste most of the
     * frame — the sphere's radius is set by the diagonal, not the silhouette.
     */
    private fun frameModel() {
        if (viewWidth <= 0 || viewHeight <= 0) return

        val vFov = Math.toRadians(FOV_DEGREES)
        val aspect = viewWidth.toDouble() / viewHeight.toDouble()
        val hFov = 2.0 * atan(tan(vFov / 2.0) * aspect)

        val halfW = modelHalfExtent[0].toDouble().coerceAtLeast(1e-4)
        val halfH = modelHalfExtent[1].toDouble().coerceAtLeast(1e-4)
        val halfD = modelHalfExtent[2].toDouble()

        // Whichever axis needs more room decides; then back off by the model's
        // own depth so its nearest point can't end up behind the camera.
        val distance = maxOf(
            halfH / tan(vFov / 2.0),
            halfW / tan(hFov / 2.0),
        ) * FRAMING_MARGIN + halfD

        val cx = modelCenter[0].toDouble()
        val cy = modelCenter[1].toDouble()
        val cz = modelCenter[2].toDouble()
        camera.lookAt(cx, cy, cz + distance, cx, cy, cz, 0.0, 1.0, 0.0)
    }

    /**
     * Loads a .glb from app-internal storage only. Never from external/shared
     * storage — see AvatarStorage for the enforced write location.
     */
    fun loadModel(glbFile: File) {
        val bytes = glbFile.readBytes()
        val buffer = ByteBuffer.allocateDirect(bytes.size).put(bytes)
        buffer.rewind()

        // Fully release the outgoing model — removing its entities from the
        // scene alone leaks the GPU-side asset on every swap.
        asset?.let {
            filamentScene.removeEntities(it.entities)
            assetLoader.destroyAsset(it)
        }
        animator = null

        asset = assetLoader.createAsset(buffer)
        asset?.let { loaded ->
            resourceLoader.loadResources(loaded)
            loaded.releaseSourceData() // CPU-side glTF copy is dead weight once uploaded
            filamentScene.addEntities(loaded.entities)
            animator = loaded.instance.animator

            val box = loaded.boundingBox
            modelCenter = box.center
            val half = box.halfExtent
            modelHalfExtent = half
            frameModel()
        }

        currentClipIndex = -1
        currentState = AvatarState.IDLE
        setState(AvatarState.IDLE, immediate = true)
    }

    /**
     * Switches the avatar's animation state. Emotes automatically return to
     * IDLE (or whatever was playing before) once they finish one cycle.
     *
     * Safe to call on every recomposition: re-asserting the state that is
     * already playing is a no-op. Without that guard the caller's Compose
     * `update` block restarts the clip on every frame of streaming text, and
     * the avatar sits at t=0 looking frozen.
     */
    fun setState(state: AvatarState, immediate: Boolean = false) {
        val anim = animator ?: return
        if (state == currentState && currentClipIndex >= 0) return

        val clipIndex = findClipIndex(anim, state.clipName)
        if (clipIndex < 0) return // clip not present in this model; ignore silently

        pendingEmoteReturn = if (!state.loop) {
            currentState.takeIf { it.loop } ?: AvatarState.IDLE
        } else {
            null
        }

        val now = System.nanoTime()
        if (!immediate && currentClipIndex >= 0 && currentClipIndex != clipIndex) {
            crossfadeFrom = currentClipIndex
            crossfadeFromStart = currentClipStart
            crossfadeStart = now
        } else {
            crossfadeFrom = -1
        }

        currentState = state
        currentClipIndex = clipIndex
        currentClipStart = now
    }

    private fun srgbToLinear(channel8Bit: Int): Float {
        val c = channel8Bit / 255.0f
        return if (c <= 0.04045f) c / 12.92f else Math.pow(((c + 0.055f) / 1.055f).toDouble(), 2.4).toFloat()
    }

    private fun findClipIndex(anim: Animator, name: String): Int {
        for (i in 0 until anim.animationCount) {
            if (anim.getAnimationName(i) == name) return i
        }
        return -1
    }

    /**
     * Maps wall-clock elapsed time onto a clip's timeline. Filament does not
     * wrap for you — [Animator.applyAnimation] clamps past the last keyframe —
     * so looping clips have to be wrapped here or they play once and freeze.
     */
    private fun clipTime(anim: Animator, clipIndex: Int, startNanos: Long, loop: Boolean, nowNanos: Long): Float {
        val elapsedSec = (nowNanos - startNanos) / 1_000_000_000.0
        val duration = anim.getAnimationDuration(clipIndex)
        if (duration <= 0f) return 0f
        return if (loop) (elapsedSec % duration).toFloat() else elapsedSec.coerceAtMost(duration.toDouble()).toFloat()
    }

    private fun renderFrame(frameTimeNanos: Long) {
        val anim = animator
        if (anim != null && currentClipIndex >= 0) {
            val state = currentState
            val elapsedSec = (frameTimeNanos - currentClipStart) / 1_000_000_000.0

            // Order matters: applyCrossFade blends the *previous* clip into
            // whatever applyAnimation just wrote, so the current clip has to be
            // applied first or the blend is overwritten every frame.
            anim.applyAnimation(
                currentClipIndex,
                clipTime(anim, currentClipIndex, currentClipStart, state.loop, frameTimeNanos),
            )

            if (crossfadeFrom >= 0) {
                val fadeElapsedMs = (frameTimeNanos - crossfadeStart) / 1_000_000
                if (fadeElapsedMs >= crossfadeDurationMs) {
                    crossfadeFrom = -1
                } else {
                    // alpha: 0.0 = fully previous clip, 1.0 = fully current.
                    val alpha = fadeElapsedMs / crossfadeDurationMs.toFloat()
                    anim.applyCrossFade(
                        crossfadeFrom,
                        clipTime(anim, crossfadeFrom, crossfadeFromStart, loop = true, nowNanos = frameTimeNanos),
                        alpha,
                    )
                }
            }

            anim.updateBoneMatrices()

            // Handle non-looping emote finishing -> return to previous state.
            if (!state.loop) {
                val duration = anim.getAnimationDuration(currentClipIndex)
                if (duration > 0f && elapsedSec >= duration) {
                    pendingEmoteReturn?.let { setState(it) }
                }
            }
        }

        val swap = swapChain
        if (swap != null && uiHelper.isReadyToRender) {
            if (renderer.beginFrame(swap, frameTimeNanos)) {
                renderer.render(view)
                renderer.endFrame()
            }
        }
    }

    fun startRenderLoop() {
        choreographer.postFrameCallback(frameCallback)
    }

    fun stopRenderLoop() {
        choreographer.removeFrameCallback(frameCallback)
    }

    fun destroy() {
        stopRenderLoop()
        uiHelper.detach()
        asset?.let { assetLoader.destroyAsset(it) }
        assetLoader.destroy()
        resourceLoader.destroy()
        engine.destroyRenderer(renderer)
        engine.destroy()
    }

    companion object {
        // Engine's native methods live in libfilament-jni.so, and
        // AssetLoader/UbershaderProvider need libgltfio-jni.so. Neither gets
        // loaded automatically -- Gltfio.init() loads both (it calls
        // Filament.init() internally), and unlike Filament's static block,
        // it's a plain method that must be called explicitly.
        init {
            Gltfio.init()
        }

        private const val FOV_DEGREES = 45.0

        // A little breathing room so limbs at full extension (dance, backflip)
        // don't clip the edge of the frame.
        private const val FRAMING_MARGIN = 1.25

        // Keep in sync with AvatarState clip names.
        const val CLIP_IDLE = "idle"
        const val CLIP_LISTENING = "listening"
        const val CLIP_TALKING = "talking"
        const val CLIP_DANCE = "dance"
        const val CLIP_BACKFLIP = "backflip"
    }
}
