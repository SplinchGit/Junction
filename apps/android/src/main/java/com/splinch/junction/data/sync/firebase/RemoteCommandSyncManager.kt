package com.splinch.junction.data.sync.firebase

import android.util.Log
import com.google.firebase.firestore.DocumentChange
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.splinch.junction.assistant.runtime.ChatManager
import com.splinch.junction.assistant.runtime.TurnOutcome
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull

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
    private var authJob: Job? = null

    /**
     * Cancels any previous auth-watching job first, so calling this more than once (the
     * service restarting after a stop/start cycle, or a stray double-call) can't leave two
     * collectors racing to attach/detach the same [listener] field.
     */
    fun start() {
        authJob?.cancel()
        authJob = scope.launch {
            authManager.userFlow.collectLatest { user ->
                currentUserId = user?.uid
                if (user == null) stopListening() else attachListener()
            }
        }
    }

    fun stop() {
        authJob?.cancel()
        authJob = null
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
                    // Not just ADDED: a listener reattach (reconnect, auth refresh, process
                    // restart) replays every currently-pending document as ADDED again, and
                    // MODIFIED can fire for a doc this same listener already claimed a moment
                    // ago (its own "processing" write echoing back). Claiming is what actually
                    // prevents double execution -- see claim() -- this filter just avoids
                    // pointless claim attempts on documents we didn't just start watching.
                    if (change.type == DocumentChange.Type.REMOVED) continue
                    val doc = change.document
                    scope.launch { handle(firestore, doc.reference) }
                }
            }
    }

    private suspend fun handle(firestore: FirebaseFirestore, ref: DocumentReference) {
        if (!claim(firestore, ref)) return // already claimed, no longer pending, or a transient failure

        val snapshot = runCatching { ref.get().await() }.getOrNull() ?: return
        val content = snapshot.getString("content")?.trim().orEmpty()
        val createdAtMs = snapshot.getTimestamp("createdAt")?.toDate()?.time

        if (content.isBlank()) {
            fail(ref, "Empty command")
            return
        }
        if (content.length > MAX_CONTENT_LENGTH) {
            fail(ref, "Command too long (max $MAX_CONTENT_LENGTH characters)")
            return
        }
        if (createdAtMs != null && System.currentTimeMillis() - createdAtMs > EXPIRY_MS) {
            runCatching { ref.update("status", "expired").await() }
            return
        }

        execute(ref, content)
    }

    /**
     * Atomically flips `pending` -> `processing`. Only the caller that wins this transaction
     * may execute the command, so a listener reattach or a duplicate snapshot delivery cannot
     * run the same command twice: whichever call loses the transaction sees a status other
     * than `pending` and backs off.
     */
    private suspend fun claim(firestore: FirebaseFirestore, ref: DocumentReference): Boolean {
        return try {
            firestore.runTransaction { txn ->
                val snap = txn.get(ref)
                if (snap.getString("status") != "pending") {
                    false
                } else {
                    txn.update(
                        ref,
                        mapOf(
                            "status" to "processing",
                            "claimedAt" to FieldValue.serverTimestamp()
                        )
                    )
                    true
                }
            }.await()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to claim remote command ${ref.id}", e)
            false
        }
    }

    private suspend fun execute(ref: DocumentReference, content: String) {
        val conversationId = chatManager.sessionId.value

        val outcomeDeferred = CompletableDeferred<TurnOutcome>()
        val sendResult = runCatching {
            chatManager.sendUserMessage(content) { outcome ->
                outcomeDeferred.complete(outcome)
            }
        }
        if (sendResult.isFailure) {
            fail(ref, sendResult.exceptionOrNull()?.message ?: "Unknown error", conversationId)
            return
        }

        val outcome = withTimeoutOrNull(TURN_TIMEOUT_MS) { outcomeDeferred.await() }
        if (outcome == null) {
            fail(ref, "Timed out waiting for a response", conversationId)
            return
        }

        if (outcome.errorMessage != null) {
            fail(ref, outcome.errorMessage, conversationId)
            return
        }

        runCatching {
            ref.update(
                mapOf(
                    "status" to if (outcome.approvalRequired) "awaiting_approval" else "done",
                    "assistantResponse" to (outcome.assistantText?.take(MAX_RESULT_CHARS) ?: ""),
                    "toolsRequested" to outcome.toolsRequested,
                    "toolsRan" to outcome.toolsRan,
                    "approvalRequired" to outcome.approvalRequired,
                    "conversationId" to conversationId,
                    "completedAt" to FieldValue.serverTimestamp()
                )
            ).await()
        }.onFailure { ex ->
            Log.e(TAG, "Failed to write remote command result", ex)
        }
    }

    private suspend fun fail(ref: DocumentReference, message: String, conversationId: String? = null) {
        Log.e(TAG, "Remote command ${ref.id} failed: $message")
        runCatching {
            val update = mutableMapOf<String, Any>(
                "status" to "error",
                "error" to message,
                "completedAt" to FieldValue.serverTimestamp()
            )
            if (conversationId != null) update["conversationId"] = conversationId
            ref.update(update).await()
        }
    }

    private fun stopListening() {
        listener?.remove()
        listener = null
    }

    private companion object {
        const val TAG = "RemoteCommandSync"
        const val MAX_CONTENT_LENGTH = 4000
        const val MAX_RESULT_CHARS = 4000
        const val TURN_TIMEOUT_MS = 120_000L
        const val EXPIRY_MS = 15 * 60 * 1000L
    }
}
