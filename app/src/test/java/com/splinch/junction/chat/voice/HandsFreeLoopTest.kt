package com.splinch.junction.chat.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Regression cover for the "mic says on, Junction has gone deaf" bug.
 *
 * SpeechRecognizer is single-shot, so without a re-arm policy the owner got exactly
 * one sentence per tap while the UI kept showing a live mic.
 */
class HandsFreeLoopTest {

    @Test
    fun `nothing is re-armed until the owner turns the mic on`() {
        val loop = HandsFreeLoop()

        assertFalse(loop.isActive)
        assertEquals(HandsFreeLoop.Decision.Idle, loop.onSilentTurn())
        assertEquals(HandsFreeLoop.Decision.Idle, loop.onReplyFinished())
        assertEquals(HandsFreeLoop.Decision.Idle, loop.onSpeechHeard())
    }

    @Test
    fun `hearing speech does not re-arm, so the recogniser never hears Junction reply`() {
        val loop = HandsFreeLoop()
        loop.start()

        // Re-arming here would put the mic live while TTS is speaking, and Junction
        // would transcribe itself and answer its own reply.
        assertEquals(HandsFreeLoop.Decision.Idle, loop.onSpeechHeard())
        assertTrue("the loop is still live, just waiting for the reply", loop.isActive)
    }

    @Test
    fun `the mic comes back the moment the reply finishes`() {
        val loop = HandsFreeLoop()
        loop.start()
        loop.onSpeechHeard()

        assertEquals(HandsFreeLoop.Decision.ReArmNow, loop.onReplyFinished())
    }

    @Test
    fun `a silent turn re-arms after a pause rather than spinning`() {
        val loop = HandsFreeLoop()
        loop.start()

        val decision = loop.onSilentTurn()

        assertTrue(decision is HandsFreeLoop.Decision.ReArmAfter)
        assertTrue(
            "a zero delay would be a hot loop on a broken recogniser",
            (decision as HandsFreeLoop.Decision.ReArmAfter).delayMillis > 0
        )
    }

    @Test
    fun `sustained silence gives up instead of listening forever`() {
        val loop = HandsFreeLoop(maxSilentTurns = 3)
        loop.start()

        assertTrue(loop.onSilentTurn() is HandsFreeLoop.Decision.ReArmAfter)
        assertTrue(loop.onSilentTurn() is HandsFreeLoop.Decision.ReArmAfter)
        assertEquals(HandsFreeLoop.Decision.GiveUp, loop.onSilentTurn())
        assertFalse("giving up must stand the loop down", loop.isActive)
    }

    @Test
    fun `a real utterance resets the silence budget`() {
        val loop = HandsFreeLoop(maxSilentTurns = 3)
        loop.start()

        loop.onSilentTurn()
        loop.onSilentTurn()
        // The owner said something: a long pause earlier must not end the next one.
        loop.onSpeechHeard()
        loop.onReplyFinished()

        assertTrue(loop.onSilentTurn() is HandsFreeLoop.Decision.ReArmAfter)
        assertTrue(loop.onSilentTurn() is HandsFreeLoop.Decision.ReArmAfter)
        assertEquals(HandsFreeLoop.Decision.GiveUp, loop.onSilentTurn())
    }

    @Test
    fun `an unrecoverable error never retries`() {
        val loop = HandsFreeLoop()
        loop.start()

        // Missing microphone permission will fail identically every time; retrying
        // burns battery and floods the log without ever succeeding.
        assertEquals(HandsFreeLoop.Decision.Idle, loop.onFatalError())
        assertFalse(loop.isActive)
        assertEquals(HandsFreeLoop.Decision.Idle, loop.onReplyFinished())
    }

    @Test
    fun `muting stops the loop and a later reply does not revive it`() {
        val loop = HandsFreeLoop()
        loop.start()
        loop.onSpeechHeard()

        loop.stop()

        // A reply still in flight when the owner muted must not switch the mic back on.
        assertEquals(HandsFreeLoop.Decision.Idle, loop.onReplyFinished())
        assertFalse(loop.isActive)
    }

    @Test
    fun `a call is never ended by silence, however long it lasts`() {
        val loop = HandsFreeLoop(maxSilentTurns = 3)
        loop.start(HandsFreeLoop.Mode.CALL)

        // Far past the hands-free budget. On a call the owner is entitled to think,
        // read, or just listen without Junction hanging up on them.
        repeat(50) {
            assertTrue(
                "a call must stay open through silence",
                loop.onSilentTurn() is HandsFreeLoop.Decision.ReArmAfter
            )
        }
        assertTrue("the line is still open", loop.isActive)
    }

    @Test
    fun `call silence backs off to a ceiling instead of re-arming at full tilt`() {
        val loop = HandsFreeLoop()
        loop.start(HandsFreeLoop.Mode.CALL)

        val first = (loop.onSilentTurn() as HandsFreeLoop.Decision.ReArmAfter).delayMillis
        val second = (loop.onSilentTurn() as HandsFreeLoop.Decision.ReArmAfter).delayMillis
        assertTrue("a dead recogniser must not be retried at a fixed hot rate", second > first)

        // A permanently silent line must not drift into minute-long gaps, or the owner
        // speaking up would go unheard.
        repeat(200) { loop.onSilentTurn() }
        val settled = (loop.onSilentTurn() as HandsFreeLoop.Decision.ReArmAfter).delayMillis
        assertEquals(HandsFreeLoop.CALL_MAX_RETRY_DELAY_MS, settled)
    }

    @Test
    fun `a call still ends on an unrecoverable failure`() {
        val loop = HandsFreeLoop()
        loop.start(HandsFreeLoop.Mode.CALL)

        // Staying "open" without a microphone would be the deaf-but-lit bug again,
        // just dressed as a call.
        assertEquals(HandsFreeLoop.Decision.Idle, loop.onFatalError())
        assertFalse(loop.isActive)
    }

    @Test
    fun `hanging up ends the call and a reply in flight does not revive it`() {
        val loop = HandsFreeLoop()
        loop.start(HandsFreeLoop.Mode.CALL)
        loop.onSpeechHeard()

        loop.stop()

        assertEquals(HandsFreeLoop.Decision.Idle, loop.onReplyFinished())
        assertFalse(loop.isActive)
    }

    @Test
    fun `turn-taking is unchanged on a call`() {
        val loop = HandsFreeLoop()
        loop.start(HandsFreeLoop.Mode.CALL)

        // The recogniser still must not be live while Junction is speaking, or it
        // transcribes its own voice and answers itself.
        assertEquals(HandsFreeLoop.Decision.Idle, loop.onSpeechHeard())
        assertEquals(HandsFreeLoop.Decision.ReArmNow, loop.onReplyFinished())
    }

    @Test
    fun `a plain start is still hands-free, so silence stands the mic down`() {
        val loop = HandsFreeLoop(maxSilentTurns = 2)
        loop.start()

        assertEquals(HandsFreeLoop.Mode.HANDS_FREE, loop.mode)
        loop.onSilentTurn()
        assertEquals(HandsFreeLoop.Decision.GiveUp, loop.onSilentTurn())
    }

    @Test
    fun `restarting after giving up starts from a clean budget`() {
        val loop = HandsFreeLoop(maxSilentTurns = 2)
        loop.start()
        loop.onSilentTurn()
        assertEquals(HandsFreeLoop.Decision.GiveUp, loop.onSilentTurn())

        loop.start()

        assertTrue(loop.isActive)
        assertTrue(loop.onSilentTurn() is HandsFreeLoop.Decision.ReArmAfter)
    }
}
