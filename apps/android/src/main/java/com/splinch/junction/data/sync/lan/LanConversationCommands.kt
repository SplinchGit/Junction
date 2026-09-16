package com.splinch.junction.data.sync.lan

import android.content.Context
import com.splinch.junction.data.secret.KeyStorage

/** Best-effort commands to the Windows authoritative conversation store. */
class LanConversationCommands(context: Context) {
    private val appContext = context.applicationContext
    private val identity = LanIdentityStore(appContext)

    suspend fun delete(conversationId: String): Boolean = runCatching {
        if (LanConnectionMode.fromStored(KeyStorage(appContext).getSecret("lan_mode_v1")) != LanConnectionMode.WIFI) return false
        val pairing = identity.loadPairing() ?: return false
        val transport = LanTransport(identity)
        transport.connect(LanEndpoint(pairing.host, pairing.port, pairing.instanceId, pairing.certificateSha256)).getOrThrow()
        val response = transport.request("conversation.deleted", mapOf("conversationId" to conversationId))
        transport.close()
        response.type == "conversation.deleted"
    }.getOrDefault(false)
}
