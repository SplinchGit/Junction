package com.splinch.junction.data.sync.firebase

import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.SetOptions
import com.splinch.junction.assistant.conversation.senderFromString
import com.splinch.junction.data.database.chat.ChatDao
import com.splinch.junction.data.database.chat.ChatMessageEntity
import com.splinch.junction.data.database.chat.ChatSessionEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

class ChatSyncManager(
    private val chatDao: ChatDao,
    private val authManager: AuthManager
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var currentUserId: String? = null
    private var activeConversationId: String? = null
    private var messageListener: ListenerRegistration? = null
    private var conversationListener: ListenerRegistration? = null
    private var authJob: Job? = null

    fun start() {
        if (authJob != null) return
        authJob = scope.launch {
            authManager.userFlow.collectLatest { user ->
                currentUserId = user?.uid
                if (user == null) {
                    stopAllListeners()
                } else {
                    attachConversationShelf(user.uid)
                    attachListenerIfReady()
                }
            }
        }
    }

    fun stop() {
        authJob?.cancel()
        authJob = null
        currentUserId = null
        stopAllListeners()
    }

    fun setActiveConversation(conversationId: String) {
        if (conversationId == activeConversationId) return
        activeConversationId = conversationId
        attachListenerIfReady()
    }

    suspend fun onLocalMessageAppended(conversationId: String, message: ChatMessageEntity) {
        val uid = currentUserId ?: return
        val firestore = FirebaseProvider.firestoreOrNull() ?: return
        val conversationRef = firestore
            .collection("users")
            .document(uid)
            .collection("shared_conversations")
            .document(conversationId)

        val session = chatDao.getSessionById(conversationId)
        val conversationData = mapOf(
            "id" to conversationId,
            "title" to (session?.title ?: "New conversation"),
            "createdAt" to (session?.startedAt ?: message.timestamp),
            "updatedAt" to message.timestamp,
            "createdByDeviceId" to "owner",
            "schemaVersion" to 1,
            // Do not write a null tombstone during a normal append: merge writes
            // must never resurrect a conversation deleted on another device.
        )

        conversationRef.set(conversationData, SetOptions.merge()).await()
        conversationRef.collection("messages")
            .document(message.id)
            .set(
                mapOf(
                    "id" to message.id,
                    "role" to message.sender,
                    "content" to message.content,
                    "createdAt" to message.timestamp,
                    "provenance" to message.provenance,
                    "sourceRef" to (message.sourceRef ?: "shared:android:${message.id}"),
                    "deviceId" to "android",
                    "schemaVersion" to 1
                ),
                SetOptions.merge()
            ).await()
    }

    suspend fun updateConversationMetadata(
        conversationId: String,
        speechModeEnabled: Boolean,
        agentToolsEnabled: Boolean
    ) {
        val uid = currentUserId ?: return
        val firestore = FirebaseProvider.firestoreOrNull() ?: return
        firestore
            .collection("users")
            .document(uid)
            .collection("shared_conversations")
            .document(conversationId)
            .set(
                mapOf(
                    "updatedAt" to System.currentTimeMillis()
                ),
                SetOptions.merge()
            ).await()
    }

    suspend fun renameConversation(conversationId: String, title: String) {
        val uid = currentUserId ?: return
        val firestore = FirebaseProvider.firestoreOrNull() ?: return
        firestore.collection("users").document(uid).collection("shared_conversations")
            .document(conversationId).update(mapOf("title" to title.take(80), "updatedAt" to System.currentTimeMillis())).await()
    }

    suspend fun tombstoneConversation(conversationId: String) {
        val uid = currentUserId ?: return
        val firestore = FirebaseProvider.firestoreOrNull() ?: return
        val now = System.currentTimeMillis()
        firestore.collection("users").document(uid).collection("shared_conversations")
            .document(conversationId).update(mapOf("deletedAt" to now, "updatedAt" to now)).await()
    }

    /** Reconciles the durable shelf so chats created on Windows appear on Android. */
    private fun attachConversationShelf(uid: String) {
        conversationListener?.remove()
        val firestore = FirebaseProvider.firestoreOrNull() ?: return
        conversationListener = firestore.collection("users").document(uid)
            .collection("shared_conversations")
            .addSnapshotListener { snapshot, _ ->
                snapshot?.documents?.forEach { doc ->
                    scope.launch {
                        val data = doc.data ?: return@launch
                        if (data["deletedAt"] != null) {
                            chatDao.clearMessagesForSession(doc.id)
                            chatDao.deleteSessionById(doc.id)
                            return@launch
                        }
                        val existing = chatDao.getSessionById(doc.id)
                        val title = (data["title"] as? String)?.take(80)
                        chatDao.upsertSession(
                            ChatSessionEntity(
                                id = doc.id,
                                startedAt = (data["createdAt"] as? Number)?.toLong()
                                    ?: existing?.startedAt
                                    ?: System.currentTimeMillis(),
                                speechModeEnabled = existing?.speechModeEnabled ?: false,
                                agentToolsEnabled = existing?.agentToolsEnabled ?: true,
                                title = title ?: existing?.title
                            )
                        )
                        val remoteMessages = doc.reference.collection("messages").limit(500).get().await()
                        for (messageDoc in remoteMessages.documents) importMessage(doc.id, messageDoc.id, messageDoc.data ?: continue)
                    }
                }
            }
    }

    private suspend fun importMessage(conversationId: String, id: String, data: Map<String, Any>) {
        if (chatDao.getMessageById(id) != null) return
        chatDao.insertMessage(
            ChatMessageEntity(
                id = id,
                sessionId = conversationId,
                timestamp = (data["createdAt"] as? Number)?.toLong() ?: System.currentTimeMillis(),
                sender = senderFromString(data["role"] as? String).name,
                content = (data["content"] as? String)?.take(20000) ?: "",
                provenance = (data["provenance"] as? String)
                    ?.takeIf { it in setOf("OWNER", "JUNCTION", "UNTRUSTED") }
                    ?: "UNTRUSTED",
                sourceRef = (data["sourceRef"] as? String)
                    ?.takeIf { it.isNotBlank() }
                    ?: "shared:firestore:$id"
            )
        )
    }

    private fun attachListenerIfReady() {
        val uid = currentUserId ?: return
        val conversationId = activeConversationId ?: return
        val firestore = FirebaseProvider.firestoreOrNull() ?: return

        stopListening()

        messageListener = firestore
            .collection("users")
            .document(uid)
            .collection("shared_conversations")
            .document(conversationId)
            .collection("messages")
            .addSnapshotListener { snapshot, _ ->
                if (snapshot == null) return@addSnapshotListener
                scope.launch {
                    for (doc in snapshot.documents) {
                        val id = doc.id
                        val data = doc.data ?: continue
                        importMessage(conversationId, id, data)
                    }
                }
            }
    }

    private fun stopListening() {
        messageListener?.remove()
        messageListener = null
    }

    private fun stopAllListeners() {
        stopListening()
        conversationListener?.remove()
        conversationListener = null
    }
}
