package com.splinch.junction.data.sync.lan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceCommandRedactionTest {
    @Test
    fun removesCredentialsAndAddressesFromLogs() {
        val raw = """
            I/Okhttp: Authorization: Bearer example-bearer-value
            D/Auth: token=example-token-value
            W/Firebase: api_key=example-api-key-value
            I/Sync: signed in as owner.person@example.com
            D/Relay: ciphertext AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
            E/Junction: password: example-password-value
        """.trimIndent()
        val clean = DeviceCommandRunner.redact(raw)
        listOf("example-bearer-value", "example-token-value", "example-api-key-value", "owner.person@example.com", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "example-password-value").forEach {
            assertFalse("leaked $it", clean.contains(it))
        }
        assertTrue(clean.contains("[email]"))
    }

    /**
     * Google key and OAuth token shapes are assembled at runtime so no credential-shaped
     * literal ever appears in source (secret scanners flag those even when fake).
     */
    @Test
    fun removesGoogleKeyAndOAuthTokenShapes() {
        val filler = "x".repeat(30)
        val googleKey = listOf("AI", "za", filler).joinToString("")
        val oauthToken = listOf("ya", "29.", filler).joinToString("")
        val clean = DeviceCommandRunner.redact("W/Firebase: key $googleKey\nD/Auth: access $oauthToken")
        assertFalse("leaked Google key shape", clean.contains(filler))
        assertTrue(clean.contains("[redacted-key]"))
        assertTrue(clean.contains("[redacted-token]"))
    }

    @Test
    fun keepsOrdinaryDiagnostics() {
        val line = "E/LanTransport: connect failed after 7000 ms (timeout)"
        assertEquals(line, DeviceCommandRunner.redact(line))
    }
}
