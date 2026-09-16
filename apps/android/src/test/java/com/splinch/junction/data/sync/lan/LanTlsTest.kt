package com.splinch.junction.data.sync.lan

import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest

class LanTlsTest {
    @Test fun `trusts exactly the pinned self signed PC and rejects another pin`() {
        val certificate = HeldCertificate.Builder().commonName("Junction test").addSubjectAlternativeName("127.0.0.1").build()
        val tls = HandshakeCertificates.Builder().heldCertificate(certificate).build()
        MockWebServer().use { server ->
            server.useHttps(tls.sslSocketFactory(), false)
            server.enqueue(MockResponse().setBody("LAN_TLS_OK"))
            server.start(java.net.InetAddress.getByName("127.0.0.1"), 0)
            val url = server.url("/").newBuilder().host("127.0.0.1").build()
            val pin = MessageDigest.getInstance("SHA-256").digest(certificate.certificate.publicKey.encoded).joinToString("") { "%02x".format(it) }
            val client = LanTls.client(pin)
            client.newCall(Request.Builder().url(url).build()).execute().use { assertEquals("LAN_TLS_OK", it.body!!.string()) }
            val wrong = LanTls.client("00".repeat(32))
            assertThrows(javax.net.ssl.SSLHandshakeException::class.java) {
                wrong.newCall(Request.Builder().url(url).build()).execute().close()
            }
            client.connectionPool.evictAll(); client.dispatcher.executorService.shutdown()
            wrong.connectionPool.evictAll(); wrong.dispatcher.executorService.shutdown()
        }
    }
}
