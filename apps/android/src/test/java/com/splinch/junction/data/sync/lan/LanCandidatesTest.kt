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
    @Test fun manualAddressUsesOnlySavedPairingIdentityAndPrecedesOldNetworkAddresses() {
        val manual = LanEndpoint("10.25.144.113", trusted.port, trusted.instanceId, trusted.certificateSha256)
        assertEquals(manual, lanCandidates(listOf(LanEndpoint("192.168.1.3", 4000, "pc")), trusted, manual.host).first())
        assertFalse(lanCandidates(emptyList(), null, manual.host).contains(manual))
        assertEquals(trusted.host, lanCandidates(emptyList(), trusted, "10.25.144.113/evil").first().host)
    }
    @Test fun onlyNetworkFailureAllowsAnotherAddress() {
        assertTrue(canTryAnotherLanAddress(LanFailure(LanFailureKind.UNREACHABLE, "offline")))
        assertTrue(canTryAnotherLanAddress(java.net.ConnectException("offline")))
        assertFalse(canTryAnotherLanAddress(javax.net.ssl.SSLHandshakeException("pin mismatch")))
        assertFalse(canTryAnotherLanAddress(LanFailure(LanFailureKind.AUTHENTICATION, "revoked")))
        assertFalse(canTryAnotherLanAddress(LanFailure(LanFailureKind.STALE_TRUST, "changed")))
        assertFalse(canTryAnotherLanAddress(SecurityException("proof")))
    }
    @Test fun relayFallbackNeverOverridesRejectedOrChangedLanTrust() {
        assertFalse(canFallbackToRelay(LanFailure(LanFailureKind.AUTHENTICATION, "revoked")))
        assertFalse(canFallbackToRelay(LanFailure(LanFailureKind.STALE_TRUST, "certificate changed")))
        assertFalse(canFallbackToRelay(SecurityException("invalid identity")))
        assertTrue(canFallbackToRelay(LanFailure(LanFailureKind.UNREACHABLE, "offline")))
        assertTrue(canFallbackToRelay(LanFailure(LanFailureKind.TIMEOUT, "timed out")))
        assertTrue(canFallbackToRelay(LanFailure(LanFailureKind.DISCONNECTED, "socket closed")))
        assertTrue(canFallbackToRelay(java.net.ConnectException("offline")))
    }
}
