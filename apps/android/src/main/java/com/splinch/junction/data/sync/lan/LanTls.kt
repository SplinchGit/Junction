package com.splinch.junction.data.sync.lan

import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager
import okhttp3.OkHttpClient

/** A single pinned device is this client's trust anchor; system/global TLS is untouched. */
object LanTls {
    fun client(fingerprint: String): OkHttpClient {
        require(fingerprint.matches(Regex("[0-9a-fA-F]{64}")))
        val expected = fingerprint.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        val trust = object : X509TrustManager {
            override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
            override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
                throw CertificateException("Client certificates are not accepted here")
            }
            override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
                val leaf = chain.firstOrNull() ?: throw CertificateException("Missing LAN certificate")
                leaf.checkValidity()
                if (!MessageDigest.isEqual(expected, MessageDigest.getInstance("SHA-256").digest(leaf.publicKey.encoded))) {
                    throw CertificateException("Junction LAN certificate pin mismatch")
                }
            }
        }
        val tls = SSLContext.getInstance("TLS").apply { init(null, arrayOf(trust), null) }
        return OkHttpClient.Builder().sslSocketFactory(tls.socketFactory, trust)
            .pingInterval(20, java.util.concurrent.TimeUnit.SECONDS).build()
    }
}
