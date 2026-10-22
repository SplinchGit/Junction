package com.splinch.junction.data.sync.lan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceCommandRedactionTest {
    @Test
    fun removesCredentialsAndAddressesFromLogs() {
        val raw = """
            I/Okhttp: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig
            D/Auth: token=ya29.a0AfH6SMBxyz-123
            W/Firebase: key AIzaSyD4f8g9h0j1k2l3m4n5o6p7q8r9s0t
            I/Sync: signed in as owner.person@example.com
            D/Relay: ciphertext QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo0NTY3ODkw
            E/Junction: password: hunter2
        """.trimIndent()
        val clean = DeviceCommandRunner.redact(raw)
        listOf("eyJhbGci", "ya29.", "AIzaSy", "owner.person@example.com", "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo0NTY3ODkw", "hunter2").forEach {
            assertFalse("leaked $it", clean.contains(it))
        }
        assertTrue(clean.contains("[email]"))
    }

    @Test
    fun keepsOrdinaryDiagnostics() {
        val line = "E/LanTransport: connect failed after 7000 ms (timeout)"
        assertEquals(line, DeviceCommandRunner.redact(line))
    }
}
