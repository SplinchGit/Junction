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
    private var stateStartTime = 0L
    private var crossfadeFrom: Int = -1
    private var crossfadeStart = 0L
    private val crossfadeDurationMs = 250L

    private var pendingEmoteReturn: AvatarState? = null

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
                val aspect = width.toDouble() / height.toDouble()
                camera.setProjection(45.0, aspect, 0.1, 20.0, com.google.android.filament.Camera.Fov.VERTICAL)
            }
        }
        uiHelper.attachTo(surfaceView)

        filamentScene.skybox = Skybox.Builder().color(0.05f, 0.05f, 0.07f, 1.0f).build(engine)
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

        camera.lookAt(0.0, 0.3, 2.2, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0)
    }

    /**
     * Loads a .glb from app-internal storage only. Never from external/shared
     * storage — see AvatarStorage for the enforced write location.
     */
    fun loadModel(glbFile: File) {
        val bytes = glbFile.readBytes()
        val buffer = ByteBuffer.allocateDirect(bytes.size).put(bytes)
        buffer.rewind()

        asset?.let { filamentScene.removeEntities(it.entities) }
        asset = assetLoader.createAsset(buffer)
        asset?.let { loaded ->
            resourceLoader.loadResources(loaded)
            filamentScene.addEntities(loaded.entities)
            animator = loaded.instance.animator
            currentClipIndex = -1
        }
        setState(AvatarState.IDLE, immediate = true)
    }

    /**
     * Switches the avatar's animation state. Emotes automatically return to
     * IDLE (or whatever was playing before) once they finish one cycle.
     */
    fun setState(state: AvatarState, immediate: Boolean = false) {
        val anim = animator ?: return
        val clipIndex = findClipIndex(anim, state.clipName)
        if (clipIndex < 0) return // clip not present in this model; ignore silently

        if (!state.loop) {
            pendingEmoteReturn = currentState.takeIf { it.loop } ?: AvatarState.IDLE
        } else {
            pendingEmoteReturn = null
        }

        currentState = state
        crossfadeFrom = if (immediate) -1 else currentClipIndex
        crossfadeStart = System.nanoTime()
        currentClipIndex = clipIndex
        stateStartTime = System.nanoTime()
    }

    private fun findClipIndex(anim: Animator, name: String): Int {
        for (i in 0 until anim.animationCount) {
            if (anim.getAnimationName(i) == name) return i
        }
        return -1
    }

    private fun renderFrame(frameTimeNanos: Long) {
        val anim = animator
        if (anim != null && currentClipIndex >= 0) {
            val elapsedSec = (frameTimeNanos - stateStartTime) / 1_000_000_000.0

            if (crossfadeFrom >= 0) {
                val fadeElapsedMs = (System.nanoTime() - crossfadeStart) / 1_000_000
                if (fadeElapsedMs >= crossfadeDurationMs) {
                    crossfadeFrom = -1
                } else {
                    val fromElapsed = (frameTimeNanos - crossfadeStart) / 1_000_000_000.0
                    anim.applyCrossFade(crossfadeFrom, fromElapsed.toFloat(), 1f - (fadeElapsedMs / crossfadeDurationMs.toFloat()))
                }
            }

            anim.applyAnimation(currentClipIndex, elapsedSec.toFloat())
            anim.updateBoneMatrices()

            // Handle non-looping emote finishing -> return to previous state.
            val state = currentState
            if (!state.loop) {
                val duration = anim.getAnimationDuration(currentClipIndex)
                if (elapsedSec >= duration) {
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

        // Keep in sync with AvatarState clip names.
        const val CLIP_IDLE = "idle"
        const val CLIP_LISTENING = "listening"
        const val CLIP_TALKING = "talking"
        const val CLIP_DANCE = "dance"
        const val CLIP_BACKFLIP = "backflip"
    }
}
