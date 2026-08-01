package com.splinch.junction.feature.voice.model

import com.splinch.junction.feature.voice.local.*
import com.splinch.junction.feature.voice.model.*

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Regression cover for the silent-drop bug: a reply that arrived while TextToSpeech
 * was still initialising used to be discarded with only a log line, so Junction would
 * hear the owner and then say nothing.
 */
class PendingSpeechTest {

    @Test
    fun `an utterance queued before the engine is ready survives until taken`() {
        val pending = PendingSpeech()

        pending.queue("On my way.")

        assertTrue(pending.hasPending)
        assertEquals("On my way.", pending.take())
    }

    @Test
    fun `taking clears it so it is spoken exactly once`() {
        val pending = PendingSpeech()
        pending.queue("Hello.")

        assertEquals("Hello.", pending.take())
        assertNull("a second take must not repeat the utterance", pending.take())
        assertFalse(pending.hasPending)
    }

    @Test
    fun `the newest utterance replaces an older one`() {
        val pending = PendingSpeech()

        pending.queue("First reply.")
        pending.queue("Second reply.")

        // Speaking both would talk over the owner, and the first is stale by now.
        assertEquals("Second reply.", pending.take())
        assertNull(pending.take())
    }

    @Test
    fun `discard drops it, so barge-in is not spoken over afterwards`() {
        val pending = PendingSpeech()
        pending.queue("Interrupted reply.")

        pending.discard()

        assertFalse(pending.hasPending)
        assertNull(pending.take())
    }

    @Test
    fun `blank text is never queued`() {
        val pending = PendingSpeech()

        pending.queue("")
        pending.queue("   ")

        assertFalse(pending.hasPending)
        assertNull(pending.take())
    }

    @Test
    fun `nothing queued means nothing to speak`() {
        val pending = PendingSpeech()

        assertFalse(pending.hasPending)
        assertNull(pending.take())
    }
}
