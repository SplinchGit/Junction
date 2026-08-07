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
  end-to-end before you drop in a real Blender export.

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

## Notes / things to verify once you build this for real

- `AvatarRenderer.renderFrame()` has the animation update logic wired but
  the actual `engine.render(...)` / SwapChain creation is left as standard
  Filament boilerplate (identical across all Filament Android samples) —
  wire that up alongside `onNativeWindowChanged` in `setUpFilament()`.
- Pin the Filament version to whatever's current when you actually build —
  `1.51.5` was the latest stable at time of writing, verify before pulling.
- The placeholder's 5 clips are minimal node-transform animations (scale/
  rotate/bounce on a single mesh) — enough to prove state-switching and
  crossfade work. Your real rig will use skeletal/blend-shape animation,
  which gltfio handles the same way, no code changes needed.
