package com.splinch.junction.data.sync.lan

import org.junit.Assert.*
import org.junit.Test

class LanCandidatesTest {
    private val trusted = LanProtocol.PairingCode("pc", "192.168.1.2", 4000, "aa".repeat(32), "", Long.MAX_VALUE)
    @Test fun keepsDistinctMatchingAddressesAndTrustedCachedFallback() {
        val nic = LanEndpoint("192.168.1.3", 5000, "pc", trusted.certificateSha256)
        val other = nic.copy(instanceId = "another")
        assertEquals(listOf(nic, LanEndpoint(trusted.host, trusted.port, trusted.instanceId, trusted.certificateSha256)),
            lanCandidates(listOf(other, nic, nic), trusted))
    }
    @Test fun onlyNetworkFailureAllowsAnotherAddress() {
        assertTrue(canTryAnotherLanAddress(LanFailure(LanFailureKind.UNREACHABLE, "offline")))
        assertTrue(canTryAnotherLanAddress(java.net.ConnectException("offline")))
        assertFalse(canTryAnotherLanAddress(javax.net.ssl.SSLHandshakeException("pin mismatch")))
        assertFalse(canTryAnotherLanAddress(LanFailure(LanFailureKind.AUTHENTICATION, "revoked")))
        assertFalse(canTryAnotherLanAddress(LanFailure(LanFailureKind.STALE_TRUST, "changed")))
        assertFalse(canTryAnotherLanAddress(SecurityException("proof")))
    }
}
