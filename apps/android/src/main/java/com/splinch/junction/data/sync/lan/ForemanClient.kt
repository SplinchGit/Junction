package com.splinch.junction.data.sync.lan

import android.content.Context
import com.splinch.junction.data.secret.KeyStorage

/** Owner controls use the existing paired, certificate-pinned LAN transport. */
class ForemanClient(context: Context) {
    private val identity = LanIdentityStore(context.applicationContext)
    private val keys = KeyStorage(context.applicationContext)

    suspend fun request(type: String, payload: Map<String, Any?> = emptyMap()): Map<String, Any?> {
        require(type in setOf("project.list", "project.get", "task.control", "task.enqueue"))
        require(LanConnectionMode.fromStored(keys.getSecret("lan_mode_v1")) == LanConnectionMode.WIFI) {
            "Connect this phone and Junction Windows to the same Wi-Fi network."
        }
        val pairing = identity.loadPairing() ?: error("Pair this phone with Junction Windows first.")
        val transport = LanTransport(identity)
        try {
            transport.connect(LanEndpoint(pairing.host, pairing.port, pairing.instanceId, pairing.certificateSha256)).getOrThrow()
            val response = transport.request(type, payload)
            check(response.type == "$type.result") { response.payload["message"]?.toString() ?: "Junction Windows rejected the request." }
            return response.payload
        } finally { transport.close() }
    }
}
