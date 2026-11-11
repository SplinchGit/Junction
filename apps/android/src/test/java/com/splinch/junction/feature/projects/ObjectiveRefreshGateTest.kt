package com.splinch.junction.feature.projects

import org.junit.Assert.*
import org.junit.Test

class ObjectiveRefreshGateTest {
    @Test fun deletionDiscardsAnEarlierListOrDetailResponse() {
        val gate = ObjectiveRefreshGate()
        val list = gate.begin()
        val detail = gate.begin()
        gate.invalidate()
        assertFalse(gate.accepts(list))
        assertFalse(gate.accepts(detail))
        assertTrue(gate.accepts(gate.begin()))
    }

    @Test fun switchingSelectionDiscardsOnlyThePreviousSelection() {
        val gate = ObjectiveRefreshGate()
        val previous = gate.begin()
        gate.invalidate()
        val selected = gate.begin()
        assertFalse(gate.accepts(previous))
        assertTrue(gate.accepts(selected))
    }
}
