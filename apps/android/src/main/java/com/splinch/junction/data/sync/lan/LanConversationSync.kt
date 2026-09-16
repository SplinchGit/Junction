package com.splinch.junction.data.sync.lan

import com.splinch.junction.data.database.chat.ChatDao
import com.splinch.junction.data.database.chat.ChatMessageEntity
import com.splinch.junction.data.database.chat.ChatSessionEntity
import com.splinch.junction.data.secret.KeyStorage

/** Applies the Windows-authoritative LAN event log to Android's Room cache. */
class LanConversationSync(private val dao: ChatDao, private val keys: KeyStorage) {
    suspend fun reconcile(transport: LanTransport): Result<Int> = runCatching {
        val known = keys.getSecret(REVISION_SECRET).toLongOrNull()?.coerceAtLeast(0L) ?: 0L
        val response = transport.request("conversation.sync", mapOf("sinceRevision" to known))
        require(response.type == "conversation.sync") { "Unexpected LAN sync response" }
        val events = response.payload["events"] as? List<*> ?: emptyList<Any?>()
        var revision = known
        events.mapNotNull { it as? Map<*, *> }
            .sortedBy { (it["revision"] as? Number)?.toLong() ?: 0L }
            .forEach { event ->
                val eventRevision = (event["revision"] as? Number)?.toLong() ?: return@forEach
                apply(event["type"]?.toString().orEmpty(), event["value"] as? Map<*, *> ?: emptyMap<Any?, Any?>())
                revision = maxOf(revision, eventRevision)
            }
        revision = maxOf(revision, (response.payload["currentRevision"] as? Number)?.toLong() ?: revision)
        keys.setSecret(REVISION_SECRET, revision.toString())
        events.size
    }

    private suspend fun apply(type: String, value: Map<*, *>) {
        when (type) {
            "conversation.created", "conversation.updated" -> {
                val conversation = (value["conversation"] as? Map<*, *>) ?: return
                val id = conversation["id"]?.toString() ?: return
                dao.upsertSession(ChatSessionEntity(id, number(conversation["createdAt"]), title = conversation["title"]?.toString(), sharedUpdatedAt = number(conversation["updatedAt"])))
                (conversation["messages"] as? List<*>)?.mapNotNull { it as? Map<*, *> }?.forEach { upsertMessage(id, it) }
            }
            "message.created" -> {
                val id = value["conversationId"]?.toString() ?: return
                if (dao.getSessionById(id) == null) return
                (value["message"] as? Map<*, *>)?.let { upsertMessage(id, it) }
            }
            "conversation.deleted" -> {
                val tombstone = value["tombstone"] as? Map<*, *> ?: return
                tombstone["id"]?.toString()?.let { id -> dao.clearMessagesForSession(id); dao.deleteSessionById(id) }
            }
        }
    }

    private suspend fun upsertMessage(sessionId: String, message: Map<*, *>) {
        val id = message["id"]?.toString() ?: return
        dao.insertMessage(ChatMessageEntity(id, sessionId, number(message["createdAt"]), sender(message["role"]), message["content"]?.toString().orEmpty(), provenance(message["provenance"])))
    }

    private fun number(value: Any?): Long = (value as? Number)?.toLong() ?: 0L
    private fun sender(value: Any?): String = when (value?.toString()?.uppercase()) { "USER" -> "USER"; "ASSISTANT", "MODEL" -> "ASSISTANT"; else -> "SYSTEM" }
    private fun provenance(value: Any?): String = when (value?.toString()?.uppercase()) { "OWNER" -> "OWNER"; "JUNCTION" -> "JUNCTION"; else -> "UNTRUSTED" }

    private companion object { const val REVISION_SECRET = "lan_conversation_revision_v1" }
}
