package com.splinch.junction.data.sync.lan

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log
import java.nio.charset.StandardCharsets
data class LanEndpoint(val host: String, val port: Int, val instanceId: String = "", val certificateFingerprint: String = "")

/** NSD wrapper; manual endpoints are intentionally explicit and primarily useful for debug builds. */
class LanDiscovery(context: Context) {
    private val nsd = context.applicationContext.getSystemService(NsdManager::class.java)
    private var listener: NsdManager.DiscoveryListener? = null
    private var generation = 0L

    fun discover(onEndpoint: (LanEndpoint) -> Unit, onError: (Throwable) -> Unit = {}) {
        stop()
        val session = generation
        val discovery = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) { Log.i(TAG, "LAN discovery started") }
            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                if (session != generation) return
                Log.i(TAG, "LAN service found: ${serviceInfo.serviceName}")
                if (serviceInfo.serviceType.trimEnd('.').lowercase() != LanProtocol.SERVICE_TYPE.trimEnd('.').lowercase()) return
                val resolve = object : NsdManager.ResolveListener {
                    override fun onServiceResolved(info: NsdServiceInfo) {
                        if (session != generation) return
                        val host = info.host?.hostAddress ?: return
                        Log.i(TAG, "LAN service resolved at $host:${info.port}")
                        onEndpoint(LanEndpoint(host, info.port, info.attributes.text("instanceId"), info.attributes.text(CERTIFICATE_FINGERPRINT_ATTRIBUTE)))
                    }
                    override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) { Log.w(TAG, "LAN service resolve failed: $errorCode") }
                }
                runCatching { nsd.resolveService(serviceInfo, resolve) }
                    .onFailure { Log.w(TAG, "LAN resolve failed: ${it.javaClass.simpleName}") }
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

    fun stop() { generation++; val previous = listener; listener = null; previous?.let { runCatching { nsd.stopServiceDiscovery(it) } } }

    private fun Map<String, ByteArray>.text(key: String): String = get(key)?.toString(StandardCharsets.UTF_8).orEmpty()

    companion object {
        const val CERTIFICATE_FINGERPRINT_ATTRIBUTE = "certificateFingerprint"
        private const val TAG = "JunctionLanDiscovery"
    }
}
