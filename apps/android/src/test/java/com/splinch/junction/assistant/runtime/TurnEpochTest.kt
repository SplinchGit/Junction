package com.splinch.junction.assistant.runtime

import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TurnEpochTest {
    @Test fun beginningNewTurnInvalidatesEarlierProviderEvents() {
        val epochs = TurnEpoch()
        val first = epochs.begin()
        assertTrue(epochs.isCurrent(first))

        val second = epochs.begin()

        assertFalse(epochs.isCurrent(first))
        assertTrue(epochs.isCurrent(second))
    }

    @Test fun completionCallbackIsDeliveredExactlyOnce() {
        val outcomes = mutableListOf<TurnOutcome>()
        val completion = TurnCompletion(outcomes::add)
        val first = TurnOutcome("first", 0, false, false, null)
        val duplicate = TurnOutcome("duplicate", 0, false, false, null)

        assertTrue(completion.report(first))
        assertFalse(completion.report(duplicate))
        assertEquals(listOf(first), outcomes)
    }
}
