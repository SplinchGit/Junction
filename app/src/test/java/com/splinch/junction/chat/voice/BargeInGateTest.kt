package com.splinch.junction.chat.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Cover for interrupting Junction mid-reply.
 *
 * Two failures matter, and they pull in opposite directions: never firing leaves voice
 * half-duplex, where the only way to cut in is the mic button; firing on Junction's own
 * voice coming back through the speaker makes it stop mid-sentence at random, which is
 * far worse. The threshold is therefore measured from playback rather than guessed, and
 * these are the cases that keep it honest.
 */
class BargeInGateTest {

    /** Feed [count] frames at [db] and report whether the gate fired on any of them. */
    private fun BargeInGate.feed(db: Double, count: Int): Boolean {
        var fired = false
        repeat(count) { if (offer(db)) fired = true }
        return fired
    }

    @Test
    fun `nothing fires while the gate is still learning what this device leaks`() {
        val gate = BargeInGate(calibrationFrames = 15, triggerFrames = 3)

        // Calibration frames are Junction's own voice. Firing on them would mean cutting
        // off every reply the instant it started.
        assertFalse(gate.feed(db = -10.0, count = 15))
        assertTrue(gate.isArmed)
    }

    @Test
    fun `Junction's own echo does not interrupt Junction`() {
        val gate = BargeInGate(calibrationFrames = 5, triggerFrames = 3, marginDb = 12.0)
        gate.feed(db = -30.0, count = 5)

        // The rest of the reply leaks back at the same level it calibrated against.
        assertFalse(gate.feed(db = -30.0, count = 500))
    }

    @Test
    fun `a voice over the top of the reply cuts in`() {
        val gate = BargeInGate(calibrationFrames = 5, triggerFrames = 3, marginDb = 12.0)
        gate.feed(db = -30.0, count = 5)

        assertTrue(gate.feed(db = -10.0, count = 3))
    }

    @Test
    fun `the floor is the loudest echo, not the average`() {
        val gate = BargeInGate(
            calibrationFrames = 4,
            triggerFrames = 2,
            marginDb = 10.0,
            absoluteFloorDb = -120.0
        )
        // Speech has gaps between words. Averaging them in would put the bar below
        // Junction's own voice, and it would interrupt itself on its next loud syllable.
        gate.feed(db = -60.0, count = 3)
        gate.offer(-20.0)

        assertEquals(-10.0, gate.thresholdDb, 0.001)
        assertFalse(gate.feed(db = -20.0, count = 50))
    }

    @Test
    fun `a slammed door is not an interruption`() {
        val gate = BargeInGate(calibrationFrames = 5, triggerFrames = 12, marginDb = 12.0)
        gate.feed(db = -30.0, count = 5)

        // Loud, but over in a fraction of the time speech takes. Speech sustains.
        repeat(20) {
            assertFalse(gate.feed(db = -5.0, count = 11))
            assertFalse(gate.feed(db = -60.0, count = 5))
        }
    }

    @Test
    fun `loud frames have to be consecutive`() {
        val gate = BargeInGate(calibrationFrames = 2, triggerFrames = 4, marginDb = 12.0)
        gate.feed(db = -40.0, count = 2)

        repeat(10) {
            gate.feed(db = -10.0, count = 3)
            // A quiet frame resets the run: three loud frames ten times over is a noisy
            // room, not somebody talking.
            assertFalse(gate.offer(-40.0))
        }
    }

    @Test
    fun `a near-perfect echo canceller cannot drag the bar down to room noise`() {
        val gate = BargeInGate(
            calibrationFrames = 5,
            triggerFrames = 3,
            marginDb = 12.0,
            absoluteFloorDb = -38.0
        )
        // A headset leaks almost nothing, so the measured floor is near silence. Without
        // an absolute minimum, ordinary room noise would clear the margin.
        gate.feed(db = -90.0, count = 5)

        assertEquals(-38.0, gate.thresholdDb, 0.001)
        assertFalse(gate.feed(db = -45.0, count = 100))
        assertTrue(gate.feed(db = -20.0, count = 3))
    }

    @Test
    fun `the owner is only reported as cutting in once`() {
        val gate = BargeInGate(calibrationFrames = 2, triggerFrames = 2, marginDb = 12.0)
        gate.feed(db = -40.0, count = 2)

        assertTrue(gate.feed(db = -10.0, count = 2))
        // Playback has already been stopped and the recogniser armed; firing again would
        // restart a turn that is underway.
        assertFalse(gate.feed(db = -10.0, count = 100))
    }

    @Test
    fun `each reply is calibrated afresh`() {
        val gate = BargeInGate(calibrationFrames = 2, triggerFrames = 2, marginDb = 12.0)
        gate.feed(db = -40.0, count = 2)
        assertTrue(gate.feed(db = -10.0, count = 2))

        gate.reset()

        // Volume, room and audio route can all change between one reply and the next --
        // speakerphone to headset is the obvious one.
        assertFalse("calibration starts over", gate.feed(db = -40.0, count = 2))
        assertTrue(gate.isArmed)
        assertTrue("and the previous reply's interruption is not still latched", gate.feed(db = -10.0, count = 2))
    }
}
