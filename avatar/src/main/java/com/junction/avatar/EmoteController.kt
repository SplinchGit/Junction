package com.junction.avatar

import android.os.Handler
import android.os.Looper
import kotlin.random.Random

/**
 * Decides when to fire a cosmetic emote on top of the avatar's core state.
 * Purely decorative — never gates or triggers anything else in the app.
 *
 * Two trigger paths:
 *  1. Random idle flavour: while IDLE, occasionally throws in a dance/backflip.
 *  2. Context triggers: call `fire(...)` directly from wherever Junction wants
 *     a reaction (e.g. successful action, funny message, etc).
 */
class EmoteController(
    private val renderer: AvatarRenderer,
    private val isCurrentlyIdle: () -> Boolean,
) {
    private val handler = Handler(Looper.getMainLooper())
    private var running = false

    private val idleEmotes = listOf(AvatarState.EMOTE_DANCE, AvatarState.EMOTE_BACKFLIP)

    // Tune these to taste.
    private val minDelayMs = 15_000L
    private val maxDelayMs = 45_000L
    private val chanceToFire = 0.5 // when the timer fires, 50% chance it actually emotes

    private val scheduleNext = object : Runnable {
        override fun run() {
            if (!running) return
            if (isCurrentlyIdle() && Random.nextDouble() < chanceToFire) {
                fire(idleEmotes.random())
            }
            handler.postDelayed(this, Random.nextLong(minDelayMs, maxDelayMs))
        }
    }

    fun start() {
        if (running) return
        running = true
        handler.postDelayed(scheduleNext, Random.nextLong(minDelayMs, maxDelayMs))
    }

    fun stop() {
        running = false
        handler.removeCallbacksAndMessages(null)
    }

    /** Fire a specific emote immediately, regardless of idle timer. */
    fun fire(emote: AvatarState) {
        require(!emote.loop) { "Only non-looping emote states should be fired via EmoteController" }
        renderer.setState(emote)
    }
}
