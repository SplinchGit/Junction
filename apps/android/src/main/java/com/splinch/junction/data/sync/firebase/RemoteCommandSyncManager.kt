package com.splinch.junction.data.sync.firebase

import android.util.Log
import com.google.firebase.firestore.DocumentChange
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.ListenerRegistration
import com.splinch.junction.assistant.runtime.ChatManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

/**
 * A separate, purpose-built companion channel: a command written to
 * `users/{uid}/remote_commands` while signed in as the owner is treated as a
 * real owner instruction and run through [ChatManager.sendUserMessage] --
 * the same path a message typed on the phone takes.
 *
 * Deliberately not the same collection [ChatSyncManager] mirrors: that one's
 * security rules hard-code every synced message to UNTRUSTED provenance, by
 * design, so it can never act as a command. This is a distinct, narrowly
 * scoped channel for that purpose instead of loosening that boundary.
 */
class RemoteCommandSyncManager(
    private val chatManager: ChatManager,
    private val authManager: AuthManager
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var currentUserId: String? = null
    private var listener: ListenerRegistration? = null

    fun start() {
        scope.launch {
            authManager.userFlow.collectLatest { user ->
                currentUserId = user?.uid
                if (user == null) stopListening() else attachListener()
            }
        }
    }

    fun stop() {
        stopListening()
    }

    private fun attachListener() {
        val uid = currentUserId ?: return
        val firestore = FirebaseProvider.firestoreOrNull() ?: return

        stopListening()

        listener = firestore
            .collection("users")
            .document(uid)
            .collection("remote_commands")
            .whereEqualTo("status", "pending")
            .addSnapshotListener { snapshot, error ->
                if (error != null || snapshot == null) return@addSnapshotListener
                for (change in snapshot.documentChanges) {
                    if (change.type != DocumentChange.Type.ADDED) continue
                    val doc = change.document
                    val content = doc.getString("content")?.trim().orEmpty()
                    if (content.isBlank()) continue
                    scope.launch { execute(doc.reference, content) }
                }
            }
    }

    private suspend fun execute(ref: DocumentReference, content: String) {
        // Best-effort claim; single-owner, low-volume usage doesn't need a
        // transaction to be safe here, just to avoid the common double-fire.
        runCatching { ref.update("status", "processing").await() }

        runCatching {
            chatManager.sendUserMessage(content)
        }.onSuccess {
            runCatching { ref.update("status", "done").await() }
        }.onFailure { ex ->
            Log.e(TAG, "Remote command failed", ex)
            runCatching {
                ref.update(mapOf("status" to "error", "error" to (ex.message ?: "Unknown error"))).await()
            }
        }
    }

    private fun stopListening() {
        listener?.remove()
        listener = null
    }

    private companion object {
        const val TAG = "RemoteCommandSync"
    }
}
