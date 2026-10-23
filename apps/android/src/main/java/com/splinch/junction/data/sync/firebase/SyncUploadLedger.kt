package com.splinch.junction.data.sync.firebase

import org.json.JSONObject

/**
 * Records what this device already uploaded to the shared history, so the periodic
 * backfill only sends what is new. Shared messages are immutable (rules allow only an
 * identical rewrite), so each is uploaded once; a conversation is re-sent only when its
 * sharedUpdatedAt advances. Firestore bills identical rewrites as writes, and the old
 * backfill rewrote every message every 15 s, which exhausted the project's daily write
 * quota and starved the PC relay heartbeat.
 */
class SyncUploadLedger(
    private val load: (String) -> String?,
    private val save: (String, String) -> Unit,
    private val maxMessages: Int = MAX_MESSAGES
) {
    private fun read(uid: String): JSONObject = runCatching { JSONObject(load(key(uid)) ?: "{}") }.getOrDefault(JSONObject())
    private fun key(uid: String) = "uploaded:$uid"

    fun conversationCurrent(uid: String, conversationId: String, sharedUpdatedAt: Long): Boolean =
        read(uid).optJSONObject("conversations")?.optLong(conversationId, Long.MIN_VALUE)?.let { it >= sharedUpdatedAt } ?: false

    fun messageUploaded(uid: String, messageId: String): Boolean =
        read(uid).optJSONObject("messages")?.has(messageId) ?: false

    fun recordConversation(uid: String, conversationId: String, sharedUpdatedAt: Long) = update(uid) { state ->
        val conversations = state.optJSONObject("conversations") ?: JSONObject().also { state.put("conversations", it) }
        if (conversations.optLong(conversationId, Long.MIN_VALUE) < sharedUpdatedAt) conversations.put(conversationId, sharedUpdatedAt)
    }

    fun recordMessage(uid: String, messageId: String) = update(uid) { state ->
        val messages = state.optJSONObject("messages") ?: JSONObject().also { state.put("messages", it) }
        messages.put(messageId, 1)
        // Bound the ledger. Forgetting the oldest ids costs at most one identical rewrite each.
        if (messages.length() > maxMessages) messages.keys().asSequence().take(messages.length() - maxMessages).toList().forEach { messages.remove(it) }
    }

    fun forgetConversation(uid: String, conversationId: String) = update(uid) { it.optJSONObject("conversations")?.remove(conversationId) }

    @Synchronized
    private fun update(uid: String, change: (JSONObject) -> Unit) {
        val state = read(uid)
        change(state)
        save(key(uid), state.toString())
    }

    companion object { const val MAX_MESSAGES = 20_000 }
}
