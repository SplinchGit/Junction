package com.splinch.junction.assistant.provider

import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import com.splinch.junction.data.sync.lan.LanFailure
import com.splinch.junction.data.sync.lan.LanFailureKind
import org.junit.Test

class LanFirstJunctionPcProviderTest {
    @Test
    fun `relay fallback is only allowed before sending and with sound trust`() {
        assertTrue(canUseRelayBeforeSend(true, false, null))
        assertTrue(canUseRelayBeforeSend(true, false, LanFailure(LanFailureKind.UNREACHABLE, "unreachable")))
        assertFalse(canUseRelayBeforeSend(false, false, null))
        assertFalse(canUseRelayBeforeSend(true, true, null))
        assertFalse(canUseRelayBeforeSend(true, false, LanFailure(LanFailureKind.AUTHENTICATION, "rejected")))
    }
    @Test
    fun `stale Firebase offline response retries over LAN`() = runBlocking {
        var lanAttempts = 0
        val offline = JunctionPcProvider.PC_OFFLINE_ERROR_MESSAGE
        val events = firebaseWithOfflineLanFallback(
            firebase = flowOf(LlmEvent.Activity("Waiting"), LlmEvent.Error(offline), LlmEvent.Done),
            lan = {
                lanAttempts++
                flowOf(LlmEvent.TextDone("Hello from the PC"), LlmEvent.Done)
            }
        ).toList()

        assertEquals(1, lanAttempts)
        assertFalse(events.any { it is LlmEvent.Error && it.message == offline })
        assertTrue(events.any { it == LlmEvent.Activity("Trying the local Wi-Fi connection") })
        assertTrue(events.any { it == LlmEvent.TextDone("Hello from the PC") })
    }

    @Test
    fun `unrelated Firebase error does not trigger LAN retry`() = runBlocking {
        var lanAttempts = 0
        val events = firebaseWithOfflineLanFallback(
            firebase = flowOf(LlmEvent.Error("Cloud relay quota exhausted"), LlmEvent.Done),
            lan = {
                lanAttempts++
                flowOf(LlmEvent.TextDone("unexpected"))
            }
        ).toList()

        assertEquals(0, lanAttempts)
        assertTrue(events.any { it == LlmEvent.Error("Cloud relay quota exhausted") })
    }
}
