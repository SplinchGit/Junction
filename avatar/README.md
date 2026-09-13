# Junction Avatar module

Animated avatar for Junction's chat screen. Renders a `.glb` (glTF binary)
model via Google Filament, switching between named animation clips for
state, plus occasional cosmetic emotes.

## What's here

- `AvatarState.kt` — states: IDLE, LISTENING, TALKING (looping, driven by
  chat/voice pipeline) + EMOTE_DANCE, EMOTE_BACKFLIP (one-shot flavour).
- `AvatarRenderer.kt` — Filament engine setup, loads the model, plays clips
  with a short crossfade between state changes.
- `EmoteController.kt` — fires a random emote every ~15-45s while idle
  (50% chance per timer tick), or on demand via `fire(state)` from anywhere
  in Junction's chat logic (e.g. after a successful action).
- `AvatarStorage.kt` — enforces app-internal-only storage for any
  user-uploaded model; validates the glTF magic bytes and a 25MB size cap
  before accepting a file. Nothing is ever written to shared/external
  storage or transmitted anywhere.
- `AvatarView.kt` — Compose wrapper, drop into the Chat screen with:

  ```kotlin
  AvatarView(state = if (isTalking) AvatarState.TALKING else AvatarState.IDLE)
  ```

- `assets/models/placeholder_avatar.glb` — a small procedurally-generated
  blob (icosphere) with all 5 clips already wired up, so the pipeline runs
  end-to-end before you drop in a real Blender export. **This is a sphere,
  not a character** — if you're looking at the app wondering where the avatar
  is, the ball is the avatar. Swap in a real model to change that.
- `tools/make_placeholder_glb.py` — regenerates that .glb. The placeholder is
  generated, never hand-edited: `python avatar/tools/make_placeholder_glb.py`.

## Integration steps

1. Add this module to `settings.gradle.kts`:
   ```kotlin
   include(":avatar")
   ```
2. In `app/build.gradle.kts`:
   ```kotlin
   implementation(project(":avatar"))
   ```
3. Drop `AvatarView(state = ...)` into your Chat composable, wired to
   whatever signal you already have for "is Junction currently speaking /
   listening."
4. Confirm you're on `minSdk 26+` (Filament requirement) — check
   `app/build.gradle.kts` against this module's `defaultConfig`.

## Swapping in your real Blender model

1. In Blender, build your rig/actions named exactly: `idle`, `listening`,
   `talking`, `dance`, `backflip` (names must match `AvatarState.clipName`
   values, or update the enum to match yours).
2. Export: `File → Export → glTF 2.0 (.glb)`, format = **glTF Binary
   (.glb)**, check "Include Animations."
3. Either:
   - Replace `assets/models/placeholder_avatar.glb` directly (bundled,
     ships in the APK), or
   - Feed the bytes through `AvatarStorage.importUserModel(context, bytes)`
     if you want this to be a user-facing upload feature — it validates and
     writes to app-internal storage automatically, and `AvatarView` will
     pick it up over the bundled placeholder on next load.

## Status

Verified on-device (Samsung A52s, Adreno 642L, OpenGL ES backend): the module
loads the .glb, renders it in the Chat header, and loops the `idle` clip. The
SwapChain/render path in `setUpFilament()` is fully wired, not boilerplate.

Not yet exercised on-device: the LISTENING/TALKING transitions and the
crossfade between them, because those are driven by live voice/streaming
signals. The code path is implemented; it just hasn't been watched running.

## Gotchas worth keeping in mind

- **Filament does not loop for you.** `Animator.applyAnimation()` clamps past
  the last keyframe, so clip time must be wrapped manually — see
  `AvatarRenderer.clipTime()`. Forgetting this makes any model, placeholder or
  real, play once and freeze.
- **`applyCrossFade` must come after `applyAnimation`.** It blends the previous
  clip into whatever `applyAnimation` just wrote; calling it first means the
  blend is silently overwritten every frame.
- **`setState` is called from Compose's `update` block**, which runs on every
  recomposition. It early-returns when the state is unchanged; without that,
  streaming chat text restarts the clip every frame and the avatar sits at t=0.
- The placeholder's 5 clips are node-transform animations (translate/rotate/
  scale on a single mesh). A real rig will use skeletal/blend-shape animation,
  which gltfio handles identically — no code changes needed.
