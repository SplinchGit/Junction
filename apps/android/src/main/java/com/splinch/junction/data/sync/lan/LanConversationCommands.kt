package com.splinch.junction.data.sync.lan

import android.content.Context

/** Best-effort commands to the Windows authoritative conversation store. */
class LanConversationCommands(context: Context) {
    private val identity = LanIdentityStore(context.applicationContext)

    suspend fun delete(conversationId: String): Boolean = runCatching {
        val pairing = identity.loadPairing() ?: return false
        val transport = LanTransport(identity)
        transport.connect(LanEndpoint(pairing.host, pairing.port, pairing.instanceId, pairing.certificateSha256)).getOrThrow()
        val response = transport.request("conversation.deleted", mapOf("conversationId" to conversationId))
        transport.close()
        response.type == "conversation.deleted"
    }.getOrDefault(false)
}
