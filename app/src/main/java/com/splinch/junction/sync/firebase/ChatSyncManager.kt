package com.splinch.junction.sync.firebase

import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.SetOptions
import com.splinch.junction.data.ChatDao
import com.splinch.junction.data.ChatMessageEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

class ChatSyncManager(
    private val chatDao: ChatDao,
    private val authManager: AuthManager
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var currentUserId: String? = null
    private var activeConversationId: String? = null
    private var messageListener: ListenerRegistration? = null

    fun start() {
        scope.launch {
            authManager.userFlow.collectLatest { user ->
                currentUserId = user?.uid
                if (user == null) {
                    stopListening()
                } else {
                    attachListenerIfReady()
                }
            }
        }
    }

    fun stop() {
        stopListening()
    }

    fun setActiveConversation(conversationId: String) {
        if (conversationId == activeConversationId) return
        activeConversationId = conversationId
        attachListenerIfReady()
    }

    suspend fun onLocalMessageAppended(conversationId: String, message: ChatMessageEntity) {
        val uid = currentUserId ?: return
        val conversationRef = FirebaseProvider.firestore
            .collection("users")
            .document(uid)
            .collection("conversations")
            .document(conversationId)

        val conversationData = mapOf(
            "id" to conversationId,
            "updatedAt" to message.timestamp
        )

        conversationRef.set(conversationData, SetOptions.merge())
        conversationRef.collection("messages")
            .document(message.id)
            .set(
                mapOf(
                    "id" to message.id,
                    "role" to message.sender,
                    "content" to message.content,
                    "createdAt" to message.timestamp
                ),
                SetOptions.merge()
            )
    }

    private fun attachListenerIfReady() {
        val uid = currentUserId ?: return
        val conversationId = activeConversationId ?: return

        stopListening()

        messageListener = FirebaseProvider.firestore
            .collection("users")
            .document(uid)
            .collection("conversations")
            .document(conversationId)
            .collection("messages")
            .addSnapshotListener { snapshot, _ ->
                if (snapshot == null) return@addSnapshotListener
                scope.launch {
                    for (doc in snapshot.documents) {
                        val id = doc.id
                        val data = doc.data ?: continue
                        if (chatDao.getMessageById(id) != null) continue
                        val message = ChatMessageEntity(
                            id = id,
                            sessionId = conversationId,
                            timestamp = (data["createdAt"] as? Number)?.toLong() ?: System.currentTimeMillis(),
                            sender = data["role"] as? String ?: "USER",
                            content = data["content"] as? String ?: ""
                        )
                        chatDao.insertMessage(message)
                    }
                }
            }
    }

    private fun stopListening() {
        messageListener?.remove()
        messageListener = null
    }
}
