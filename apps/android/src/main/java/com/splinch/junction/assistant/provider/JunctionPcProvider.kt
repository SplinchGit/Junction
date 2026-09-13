package com.splinch.junction.assistant.provider

import com.google.firebase.Timestamp
import com.splinch.junction.assistant.context.ContextBlock
import com.splinch.junction.assistant.context.ReaderOutput
import com.splinch.junction.assistant.tools.ToolDefinition
import com.splinch.junction.data.sync.firebase.FirebaseProvider
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.Dispatchers
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * The local-model provider is a Junction provider, not a phone-to-PC URL.
 *
 * It sends one bounded owner turn through Junction's existing authenticated
 * remote-command channel. A signed-in PC claims the request, talks to its
 * loopback-only model service, and returns one final response. No endpoint,
 * model-service credential, router port, or VPN app is configured on Android.
 */
class JunctionPcProvider : LlmProvider {
    override val id = "local"
    override val workhorseModel = "qwen3:1.7b"
    override val frontierModel: String? = null

    override fun act(
        context: List<ContextBlock>,
        tools: List<ToolDefinition>,
        useFrontier: Boolean
    ): Flow<LlmEvent> = callbackFlow {
        val auth = FirebaseProvider.authOrNull()
        val firestore = FirebaseProvider.firestoreOrNull()
        val uid = auth?.currentUser?.uid
        if (firestore == null || uid.isNullOrBlank()) {
            trySend(LlmEvent.Error("Local LLM needs your Junction account connected on this phone and PC."))
            trySend(LlmEvent.Done)
            close()
            return@callbackFlow
        }

        val requestId = UUID.randomUUID().toString()
        val document = firestore.collection("users").document(uid)
            .collection("remote_commands").document(requestId)
        val messages = JSONArray()
        context.takeLast(MAX_CONTEXT_BLOCKS).forEach { block ->
            messages.put(JSONObject().apply {
                put("role", block.role)
                put("content", block.content.take(MAX_BLOCK_CHARS))
            })
        }
        val payload = JSONObject().apply {
            put("model", workhorseModel)
            put("messages", messages)
        }.toString()

        document.set(
            mapOf(
                "content" to payload,
                "status" to "pending",
                "createdAt" to Timestamp.now(),
                "source" to SOURCE
            )
        ).addOnFailureListener { error ->
            trySend(LlmEvent.Error(error.message ?: "Could not contact your Junction PC."))
            trySend(LlmEvent.Done)
            close(error)
        }

        val registration = document.addSnapshotListener { snapshot, error ->
            if (error != null) {
                trySend(LlmEvent.Error(error.message ?: "Lost the Junction PC connection."))
                trySend(LlmEvent.Done)
                close(error)
                return@addSnapshotListener
            }
            when (snapshot?.getString("status")) {
                "done" -> {
                    val response = snapshot.getString("assistantResponse").orEmpty()
                    if (response.isBlank()) trySend(LlmEvent.Error("Your Junction PC returned an empty response."))
                    else trySend(LlmEvent.TextDone(response))
                    trySend(LlmEvent.Done)
                    document.delete() // One-shot relay records are never retained as chat history.
                    close()
                }
                "error" -> {
                    trySend(LlmEvent.Error(snapshot.getString("error") ?: "Your Junction PC could not run the local model."))
                    trySend(LlmEvent.Done)
                    document.delete()
                    close()
                }
            }
        }
        awaitClose { registration.remove() }
    }.flowOn(Dispatchers.IO)

    override suspend fun readUntrusted(content: String, sourceHint: String): ReaderOutput? = null

    companion object {
        const val SOURCE = "junction_local_llm"
        private const val MAX_CONTEXT_BLOCKS = 24
        private const val MAX_BLOCK_CHARS = 8_000
    }
}
