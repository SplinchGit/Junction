package com.splinch.junction.chat.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Regression cover for a call that goes dead without saying so.
 *
 * The microphone only ever came back because a spoken reply finished, so every other way
 * a turn can end -- a provider error, tool calls and no reply, a plan waiting on approval,
 * an engine that never fires its completion callback -- stranded the line with the mic
 * chip still lit. This is the backstop that ends the turn anyway.
 */
class CallFloorTest {

    @Test
    fun `nobody holds the floor to begin with, and nothing is overdue`() {
        val floor = CallFloor()

        assertEquals(CallFloor.Holder.NOBODY, floor.holder)
        assertFalse(floor.takeOverrun(Long.MAX_VALUE))
    }

    @Test
    fun `a reply that never arrives hands the line back`() {
        val floor = CallFloor(thinkingBudgetMillis = 1_000)
        floor.junctionThinking(0)

        assertFalse("the model is entitled to think", floor.takeOverrun(999))
        assertTrue(floor.takeOverrun(1_000))
    }

    @Test
    fun `a turn is recovered once, not on every tick`() {
        val floor = CallFloor(thinkingBudgetMillis = 1_000)
        floor.junctionThinking(0)

        assertTrue(floor.takeOverrun(5_000))
        // A caller polling once a second would otherwise re-arm the recogniser every
        // second for the rest of the call.
        assertFalse(floor.takeOverrun(6_000))
        assertEquals(CallFloor.Holder.NOBODY, floor.holder)
    }

    @Test
    fun `a long reply gets proportionally longer to say`() {
        val floor = CallFloor(millisPerChar = 100, speechGraceMillis = 1_000)
        floor.junctionSpeaking(0, replyChars = 100)

        // Cutting a reply off mid-sentence to "recover" a turn that was going fine is a
        // worse bug than the one this exists to fix.
        assertFalse(floor.takeOverrun(10_999))
        assertTrue(floor.takeOverrun(11_000))
    }

    @Test
    fun `the grace period covers synthesis before a single word is audible`() {
        val floor = CallFloor(millisPerChar = 0, speechGraceMillis = 5_000)
        floor.junctionSpeaking(0, replyChars = 0)

        assertFalse("cloud synthesis happens before playback starts", floor.takeOverrun(4_999))
        assertTrue(floor.takeOverrun(5_000))
    }

    @Test
    fun `an owner who is still talking never loses the floor`() {
        val floor = CallFloor(listeningBudgetMillis = 1_000)
        floor.ownerListening(0)

        // Every recogniser callback is proof it is still alive; onRmsChanged alone fires
        // about ten times a second while someone speaks.
        for (tick in 1..100) {
            val at = tick * 500L
            assertFalse("a long utterance is not a wedged recogniser", floor.takeOverrun(at))
            floor.ownerListening(at)
        }
        assertEquals(CallFloor.Holder.OWNER, floor.holder)
    }

    @Test
    fun `a recogniser that stops calling back at all is noticed`() {
        val floor = CallFloor(listeningBudgetMillis = 1_000)
        floor.ownerListening(0)

        assertTrue(floor.takeOverrun(1_000))
    }

    @Test
    fun `releasing the floor stops anything being owed`() {
        val floor = CallFloor(thinkingBudgetMillis = 1_000)
        floor.junctionThinking(0)

        floor.release()

        // The owner muted, or the turn closed cleanly. Either way there is no overdue
        // turn to recover, and recovering one would re-arm a microphone nobody asked for.
        assertFalse(floor.takeOverrun(Long.MAX_VALUE))
        assertEquals(CallFloor.Holder.NOBODY, floor.holder)
    }

    @Test
    fun `taking the floor replaces the previous holder's deadline`() {
        val floor = CallFloor(thinkingBudgetMillis = 1_000, listeningBudgetMillis = 10_000)
        floor.junctionThinking(0)

        // The reply arrived and the mic went back on before the thinking budget ran out.
        floor.ownerListening(500)

        assertFalse("the owner must not inherit a deadline set for the model", floor.takeOverrun(1_500))
        assertEquals(CallFloor.Holder.OWNER, floor.holder)
    }

    @Test
    fun `the defaults leave real turns alone`() {
        val floor = CallFloor()

        floor.junctionThinking(0)
        assertFalse("a slow model turn is not a failure", floor.takeOverrun(20_000))

        floor.junctionSpeaking(0, replyChars = 300)
        assertFalse("a three-hundred-character reply takes a while to say", floor.takeOverrun(25_000))
    }
}
