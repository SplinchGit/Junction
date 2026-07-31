package com.splinch.junction.chat.voice

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The test that should have existed before any of this shipped.
 *
 * Voice broke twice in the same place, and neither break was a policy bug: [HandsFreeLoop]
 * and [CallFloor] were correct and unit tested throughout while the call still died after
 * one sentence. Both failures were in how [LocalVoiceSession] joined the policy to the
 * device, and nothing could reach that. So the device now sits behind [VoiceEngine], and
 * these run whole conversations through the real session against a fake one.
 *
 * The recurring failure always has the same shape: the microphone does not come back,
 * while the UI goes on saying it is listening. Nearly every test below is a different road
 * to that same place.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LocalVoiceSessionTest {

    // ── Doubles ─────────────────────────────────────────────────────────────

    private class FakeVoiceEngine(private val clock: () -> Long) : VoiceEngine {
        lateinit var events: VoiceEngineEvents

        override var canRecognise: Boolean = true

        /** Set false to play a recogniser that refuses to start. */
        var armSucceeds = true

        /** Set false to play a speech engine that rejects the utterance outright. */
        var speakSucceeds = true

        var armCount = 0
        var cancelCount = 0
        var rebuildCount = 0
        var stopSpeakingCount = 0
        var bargeInStarted = 0
        var shutdownCount = 0
        val spoken = mutableListOf<String>()
        var lastUtteranceId: String? = null

        override fun nowMillis(): Long = clock()

        override fun start(events: VoiceEngineEvents) {
            this.events = events
        }

        override fun armRecogniser(): Boolean {
            armCount++
            return armSucceeds
        }

        override fun cancelRecogniser() {
            cancelCount++
        }

        override fun rebuildRecogniser() {
            rebuildCount++
        }

        override fun speak(text: String, utteranceId: String): Boolean {
            if (!speakSucceeds) return false
            spoken += text
            lastUtteranceId = utteranceId
            return true
        }

        override fun stopSpeaking() {
            stopSpeakingCount++
        }

        override fun startBargeInListener(): Boolean {
            bargeInStarted++
            return true
        }

        override fun stopBargeInListener() = Unit

        override fun shutdown() {
            shutdownCount++
        }
    }

    private class RecordingListener : LocalVoiceListener {
        val heard = mutableListOf<String>()
        val errors = mutableListOf<String>()
        var listening = false
        var speaking = false
        var callEnded = false

        override fun onUserUtterance(text: String) {
            heard += text
        }

        override fun onListeningStateChanged(listening: Boolean) {
            this.listening = listening
        }

        override fun onSpeakingStateChanged(speaking: Boolean) {
            this.speaking = speaking
        }

        override fun onError(message: String) {
            errors += message
        }

        override fun onHandsFreeEnded() {
            callEnded = true
        }
    }

    private class Harness(
        val engine: FakeVoiceEngine,
        val listener: RecordingListener,
        val session: LocalVoiceSession
    )

    // ── Conversation helpers ────────────────────────────────────────────────

    private fun TestScope.onACall(
        mode: HandsFreeLoop.Mode = HandsFreeLoop.Mode.CALL,
        handsFree: HandsFreeLoop = HandsFreeLoop(),
        /** Set false to play a device whose recogniser refuses from the very first turn. */
        armSucceeds: Boolean = true
    ): Harness {
        val engine = FakeVoiceEngine { testScheduler.currentTime }.apply { this.armSucceeds = armSucceeds }
        val listener = RecordingListener()
        // backgroundScope so the floor watchdog's endless tick doesn't outlive the test.
        val session = LocalVoiceSession(listener, engine, backgroundScope, handsFree)
        session.start()
        session.startListening(mode)
        runCurrent()
        return Harness(engine, listener, session)
    }

    /** The owner says something and Junction answers aloud: the whole happy path. */
    private fun TestScope.exchange(harness: Harness, said: String, reply: String) {
        harness.engine.events.onRecogniserReady()
        runCurrent()
        harness.engine.events.onHeard(said)
        runCurrent()
        harness.session.speak(reply)
        runCurrent()
        harness.engine.events.onSpeechStarted(harness.engine.lastUtteranceId)
        runCurrent()
        harness.engine.events.onSpeechFinished(harness.engine.lastUtteranceId)
        runCurrent()
    }

    // ── The conversation itself ─────────────────────────────────────────────

    @Test
    fun `the microphone comes back after every turn of a real conversation`() = runTest {
        val harness = onACall()
        assertEquals("the mic is armed the moment the call opens", 1, harness.engine.armCount)

        repeat(5) { turn ->
            exchange(harness, said = "question $turn", reply = "answer $turn")
            assertEquals("turn ${turn + 1} left the line dead", turn + 2, harness.engine.armCount)
        }

        assertEquals(5, harness.listener.heard.size)
        assertEquals(5, harness.engine.spoken.size)
        assertTrue("the call is still open after five turns", harness.session.isOnCall)
        assertFalse(harness.listener.callEnded)
    }

    @Test
    fun `the recogniser is not left live while Junction is speaking`() = runTest {
        val harness = onACall()
        harness.engine.events.onRecogniserReady()
        runCurrent()

        harness.engine.events.onHeard("what's the weather")
        runCurrent()

        // Re-arming here is the self-answer bug: Junction transcribes its own reply and
        // then answers it, forever.
        assertEquals("armed once, for the turn just finished", 1, harness.engine.armCount)
        assertFalse(harness.listener.listening)
    }

    // ── Every other way a turn can end ──────────────────────────────────────

    @Test
    fun `a turn that errors instead of replying still gives the microphone back`() = runTest {
        val harness = onACall()
        harness.engine.events.onHeard("do the thing")
        runCurrent()

        // The provider failed. Nothing will ever be spoken for this turn.
        harness.session.onTurnEnded("provider_error")
        runCurrent()

        assertEquals(2, harness.engine.armCount)
        assertTrue(harness.session.isOnCall)
    }

    @Test
    fun `a reply that comes back empty does not strand the line`() = runTest {
        val harness = onACall()
        harness.engine.events.onHeard("do the thing")
        runCurrent()

        harness.session.speak("   ")
        runCurrent()

        assertEquals(2, harness.engine.armCount)
    }

    @Test
    fun `a speech engine that refuses the reply does not strand the line`() = runTest {
        val harness = onACall()
        harness.engine.speakSucceeds = false
        harness.engine.events.onHeard("do the thing")
        runCurrent()

        harness.session.speak("here you go")
        runCurrent()

        // No completion callback is ever coming for an utterance that was never accepted.
        assertEquals(2, harness.engine.armCount)
    }

    @Test
    fun `a reply that never finishes speaking is recovered`() = runTest {
        val harness = onACall()
        harness.engine.events.onHeard("do the thing")
        runCurrent()
        harness.session.speak("a short answer")
        runCurrent()
        harness.engine.events.onSpeechStarted(harness.engine.lastUtteranceId)
        runCurrent()
        val silencedBefore = harness.engine.stopSpeakingCount

        // The engine never fires its completion callback. Some genuinely do this.
        assertEquals(1, harness.engine.armCount)
        advanceTimeBy(CallFloor.DEFAULT_SPEECH_GRACE_MS + 14 * CallFloor.DEFAULT_MILLIS_PER_CHAR + 2_000)

        assertEquals("the watchdog had to hand the line back", 2, harness.engine.armCount)
        assertTrue(
            "and the abandoned audio was silenced before the mic came up under it",
            harness.engine.stopSpeakingCount > silencedBefore
        )
        assertTrue(harness.session.isOnCall)
    }

    @Test
    fun `a recogniser that goes silent without erroring is rebuilt`() = runTest {
        val harness = onACall()
        harness.engine.events.onRecogniserReady()
        runCurrent()

        // No result, no error, no liveness callbacks: the recognition service has wedged.
        advanceTimeBy(CallFloor.DEFAULT_LISTENING_BUDGET_MS + 2_000)

        assertEquals("a wedged recogniser needs a new instance", 1, harness.engine.rebuildCount)
        assertEquals(2, harness.engine.armCount)
        assertTrue(harness.session.isOnCall)
    }

    @Test
    fun `an owner who is still talking is never cut off by the watchdog`() = runTest {
        val harness = onACall()
        harness.engine.events.onRecogniserReady()
        runCurrent()

        // A hundred seconds of talking, with the recogniser reporting liveness throughout.
        repeat(20) {
            advanceTimeBy(5_000)
            harness.engine.events.onRecogniserAlive()
            runCurrent()
        }

        assertEquals("a long utterance is not a wedged recogniser", 1, harness.engine.armCount)
        assertEquals(0, harness.engine.rebuildCount)
    }

    // ── Interruption ────────────────────────────────────────────────────────

    @Test
    fun `talking over a reply stops it and hands the turn straight back`() = runTest {
        val harness = onACall()
        harness.engine.events.onHeard("tell me about the thing")
        runCurrent()
        harness.session.speak("it is a very long story that begins")
        runCurrent()
        harness.engine.events.onSpeechStarted(harness.engine.lastUtteranceId)
        runCurrent()
        assertEquals("the mic listens underneath the reply", 1, harness.engine.bargeInStarted)
        val silencedBefore = harness.engine.stopSpeakingCount

        harness.engine.events.onOwnerCutIn()
        runCurrent()

        assertTrue("playback must stop mid-word", harness.engine.stopSpeakingCount > silencedBefore)
        assertEquals("and the owner's turn starts immediately", 2, harness.engine.armCount)
    }

    @Test
    fun `barge-in after the owner has hung up does not re-open the microphone`() = runTest {
        val harness = onACall()
        harness.engine.events.onHeard("something")
        runCurrent()
        harness.session.speak("a reply")
        runCurrent()
        harness.session.stopListening()
        runCurrent()
        val armsBefore = harness.engine.armCount

        harness.engine.events.onOwnerCutIn()
        runCurrent()

        assertEquals(armsBefore, harness.engine.armCount)
    }

    // ── Silence, failure and hanging up ─────────────────────────────────────

    @Test
    fun `a call is not ended by a long silence`() = runTest {
        val harness = onACall()

        repeat(30) {
            harness.engine.events.onNothingHeard()
            runCurrent()
            // Past the ceiling, not up to it: advanceTimeBy runs what is scheduled
            // strictly before the new time, so landing exactly on the retry delay would
            // leave the re-arm sitting unexecuted and prove nothing.
            advanceTimeBy(HandsFreeLoop.CALL_MAX_RETRY_DELAY_MS + 1)
        }

        assertTrue("the owner opened the line; only the owner closes it", harness.session.isOnCall)
        assertFalse(harness.listener.callEnded)
        assertTrue("and it kept listening throughout", harness.engine.armCount > 30)
    }

    @Test
    fun `hands-free mode still stands the microphone down on sustained silence`() = runTest {
        val harness = onACall(
            mode = HandsFreeLoop.Mode.HANDS_FREE,
            handsFree = HandsFreeLoop(maxSilentTurns = 3)
        )

        repeat(3) {
            harness.engine.events.onNothingHeard()
            runCurrent()
            advanceTimeBy(HandsFreeLoop.SILENT_RETRY_DELAY_MS + 1)
        }

        assertFalse(harness.session.isOnCall)
        assertTrue("the UI must stop claiming to listen", harness.listener.callEnded)
    }

    @Test
    fun `a missing microphone permission ends the call rather than retrying forever`() = runTest {
        val harness = onACall()

        harness.engine.events.onRecogniserFailed(
            RecogniserFailure.PERMISSION,
            "Microphone permission is not granted."
        )
        runCurrent()
        advanceTimeBy(10_000)

        assertFalse(harness.session.isOnCall)
        assertTrue(harness.listener.callEnded)
        assertEquals("retrying a revoked permission never succeeds", 1, harness.engine.armCount)
    }

    @Test
    fun `a recogniser stumble is retried instead of ending the call`() = runTest {
        val harness = onACall()

        harness.engine.events.onRecogniserFailed(RecogniserFailure.TRANSIENT, null)
        runCurrent()
        advanceTimeBy(HandsFreeLoop.CALL_MAX_RETRY_DELAY_MS)

        assertTrue("ERROR_CLIENT is usually a hiccup, not a death", harness.session.isOnCall)
        assertFalse(harness.listener.callEnded)
        assertEquals(2, harness.engine.armCount)
    }

    @Test
    fun `a recogniser that never starts eventually stops being retried`() = runTest {
        val harness = onACall(armSucceeds = false)

        repeat(HandsFreeLoop.MAX_RECOGNISER_FAILURES + 2) {
            advanceTimeBy(HandsFreeLoop.CALL_MAX_RETRY_DELAY_MS + 1)
        }

        assertFalse("a device with no working recogniser must not retry flat out", harness.session.isOnCall)
        assertTrue(harness.listener.callEnded)
    }

    @Test
    fun `hanging up mid-reply does not bring the microphone back afterwards`() = runTest {
        val harness = onACall()
        harness.engine.events.onHeard("something")
        runCurrent()
        harness.session.speak("a reply the owner did not wait for")
        runCurrent()

        harness.session.stopListening()
        runCurrent()
        val armsBefore = harness.engine.armCount

        // The reply finishes after they hung up.
        harness.engine.events.onSpeechFinished(harness.engine.lastUtteranceId)
        runCurrent()

        assertEquals(armsBefore, harness.engine.armCount)
        assertFalse(harness.session.isOnCall)
    }

    // ── Turns that are not the owner's ──────────────────────────────────────

    @Test
    fun `a reply arriving while the mic is armed silences the mic before speaking`() = runTest {
        val harness = onACall()
        harness.engine.events.onRecogniserReady()
        runCurrent()
        val cancelsBefore = harness.engine.cancelCount

        // A typed message, answered while the call is open and waiting on the owner.
        harness.session.speak("answering something you typed")
        runCurrent()

        assertTrue(
            "speaking into a live mic makes Junction answer itself",
            harness.engine.cancelCount > cancelsBefore
        )
    }

    @Test
    fun `reporting the end of a turn while a reply is being spoken is ignored`() = runTest {
        val harness = onACall()
        harness.engine.events.onHeard("something")
        runCurrent()
        harness.session.speak("a reply that is already under way")
        runCurrent()
        val armsBefore = harness.engine.armCount

        // The caller reports the turn complete; the audio has not finished yet.
        harness.session.onTurnEnded("turn_complete")
        runCurrent()

        assertEquals("cutting the reply off here would be the worse bug", armsBefore, harness.engine.armCount)
    }

    @Test
    fun `a turn ending twice only arms the microphone once`() = runTest {
        val harness = onACall()
        harness.engine.events.onHeard("something")
        runCurrent()

        harness.session.onTurnEnded("provider_error")
        harness.session.onTurnEnded("turn_complete")
        runCurrent()

        assertEquals(2, harness.engine.armCount)
    }

    @Test
    fun `ending the session releases the device`() = runTest {
        val harness = onACall()

        harness.session.stop()
        runCurrent()

        assertEquals(1, harness.engine.shutdownCount)
        assertFalse(harness.session.isOnCall)
    }
}
