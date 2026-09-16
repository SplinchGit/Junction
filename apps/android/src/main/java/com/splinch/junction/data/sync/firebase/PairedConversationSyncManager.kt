package com.splinch.junction.data.sync.firebase

import android.content.Context
import com.google.firebase.Timestamp
import com.google.firebase.firestore.ListenerRegistration
import com.splinch.junction.data.database.chat.ChatDao
import com.splinch.junction.data.database.chat.ChatMessageEntity
import com.splinch.junction.data.database.chat.ChatSessionEntity
import kotlinx.coroutines.*
import kotlinx.coroutines.tasks.await
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Conversation records use the same end-to-end encrypted PC pairing as inference. */
class PairedConversationSyncManager(context: Context, private val dao: ChatDao) {
    private val context = context.applicationContext
    private val prefs = context.getSharedPreferences("junction_paired_chat_sync", Context.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var job: Job? = null
    private var cycleVersion: String? = null
    var lastError: String? = null
        private set

    fun start() {
        if (job != null) return
        job = scope.launch {
            var cursor = 0
            while (isActive) {
                try {
                    val pairing = LocalBrainPairingStore.load(context)
                    if (pairing != null) {
                        cursor = sync(pairing, cursor)
                        lastError = null
                    }
                } catch (error: TimeoutCancellationException) { lastError = "Conversation sync timed out; retrying"; cursor = 0 }
                catch (error: CancellationException) { throw error }
                catch (error: Exception) { lastError = error.message; cursor = 0 }
                delay(if (cursor == 0) 10_000 else 100)
            }
        }
    }

    private fun key(record: JSONObject): String = record.getString("kind") + ":" + record.getJSONObject("value").getString("id") + if (record.getString("kind") == "message_part") ":${record.getJSONObject("value").getInt("index")}" else ""
    private fun fingerprint(row: JSONObject): String = java.security.MessageDigest.getInstance("SHA-256").digest(row.toString().toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    private fun record(kind: String, value: JSONObject) = JSONObject().put("kind", kind).put("value", value)
    private suspend fun sync(pairing: LocalBrainPairing, cursor: Int): Int {
        val sessions = dao.getAllSessions()
        val knownKey = "known:${pairing.brainId}"
        val currentIds = sessions.map { it.id }.toSet()
        val deletedKey = "deleted:${pairing.brainId}"
        val deleted = JSONObject(prefs.getString(deletedKey, "{}")!!)
        val known = prefs.getStringSet(knownKey, emptySet()).orEmpty()
        for (id in known - currentIds) if (!deleted.has(id)) {
            val now = System.currentTimeMillis()
            deleted.put(id, JSONObject().put("id",id).put("title","Deleted conversation").put("createdAt",now).put("updatedAt",now).put("deletedAt",now))
        }
        // Persist deletions before network access, so retries cannot resurrect them.
        prefs.edit().putString(deletedKey, deleted.toString()).apply()
        val outgoing = JSONArray()
        val fingerprints = JSONObject(prefs.getString("sent:${pairing.brainId}", "{}")!!)
        val included = mutableListOf<JSONObject>()
        var bytes = 2
        fun add(row: JSONObject): Boolean {
            if (fingerprints.optString(key(row)) == fingerprint(row)) return true
            val size = row.toString().toByteArray(Charsets.UTF_8).size + 1
            require(size <= 35_000) { "A chat message is too large for encrypted sync." }
            if (bytes + size > 35_000) return false
            outgoing.put(row); included.add(row); bytes += size
            return true
        }
        for (id in deleted.keys()) if (!add(record("delete", deleted.getJSONObject(id)))) break
        sessionLoop@ for (session in sessions) {
            if (deleted.has(session.id)) continue
            val messages = dao.getMessages(session.id)
            val updated = maxOf(session.sharedUpdatedAt, messages.maxOfOrNull { it.timestamp } ?: session.startedAt)
            val metadata = JSONObject().put("id",session.id).put("title",session.title ?: messages.firstOrNull()?.content?.take(60) ?: "New conversation").put("createdAt",session.startedAt).put("updatedAt",updated)
            if (!add(record("conversation",metadata))) break
            for (message in messages) {
                val value = JSONObject().put("id",message.id).put("role",message.sender.lowercase()).put("content",message.content).put("createdAt",message.timestamp).put("provenance",message.provenance)
                for (row in PairedSyncRecords.messageRecords(session.id, value)) if (!add(row)) break@sessionLoop
            }
        }
        if (outgoing.length() == 0 && cursor == 0) {
            val brain = withTimeout(15_000) { FirebaseProvider.firestoreOrNull()?.collection("local_brains")?.document(pairing.brainId)?.get()?.await() }
            val version = brain?.getString("conversationVersion")
            if (version != null && version == prefs.getString("version:${pairing.brainId}", null)) return 0
        }
        // Remember IDs before sending: the PC may commit even if its reply is lost.
        // A later local deletion must still produce a tombstone after that failure.
        check(prefs.edit().putStringSet(knownKey, (known + currentIds).filterNot { deleted.has(it) }.toSet()).commit()) { "Could not save conversation sync state" }
        val response = exchange(pairing, JSONObject().put("mode","conversation_sync").put("records",outgoing).put("cursor",cursor))
        // The owner can delete while the network request is in flight. Do not
        // restore a just-deleted conversation from that request's stale reply.
        val remainingIds = dao.getAllSessions().map { it.id }.toSet()
        for (id in currentIds - remainingIds) if (!deleted.has(id)) {
            val now = System.currentTimeMillis()
            deleted.put(id, JSONObject().put("id",id).put("title","Deleted conversation").put("createdAt",now).put("updatedAt",now).put("deletedAt",now))
        }
        if (cursor == 0) cycleVersion = response.optString("version")
        for (row in included) fingerprints.put(key(row), fingerprint(row))
        val remote = response.getJSONArray("records")
        val imported = mutableSetOf<String>()
        for (index in 0 until remote.length()) {
            val row = remote.getJSONObject(index); val value = row.getJSONObject("value"); val id = value.getString("id")
            when (row.getString("kind")) {
                "delete" -> { deleted.put(id,value); dao.clearMessagesForSession(id); dao.deleteSessionById(id) }
                "conversation" -> if (!deleted.has(id)) {
                    val local = dao.getSessionById(id)
                    if (local == null || value.getLong("updatedAt") > local.sharedUpdatedAt) dao.upsertSession(ChatSessionEntity(id, value.getLong("createdAt"), local?.speechModeEnabled ?: false, local?.agentToolsEnabled ?: true, value.optString("title"), value.getLong("updatedAt")))
                    imported.add(id)
                }
                "message", "message_part" -> {
                    val conversationId = row.getString("conversationId")
                    if (!deleted.has(conversationId) && dao.getSessionById(conversationId) != null && dao.getMessageById(id) == null) {
                        val partsKey = "parts:${pairing.brainId}:$conversationId:$id"
                        val content = if (row.getString("kind") == "message_part") {
                            val parts = JSONObject(prefs.getString(partsKey, "{}")!!)
                            val complete = PairedSyncRecords.addPart(parts, value)
                            check(prefs.edit().putString(partsKey, parts.toString()).commit()) { "Could not save message chunks" }
                            complete ?: continue
                        } else value.getString("content")
                        val role = when(value.getString("role").lowercase()) { "user" -> "USER"; "assistant" -> "ASSISTANT"; else -> "SYSTEM" }
                        val provenance = value.optString("provenance").takeIf { it in setOf("OWNER","JUNCTION","UNTRUSTED") } ?: "UNTRUSTED"
                        dao.insertMessage(ChatMessageEntity(id, conversationId, value.getLong("createdAt"), role, content, provenance, "shared:paired:$id"))
                        prefs.edit().remove(partsKey).apply()
                    }
                }
            }
        }
        prefs.edit().putString("sent:${pairing.brainId}", fingerprints.toString()).putString(deletedKey,deleted.toString()).putStringSet(knownKey, (known + currentIds + imported).filterNot { deleted.has(it) }.toSet()).apply()
        val next = response.optInt("nextCursor")
        if (next == 0 && cycleVersion == response.optString("version")) prefs.edit().putString("version:${pairing.brainId}", cycleVersion).apply()
        return next
    }

    private suspend fun exchange(pairing: LocalBrainPairing, payload: JSONObject): JSONObject = withTimeout(45_000) {
        val uid = LocalBrainPairingStore.ensureAnonymous(context)
        check(uid == pairing.clientUid) { "Pair this phone again after changing Google accounts." }
        val firestore = FirebaseProvider.firestoreOrNull() ?: error("Firebase is unavailable")
        val id = UUID.randomUUID().toString()
        val encrypted = LocalBrainPairingStore.encrypt(pairing.key, "JBP1|${pairing.brainId}|$id|request", payload.toString())
        val ref = firestore.collection("local_brains").document(pairing.brainId).collection("commands").document(id)
        ref.set(mapOf("id" to id,"clientUid" to uid,"status" to "pending","ciphertext" to encrypted.first,"nonce" to encrypted.second,"createdAt" to Timestamp.now(),"source" to "junction_local_llm_v2")).await()
        val response = suspendCancellableCoroutine<String> { continuation ->
            var listener: ListenerRegistration? = null
            listener = ref.addSnapshotListener { snapshot, failure ->
                if (!continuation.isActive) return@addSnapshotListener
                if (failure != null) { listener?.remove(); continuation.resumeWithException(failure); return@addSnapshotListener }
                when(snapshot?.getString("status")) {
                    "done" -> { listener?.remove(); runCatching { LocalBrainPairingStore.decrypt(pairing.key,"JBP1|${pairing.brainId}|$id|response",snapshot.getString("responseCiphertext")!!,snapshot.getString("responseNonce")!!) }.fold({continuation.resume(it)},{continuation.resumeWithException(it)}) }
                    "error" -> { listener?.remove(); continuation.resumeWithException(IllegalStateException(snapshot.getString("error"))) }
                }
            }
            continuation.invokeOnCancellation { listener?.remove() }
        }
        JSONObject(response)
    }
}
