package com.splinch.junction.data.sync.lan

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import java.nio.charset.StandardCharsets
data class LanEndpoint(val host: String, val port: Int, val instanceId: String = "", val certificateFingerprint: String = "")

/** NSD wrapper; manual endpoints are intentionally explicit and primarily useful for debug builds. */
class LanDiscovery(context: Context) {
    private val nsd = context.applicationContext.getSystemService(NsdManager::class.java)
    private var listener: NsdManager.DiscoveryListener? = null

    fun discover(onEndpoint: (LanEndpoint) -> Unit, onError: (Throwable) -> Unit = {}) {
        stop()
        val discovery = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) = Unit
            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                if (serviceInfo.serviceType != LanProtocol.SERVICE_TYPE) return
                val resolve = object : NsdManager.ResolveListener {
                    override fun onServiceResolved(info: NsdServiceInfo) {
                        val host = info.host?.hostAddress ?: return
                        onEndpoint(LanEndpoint(host, info.port, info.attributes.text("instanceId"), info.attributes.text(CERTIFICATE_FINGERPRINT_ATTRIBUTE)))
                    }
                    override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) = onError(IllegalStateException("LAN service resolve failed: $errorCode"))
                }
                runCatching { nsd.resolveService(serviceInfo, resolve) }
                    .onFailure(onError)
            }
            override fun onServiceLost(serviceInfo: NsdServiceInfo) = Unit
            override fun onDiscoveryStopped(serviceType: String) = Unit
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) { onError(IllegalStateException("LAN discovery failed: $errorCode")); stop() }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) { onError(IllegalStateException("LAN discovery stop failed: $errorCode")); stop() }
        }
        listener = discovery
        nsd.discoverServices(LanProtocol.SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discovery)
    }

    fun manual(host: String, port: Int): LanEndpoint {
        require(host.isNotBlank() && port in 1..65535)
        return LanEndpoint(host.trim(), port)
    }

    fun stop() { listener?.let { runCatching { nsd.stopServiceDiscovery(it) } }; listener = null }

    private fun Map<String, ByteArray>.text(key: String): String = get(key)?.toString(StandardCharsets.UTF_8).orEmpty()

    companion object { const val CERTIFICATE_FINGERPRINT_ATTRIBUTE = "certificateFingerprint" }
}
