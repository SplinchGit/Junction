package com.junction.avatar

/**
 * Core states the avatar can be in. These map 1:1 to animation clip names
 * inside the loaded .glb (see AvatarRenderer.CLIP_* constants).
 *
 * Core states are driven by Junction's actual chat/voice pipeline.
 * Emote states are cosmetic flavour, never tied to app logic.
 */
enum class AvatarState(val clipName: String, val loop: Boolean) {
    IDLE("idle", loop = true),
    LISTENING("listening", loop = true),
    TALKING("talking", loop = true),

    // Emotes: one-shot, non-looping, always return to IDLE afterwards.
    EMOTE_DANCE("dance", loop = false),
    EMOTE_BACKFLIP("backflip", loop = false),
}
