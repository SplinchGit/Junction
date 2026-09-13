package com.splinch.junction.assistant.provider

import com.google.firebase.Timestamp
import com.splinch.junction.assistant.context.ContextBlock
import com.splinch.junction.assistant.tools.ToolDefinition
import com.splinch.junction.data.sync.firebase.FirebaseProvider
import com.splinch.junction.data.sync.firebase.LocalBrainPairingStore
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** First-class provider backed by a paired PC Junction brain, never a raw PC URL. */
class JunctionPcProvider : LlmProvider {
    override val id = "local"
    override val workhorseModel = "qwen3:1.7b"
    override val frontierModel: String? = null

    override fun act(context: List<ContextBlock>, tools: List<ToolDefinition>, useFrontier: Boolean): Flow<LlmEvent> = callbackFlow {
        val appContext = FirebaseProvider.applicationContextOrNull()
        val pairing = appContext?.let { LocalBrainPairingStore.load(it) }
        if (appContext == null || pairing == null) {
            trySend(LlmEvent.Error("Pair this phone with your Junction PC in Settings to use Local LLM.")); trySend(LlmEvent.Done); close(); return@callbackFlow
        }
        try {
            val uid = LocalBrainPairingStore.ensureAnonymous(appContext)
            if (uid != pairing.clientUid) error("This phone's Junction pairing has changed. Pair it again from Settings.")
            val firestore = FirebaseProvider.firestoreOrNull() ?: error("Firebase is unavailable.")
            val requestId = UUID.randomUUID().toString()
            val messages = JSONArray().also { output -> context.takeLast(MAX_CONTEXT_BLOCKS).forEach { block -> output.put(JSONObject().apply { put("role", block.role); put("content", block.content.take(MAX_BLOCK_CHARS)) }) } }
            val plain = JSONObject().apply { put("model", workhorseModel); put("messages", messages) }.toString()
            val (ciphertext, nonce) = LocalBrainPairingStore.encrypt(pairing.key, "JBP1|${pairing.brainId}|$requestId|request", plain)
            val document = firestore.collection("local_brains").document(pairing.brainId).collection("commands").document(requestId)
            document.set(mapOf("id" to requestId, "clientUid" to uid, "status" to "pending", "ciphertext" to ciphertext, "nonce" to nonce, "createdAt" to Timestamp.now(), "source" to SOURCE)).await()
            val registration = document.addSnapshotListener { snapshot, failure ->
                if (failure != null) { trySend(LlmEvent.Error("Local Junction connection interrupted: ${failure.message}")); trySend(LlmEvent.Done); close(); return@addSnapshotListener }
                if (snapshot == null) return@addSnapshotListener
                when (snapshot.getString("status")) {
                    "done" -> runCatching {
                        val response = LocalBrainPairingStore.decrypt(pairing.key, "JBP1|${pairing.brainId}|$requestId|response", snapshot.getString("responseCiphertext").orEmpty(), snapshot.getString("responseNonce").orEmpty())
                        trySend(LlmEvent.TextDelta(response)); trySend(LlmEvent.Done); close()
                    }.onFailure { trySend(LlmEvent.Error("Local Junction returned an invalid encrypted response.")); trySend(LlmEvent.Done); close() }
                    "error" -> { trySend(LlmEvent.Error(snapshot.getString("error") ?: "Your Junction PC could not run the local model.")); trySend(LlmEvent.Done); close() }
                }
            }
            awaitClose { registration.remove() }
        } catch (error: Exception) { trySend(LlmEvent.Error(error.message ?: "Could not contact your Junction PC.")); trySend(LlmEvent.Done); close() }
    }

    override suspend fun readUntrusted(content: String, sourceHint: String) = null
    private companion object { const val SOURCE = "junction_local_llm_v2"; const val MAX_CONTEXT_BLOCKS = 18; const val MAX_BLOCK_CHARS = 4_000 }
}
