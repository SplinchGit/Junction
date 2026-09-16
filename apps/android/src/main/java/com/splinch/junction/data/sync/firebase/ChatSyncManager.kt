package com.splinch.junction.data.sync.firebase

import android.content.Context
import android.provider.Settings
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.SetOptions
import com.splinch.junction.data.database.chat.ChatDao
import com.splinch.junction.data.database.chat.ChatMessageEntity
import com.splinch.junction.data.database.chat.ChatSessionEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.isActive
import org.json.JSONArray
import org.json.JSONObject

/** Account-scoped, context-only conversation convergence. Imported turns never trigger a send or tool. */
class ChatSyncManager(context: Context, private val chatDao: ChatDao, private val authManager: AuthManager) {
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val deviceId = "android-" + Settings.Secure.getString(appContext.contentResolver, Settings.Secure.ANDROID_ID)
    private val outbox = appContext.getSharedPreferences("junction_chat_sync_outbox", Context.MODE_PRIVATE)
    private var currentUserId: String? = null
    private var activeConversationId: String? = null
    private var authJob: Job? = null
    private var retryJob: Job? = null

    fun enqueueSession(session: ChatSessionEntity) { scope.launch { runCatching { withTimeout(15_000) { onLocalSessionSaved(session) } } } }
    fun enqueueMessage(id: String, message: ChatMessageEntity) { scope.launch { runCatching { withTimeout(15_000) { onLocalMessageAppended(id, message) } } } }
    fun enqueueRename(id: String, title: String) { scope.launch { runCatching { withTimeout(15_000) { renameConversation(id, title) } } } }
    private var conversationListener: ListenerRegistration? = null
    private val messageListeners = mutableMapOf<String, ListenerRegistration>()

    fun start() {
        if (authJob != null) return
        authJob = scope.launch {
            authManager.userFlow.collectLatest { user ->
                stopUserWork()
                val uid = user?.uid?.takeIf { authManager.claimSyncOwner(it) } ?: return@collectLatest
                currentUserId = uid
                attachConversationShelf(uid)
                retryJob = scope.launch {
                    while (isActive) {
                        runCatching { withTimeout(20_000) { flushTombstones(uid); backfillLocal(uid) } }
                        delay(15_000)
                    }
                }
            }
        }
    }

    fun stop() { authJob?.cancel(); authJob = null; stopUserWork() }
    fun setActiveConversation(conversationId: String) { activeConversationId = conversationId }

    suspend fun onLocalSessionSaved(session: ChatSessionEntity) {
        val uid = currentUserId ?: return
        if (pendingTombstones(uid).any { it.id == session.id }) return
        putConversation(uid, session)
    }

    suspend fun onLocalMessageAppended(conversationId: String, message: ChatMessageEntity) {
        val uid = currentUserId ?: return
        val session = chatDao.getSessionById(conversationId) ?: return
        if (pendingTombstones(uid).any { it.id == conversationId }) return
        chatDao.updateSharedTimestamp(conversationId, message.timestamp)
        putConversation(uid, session.copy(sharedUpdatedAt = message.timestamp))
        putMessage(uid, conversationId, message)
    }

    suspend fun updateConversationMetadata(conversationId: String, speechModeEnabled: Boolean, agentToolsEnabled: Boolean) {
        // Speech/tool toggles stay device-local.
        chatDao.getSessionById(conversationId)?.let { onLocalSessionSaved(it) }
    }

    suspend fun renameConversation(conversationId: String, title: String) {
        val uid = currentUserId ?: return
        val session = chatDao.getSessionById(conversationId) ?: return
        putConversation(uid, session.copy(title = title.take(80), sharedUpdatedAt = System.currentTimeMillis()))
    }

    suspend fun tombstoneConversation(conversationId: String) {
        val uid = currentUserId ?: authManager.boundSyncOwner() ?: return
        val session = chatDao.getSessionById(conversationId)
        val now = System.currentTimeMillis()
        saveTombstone(uid, PendingTombstone(conversationId, now, session?.startedAt ?: now, session?.title ?: "Deleted conversation"))
        if (currentUserId == uid) scope.launch { runCatching { flushTombstones(uid) } }
    }

    private suspend fun backfillLocal(uid: String) {
        val deleted = pendingTombstones(uid).mapTo(mutableSetOf()) { it.id }
        for (session in chatDao.getAllSessions()) {
            if (session.id in deleted) continue
            putConversation(uid, session)
            chatDao.getMessages(session.id)
                .filterNot { it.sourceRef?.startsWith("shared:") == true }
                .forEach { putMessage(uid, session.id, it) }
        }
    }

    private fun attachConversationShelf(uid: String) {
        val firestore = FirebaseProvider.firestoreOrNull() ?: return
        conversationListener = firestore.collection("users").document(uid).collection("shared_conversations").limit(200)
            .addSnapshotListener { snapshot, _ ->
                snapshot ?: return@addSnapshotListener
                scope.launch {
                    for (doc in snapshot.documents) {
                        val data = doc.data ?: continue
                        val deletedAt = (data["deletedAt"] as? Number)?.toLong()
                        if (deletedAt != null) {
                            messageListeners.remove(doc.id)?.remove()
                            chatDao.clearMessagesForSession(doc.id)
                            chatDao.deleteSessionById(doc.id)
                            removeTombstone(uid, doc.id)
                            continue
                        }
                        val remoteUpdatedAt = (data["updatedAt"] as? Number)?.toLong() ?: continue
                        val local = chatDao.getSessionById(doc.id)
                        if (local == null || remoteUpdatedAt > local.sharedUpdatedAt) {
                            chatDao.upsertSession(ChatSessionEntity(
                                id = doc.id,
                                startedAt = (data["createdAt"] as? Number)?.toLong() ?: remoteUpdatedAt,
                                speechModeEnabled = local?.speechModeEnabled ?: false,
                                agentToolsEnabled = local?.agentToolsEnabled ?: true,
                                title = (data["title"] as? String)?.take(80),
                                sharedUpdatedAt = remoteUpdatedAt
                            ))
                        }
                        attachMessageListener(uid, doc.id)
                    }
                }
            }
    }

    private fun attachMessageListener(uid: String, conversationId: String) {
        if (messageListeners.containsKey(conversationId)) return
        messageListeners[conversationId] = conversationRef(uid, conversationId).collection("messages").limit(200)
            .addSnapshotListener { snapshot, _ ->
                snapshot ?: return@addSnapshotListener
                scope.launch {
                    for (doc in snapshot.documents) {
                        if (chatDao.getMessageById(doc.id) != null) continue
                        val data = doc.data ?: continue
                        val content = (data["content"] as? String)?.take(20_000) ?: continue
                        val provenance = (data["provenance"] as? String)?.takeIf { it in VALID_PROVENANCE } ?: "UNTRUSTED"
                        val sourceRef = (data["sourceRef"] as? String)?.take(500) ?: "shared:firestore:${doc.id}"
                        chatDao.insertMessage(ChatMessageEntity(
                            id = doc.id,
                            sessionId = conversationId,
                            timestamp = (data["createdAt"] as? Number)?.toLong() ?: System.currentTimeMillis(),
                            sender = senderValue(data["role"] as? String),
                            content = content,
                            provenance = provenance,
                            sourceRef = sourceRef
                        ))
                    }
                }
            }
    }

    private suspend fun putConversation(uid: String, session: ChatSessionEntity) {
        val title = (session.title ?: chatDao.lastMessageContent(session.id)?.take(60) ?: "New conversation").take(80)
        val ref = conversationRef(uid, session.id)
        val existing = ref.get().await()
        if (existing.get("deletedAt") != null) return
        val remoteUpdatedAt = (existing.get("updatedAt") as? Number)?.toLong()
        if (remoteUpdatedAt != null && remoteUpdatedAt > session.sharedUpdatedAt) return
        val creator = (existing.get("createdByDeviceId") as? String)?.take(160) ?: deviceId.take(160)
        ref.set(mapOf(
            "id" to session.id,
            "title" to title,
            "createdAt" to session.startedAt,
            "updatedAt" to session.sharedUpdatedAt.coerceAtLeast(session.startedAt),
            "createdByDeviceId" to creator,
            "schemaVersion" to 1,
            // Never clear a deletion made concurrently on another device.
        ), SetOptions.merge()).await()
    }

    private suspend fun putMessage(uid: String, conversationId: String, message: ChatMessageEntity) {
        conversationRef(uid, conversationId).collection("messages").document(message.id).set(mapOf(
            "id" to message.id,
            "role" to message.sender,
            "content" to message.content.take(20_000),
            "createdAt" to message.timestamp,
            "provenance" to (message.provenance.takeIf { it in VALID_PROVENANCE } ?: "UNTRUSTED"),
            "sourceRef" to (message.sourceRef ?: "shared:android:${message.id}").take(500),
            "deviceId" to deviceId,
            "schemaVersion" to 1
        )).await()
    }

    private suspend fun flushTombstones(uid: String) {
        for (item in pendingTombstones(uid)) {
            val ref = conversationRef(uid, item.id)
            val existing = ref.get().await()
            if (existing.exists() && existing.get("deletedAt") != null) { removeTombstone(uid, item.id); continue }
            val creator = (existing.get("createdByDeviceId") as? String)?.take(160) ?: deviceId.take(160)
            ref.set(mapOf(
                "id" to item.id,
                "title" to item.title.take(80),
                "createdAt" to item.createdAt,
                "updatedAt" to item.deletedAt,
                "createdByDeviceId" to creator,
                "schemaVersion" to 1,
                "deletedAt" to item.deletedAt
            ), SetOptions.merge()).await()
            removeTombstone(uid, item.id)
        }
    }

    private fun conversationRef(uid: String, id: String): DocumentReference = FirebaseProvider.firestoreOrNull()!!
        .collection("users").document(uid).collection("shared_conversations").document(id)

    private fun stopUserWork() {
        retryJob?.cancel(); retryJob = null
        currentUserId = null
        conversationListener?.remove(); conversationListener = null
        messageListeners.values.forEach { it.remove() }; messageListeners.clear()
    }

    private data class PendingTombstone(val id: String, val deletedAt: Long, val createdAt: Long, val title: String)
    private fun pendingTombstones(uid: String): List<PendingTombstone> {
        val rows = runCatching { JSONArray(outbox.getString("tombstones:$uid", "[]")) }.getOrDefault(JSONArray())
        return buildList {
            for (index in 0 until rows.length()) {
                val row = rows.optJSONObject(index) ?: continue
                val id = row.optString("id")
                if (id.isNotBlank()) add(PendingTombstone(id, row.optLong("deletedAt"), row.optLong("createdAt"), row.optString("title", "Deleted conversation")))
            }
        }
    }
    private fun saveTombstone(uid: String, item: PendingTombstone) = writeTombstones(uid, pendingTombstones(uid).filterNot { it.id == item.id } + item)
    private fun removeTombstone(uid: String, id: String) = writeTombstones(uid, pendingTombstones(uid).filterNot { it.id == id })
    private fun writeTombstones(uid: String, values: List<PendingTombstone>) {
        val rows = JSONArray()
        values.forEach { rows.put(JSONObject().put("id", it.id).put("deletedAt", it.deletedAt).put("createdAt", it.createdAt).put("title", it.title)) }
        outbox.edit().putString("tombstones:$uid", rows.toString()).apply()
    }
    private fun senderValue(value: String?): String = when (value?.uppercase()) { "USER" -> "USER"; "ASSISTANT", "MODEL" -> "ASSISTANT"; else -> "SYSTEM" }

    companion object { private val VALID_PROVENANCE = setOf("OWNER", "JUNCTION", "UNTRUSTED") }
}
