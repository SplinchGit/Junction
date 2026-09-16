package com.splinch.junction.data.sync.lan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.charset.StandardCharsets
import java.util.Base64

class LanProtocolTest {
    @Test
    fun `round trips bounded envelope`() {
        val input = LanProtocol.Envelope(
            type = "chat.delta",
            requestId = "request-1",
            payload = mapOf("text" to "hello", "index" to 2)
        )

        val output = LanProtocol.decode(LanProtocol.encode(input))

        assertEquals(input, output)
    }

    @Test
    fun `rejects unsupported version missing type and oversized request id`() {
        assertEquals(null, LanProtocol.decode("{\"protocolVersion\":2,\"type\":\"ping\"}"))
        assertEquals(null, LanProtocol.decode("{\"protocolVersion\":1}"))
        assertEquals(
            null,
            LanProtocol.decode(
                "{\"protocolVersion\":1,\"type\":\"ping\",\"requestId\":\"${"x".repeat(161)}\"}"
            )
        )
    }

    @Test
    fun `parses pairing qr only while token is valid`() {
        val now = 1_700_000_000_000L
        val code = LanProtocol.PairingCode(
            instanceId = "pc-1",
            host = "192.168.1.20",
            port = 43123,
            certificateSha256 = "ab".repeat(32),
            token = "token",
            expiresAtMillis = now + 30_000
        ).encode()

        assertEquals("pc-1", LanProtocol.parsePairingCode(code, now)?.instanceId)
        assertEquals(null, LanProtocol.parsePairingCode(code, now + 31_000))
        assertTrue(LanProtocol.parsePairingCode(code, now)!!.certificateSha256.length == 64)
    }

    @Test
    fun `pairing QR rejects whitespace and unknown fields`() {
        val now = 1_700_000_000_000L
        val json = """
            {"instanceId":"pc-1","host":"192.168.1.20","port":43123,"certificateSha256":"${"ab".repeat(32)}","token":"token","expiresAtMillis":${now + 30_000},"extra":"reject"}
        """.trimIndent()
        val encoded = "JLP1." + Base64.getUrlEncoder().withoutPadding()
            .encodeToString(json.toByteArray(StandardCharsets.UTF_8))

        assertEquals(null, LanProtocol.parsePairingCode(" $encoded", now))
        assertEquals(null, LanProtocol.parsePairingCode(encoded, now))
    }

    @Test
    fun `auth message matches Windows LAN contract`() {
        assertEquals(
            "junction-lan-v1\nnonce\npc-1\nandroid-1",
            String(LanProtocol.authMessage("nonce", "pc-1", "android-1"), StandardCharsets.UTF_8)
        )
    }

    @Test
    fun `Windows auth payloads contain only the protocol fields`() {
        assertEquals(
            mapOf("deviceId" to "android-1", "certificateFingerprint" to "aa".repeat(32)),
            LanTransport.helloPayload("android-1", "aa".repeat(32))
        )
        assertEquals(
            mapOf("deviceId" to "android-1", "signature" to "sig"),
            LanTransport.authenticatePayload("android-1", "sig")
        )
    }

    @Test
    fun `LAN discovery uses local service and exact fingerprint TXT attribute`() {
        assertEquals("_junction._tcp.", LanProtocol.SERVICE_TYPE)
        assertEquals("certificateFingerprint", LanDiscovery.CERTIFICATE_FINGERPRINT_ATTRIBUTE)
    }

    @Test
    fun `nested sync event arrays decode into Kotlin maps`() {
        val decoded = LanProtocol.decode(LanProtocol.encode(LanProtocol.Envelope(
            "conversation.sync", "sync-1", mapOf("events" to listOf(mapOf("revision" to 2, "type" to "conversation.deleted")))
        )))
        val events = decoded?.payload?.get("events") as? List<*>
        assertEquals("conversation.deleted", (events?.firstOrNull() as? Map<*, *>)?.get("type"))
    }

    @Test
    fun `successful pairing becomes persistent trust without retaining token expiry`() {
        val temporary = LanProtocol.PairingCode("pc-1", "192.168.1.20", 43123, "ab".repeat(32), "one-time", 1234L)
        val trusted = LanProtocol.persistentTrust(temporary)
        assertEquals("", trusted.token)
        assertEquals(Long.MAX_VALUE, trusted.expiresAtMillis)
    }

    @Test
    fun `connection mode has exactly wifi and firebase choices and migrates old values`() {
        assertEquals(LanConnectionMode.WIFI, LanConnectionMode.fromStored("auto"))
        assertEquals(LanConnectionMode.FIREBASE, LanConnectionMode.fromStored("remote"))
        assertEquals(setOf("wifi", "firebase"), LanConnectionMode.entries.map { it.stored }.toSet())
    }
}
