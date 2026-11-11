package com.splinch.junction.data.sync.lan

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NethraClientRequestTest {
    @Test fun agentActionsAreAcceptedByThePairedTransport() {
        assertTrue(NethraClient.supportsRequest("nethra.agent.create"))
        assertTrue(NethraClient.supportsRequest("nethra.child.stop"))
        assertTrue(NethraClient.supportsRequest("nethra.control"))
        assertFalse(NethraClient.supportsRequest("nethra.agent.unknown"))
    }
}
