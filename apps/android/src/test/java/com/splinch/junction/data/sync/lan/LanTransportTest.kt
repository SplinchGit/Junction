package com.splinch.junction.data.sync.lan

import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest

class LanTransportTest {
    private fun fixture(block: suspend (MockWebServer, LanTransport, LanEndpoint) -> Unit) = runBlocking {
        val cert = HeldCertificate.Builder().commonName("PC").addSubjectAlternativeName("127.0.0.1").build()
        val pin = MessageDigest.getInstance("SHA-256").digest(cert.certificate.publicKey.encoded).joinToString("") { "%02x".format(it) }
        MockWebServer().use { server ->
            server.useHttps(HandshakeCertificates.Builder().heldCertificate(cert).build().sslSocketFactory(), false)
            server.start(java.net.InetAddress.getByName("127.0.0.1"), 0)
            val pairing = LanProtocol.PairingCode("pc", "127.0.0.1", server.port, pin, "", Long.MAX_VALUE)
            val identity = object : LanIdentity {
                override fun loadPairing() = pairing
                override fun savePairing(pairing: LanProtocol.PairingCode) {}
                override fun deviceId() = "phone"
                override fun publicKeyBase64() = "test"
                override fun sign(message: ByteArray) = "signature"
            }
            val transport = LanTransport(identity, this)
            try { block(server, transport, LanEndpoint(pairing.host, pairing.port, "pc", pin)) }
            finally { transport.close() }
        }
    }
    @Test fun authenticationRejectionCompletesImmediately() = fixture { server, transport, endpoint ->
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                webSocket.send(LanProtocol.encode(LanProtocol.Envelope("chat.error", payload = mapOf("message" to "Device revoked"))))
            }
        }))
        val result = withTimeout(2000) { transport.connect(endpoint) }
        assertTrue(result.exceptionOrNull() is LanFailure)
        assertEquals(LanFailureKind.AUTHENTICATION, (result.exceptionOrNull() as LanFailure).kind)
    }
    @Test fun closedHandshakeCompletesImmediately() = fixture { server, transport, endpoint ->
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) { webSocket.close(1008, "Device revoked") }
        }))
        val result = withTimeout(2000) { transport.connect(endpoint) }
        assertEquals(LanFailureKind.AUTHENTICATION, (result.exceptionOrNull() as LanFailure).kind)
    }
    @Test fun disconnectFailsPendingRequestWithoutReplay() = fixture { server, transport, endpoint ->
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                val event = LanProtocol.decode(text)!!
                if (event.type == "hello") webSocket.send(LanProtocol.encode(LanProtocol.Envelope("authenticated", event.requestId)))
                else webSocket.close(1001, "PC shutting down")
            }
        }))
        withTimeout(2000) { transport.connect(endpoint).getOrThrow() }
        val error = runCatching { withTimeout(2000) { transport.request("conversation.sync") } }.exceptionOrNull()
        assertTrue(error is LanFailure)
        assertEquals(LanFailureKind.DISCONNECTED, (error as LanFailure).kind)
        assertEquals(1, server.requestCount)
    }
    @Test fun advertisedChangedCertificateNeverReplacesTrust() = fixture { server, transport, endpoint ->
        val result = transport.connect(endpoint.copy(certificateFingerprint = "00".repeat(32)))
        assertEquals(LanFailureKind.STALE_TRUST, (result.exceptionOrNull() as LanFailure).kind)
        assertEquals(0, server.requestCount)
    }
}
