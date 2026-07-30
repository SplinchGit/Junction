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
