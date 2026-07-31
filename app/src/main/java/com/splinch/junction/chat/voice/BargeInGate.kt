package com.splinch.junction.chat.voice

/**
 * Decides, from microphone loudness alone, whether the owner has cut in while Junction is
 * speaking.
 *
 * On a real call you interrupt. Junction's turn-taking was strictly half-duplex -- the
 * recogniser is deliberately not armed during playback, because it would transcribe
 * Junction's own voice and answer itself -- so the only way to stop a reply you had
 * already heard enough of was to reach for the mic button. That is the difference between
 * a call and a walkie-talkie.
 *
 * The problem with listening during playback is that the microphone hears the speaker.
 * Echo cancellation removes most of it (see [BargeInDetector], which refuses to run
 * without it), but never all, so a fixed threshold either misses quiet interruptions or
 * fires on Junction's own voice -- and a false trigger is much the worse failure: Junction
 * would cut itself off mid-sentence, repeatedly, for no reason.
 *
 * So the threshold is measured rather than guessed. The first [calibrationFrames] of
 * playback are Junction's own voice arriving back through the mic, which makes them a
 * per-device, per-route sample of exactly what leaks through: speakerphone in a hard room
 * leaks a lot, a headset almost nothing. The loudest of those frames becomes the floor,
 * and a real interruption has to beat it by [marginDb] for [triggerFrames] in a row.
 * Sustained, because a door slam or a keyboard is louder than speech but far shorter.
 *
 * Pure: takes frame loudness in dBFS and returns a decision, so the policy is unit tested
 * instead of guessed at from a phone.
 */
class BargeInGate(
    private val calibrationFrames: Int = DEFAULT_CALIBRATION_FRAMES,
    private val triggerFrames: Int = DEFAULT_TRIGGER_FRAMES,
    private val marginDb: Double = DEFAULT_MARGIN_DB,
    private val absoluteFloorDb: Double = DEFAULT_ABSOLUTE_FLOOR_DB
) {

    private var framesSeen = 0
    private var echoFloorDb = SILENCE_DB
    private var consecutiveLoudFrames = 0
    private var fired = false

    /** Loudness that must be beaten to count as an interruption; for tracing and tests. */
    val thresholdDb: Double
        get() = maxOf(echoFloorDb + marginDb, absoluteFloorDb)

    /** True once calibration is done and the gate is actually able to fire. */
    val isArmed: Boolean
        get() = framesSeen >= calibrationFrames

    /** Start a fresh reply: the route, the volume and the room may all have changed. */
    fun reset() {
        framesSeen = 0
        echoFloorDb = SILENCE_DB
        consecutiveLoudFrames = 0
        fired = false
    }

    /**
     * Offer one frame of microphone loudness in dBFS (0 dB is full scale, so values are
     * negative). Returns true exactly once, on the frame where the owner has clearly cut
     * in; the caller stops playback and re-arms the recogniser.
     */
    fun offer(frameDb: Double): Boolean {
        if (fired) return false

        if (framesSeen < calibrationFrames) {
            framesSeen++
            // The loudest leaked frame, not the average: an average is dragged down by the
            // gaps between words and would put the bar under Junction's own voice.
            echoFloorDb = maxOf(echoFloorDb, frameDb)
            return false
        }

        if (frameDb < thresholdDb) {
            consecutiveLoudFrames = 0
            return false
        }

        consecutiveLoudFrames++
        if (consecutiveLoudFrames < triggerFrames) return false

        fired = true
        return true
    }

    companion object {
        /** At 20 ms a frame, 300 ms of playback to learn what this device leaks back. */
        const val DEFAULT_CALIBRATION_FRAMES = 15

        /** 240 ms of sustained speech: long enough to exclude a slam, short enough to feel instant. */
        const val DEFAULT_TRIGGER_FRAMES = 12

        /** How far above the leaked echo a voice has to be. Roughly four times the power. */
        const val DEFAULT_MARGIN_DB = 12.0

        /**
         * A hard minimum regardless of what calibration measured. Without it, a silent room
         * with a near-perfect echo canceller sets the floor so low that ordinary room noise
         * clears the margin and Junction interrupts itself.
         */
        const val DEFAULT_ABSOLUTE_FLOOR_DB = -38.0

        /** Stand-in for "nothing heard yet"; below the quietest frame any mic reports. */
        const val SILENCE_DB = -120.0
    }
}
