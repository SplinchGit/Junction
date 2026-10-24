package com.splinch.junction.assistant.provider

import com.google.firebase.Timestamp
import com.splinch.junction.assistant.context.ContextBlock
import com.splinch.junction.assistant.tools.ToolDefinition
import com.splinch.junction.data.sync.firebase.FirebaseProvider
import com.splinch.junction.data.sync.firebase.LocalBrainPairingStore
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.tasks.await
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** First-class provider backed by a paired PC Junction brain, never a raw PC URL. */
class JunctionPcProvider(override val workhorseModel: String = "qwen3:30b") : LlmProvider, ResearchCapableProvider {
    override val id = "local"
    override val frontierModel: String? = null

    override fun act(context: List<ContextBlock>, tools: List<ToolDefinition>, useFrontier: Boolean, conversationId: String?): Flow<LlmEvent> =
        actWithRequestId(context, conversationId, UUID.randomUUID().toString())

    override fun actWithResearch(context: List<ContextBlock>, tools: List<ToolDefinition>, useFrontier: Boolean, conversationId: String?, forceResearch: Boolean): Flow<LlmEvent> =
        actWithRequestId(context, conversationId, UUID.randomUUID().toString(), forceResearch)

    internal fun actWithRequestId(context: List<ContextBlock>, conversationId: String?, requestId: String, forceResearch: Boolean = false): Flow<LlmEvent> = callbackFlow {
        val appContext = FirebaseProvider.applicationContextOrNull()
        val pairing = appContext?.let { LocalBrainPairingStore.load(it) }
        if (appContext == null || pairing == null) {
            trySend(LlmEvent.Error("Pair this phone with your Junction PC in Settings to use Local LLM.")); trySend(LlmEvent.Done); close(); return@callbackFlow
        }
        try {
            trySend(LlmEvent.Activity("Connecting to your Junction PC"))
            val uid = withTimeout(15_000) { LocalBrainPairingStore.ensureAnonymous(appContext) }
            if (uid != pairing.clientUid) error("This phone's Junction pairing has changed. Pair it again from Settings.")
            val firestore = FirebaseProvider.firestoreOrNull() ?: error("Firebase is unavailable.")
            val brain = withTimeout(15_000) { firestore.collection("local_brains").document(pairing.brainId).get(com.google.firebase.firestore.Source.SERVER).await() }
            val lastSeenAtMs = brain.getLong("lastSeenAtMs") ?: 0L
            if (!brain.exists() || brain.getString("status") != "active" ||
                System.currentTimeMillis() - lastSeenAtMs > PC_ONLINE_WINDOW_MS
            ) {
                error(PC_OFFLINE_ERROR_MESSAGE)
            }
            val messages = JSONArray().also { output -> context.takeLast(MAX_CONTEXT_BLOCKS).forEach { block -> output.put(JSONObject().apply { put("role", block.role); put("content", block.content.take(MAX_BLOCK_CHARS)) }) } }
            val plain = JSONObject().apply {
                put("model", workhorseModel)
                put("messages", messages)
                conversationId?.let { put("conversationId", it) }
                put("mode", "agent")
                if (forceResearch) put("forceSearch", true)
                // Transient voice/text state for this turn; the host validates it again.
                com.splinch.junction.assistant.runtime.TurnSessionContext.current?.let { put("session", JSONObject(it.toPayload())) }
            }.toString()
            val (ciphertext, nonce) = LocalBrainPairingStore.encrypt(pairing.key, "JBP1|${pairing.brainId}|$requestId|request", plain)
            val document = firestore.collection("local_brains").document(pairing.brainId).collection("commands").document(requestId)
            withTimeout(15_000) { document.set(mapOf("id" to requestId, "clientUid" to uid, "status" to "pending", "ciphertext" to ciphertext, "nonce" to nonce, "createdAt" to Timestamp.now(), "source" to SOURCE)).await() }
            trySend(LlmEvent.Activity("Waiting for your Junction PC"))
            var terminal = false
            var streamedText = ""
            var streamSequence = 0L
            val registration = document.addSnapshotListener { snapshot, failure ->
                if (terminal) return@addSnapshotListener
                if (failure != null) { terminal = true; trySend(LlmEvent.Activity("")); trySend(LlmEvent.Error("Local Junction connection interrupted: ${failure.message}")); trySend(LlmEvent.Done); close(); return@addSnapshotListener }
                if (snapshot == null) return@addSnapshotListener
                when (snapshot.getString("status")) {
                    "running" -> trySend(LlmEvent.Activity(snapshot.getString("error")?.takeIf { it.isNotBlank() } ?: "Local model is working on your PC"))
                    "streaming" -> runCatching {
                        val sequence = snapshot.getLong("streamSequence") ?: 0L
                        if (sequence <= streamSequence) return@runCatching
                        streamSequence = sequence
                        trySend(LlmEvent.Activity("Generating response"))
                        val partial = LocalBrainPairingStore.decrypt(
                            pairing.key,
                            "JBP1|${pairing.brainId}|$requestId|partial",
                            snapshot.getString("partialCiphertext").orEmpty(),
                            snapshot.getString("partialNonce").orEmpty()
                        )
                        val delta = if (partial.startsWith(streamedText)) partial.removePrefix(streamedText) else ""
                        streamedText = partial
                        if (delta.isNotEmpty()) trySend(LlmEvent.TextDelta(delta))
                    }.onFailure {
                        terminal = true
                        trySend(LlmEvent.Activity(""))
                        trySend(LlmEvent.Error("Local Junction returned an invalid streamed response.")); trySend(LlmEvent.Done); close()
                    }
                    "done" -> runCatching {
                        val response = LocalBrainPairingStore.decrypt(pairing.key, "JBP1|${pairing.brainId}|$requestId|response", snapshot.getString("responseCiphertext").orEmpty(), snapshot.getString("responseNonce").orEmpty())
                        val thinking = snapshot.getString("thinkingCiphertext")
                            ?.takeIf { it.isNotBlank() }
                            ?.let {
                                LocalBrainPairingStore.decrypt(
                                    pairing.key,
                                    "JBP1|${pairing.brainId}|$requestId|thinking",
                                    it,
                                    snapshot.getString("thinkingNonce").orEmpty()
                                )
                            }
                        val tokensPerSecond = snapshot.get("tokensPerSecond")
                            ?.toString()?.toDoubleOrNull()
                        val metrics = snapshot.getString("telemetryCiphertext")?.takeIf { it.isNotBlank() }?.let { ciphertext ->
                            val plain = LocalBrainPairingStore.decrypt(
                                pairing.key, "JBP1|${pairing.brainId}|$requestId|telemetry", ciphertext,
                                snapshot.getString("telemetryNonce").orEmpty()
                            )
                            val json = JSONObject(plain)
                            json.keys().asSequence().associateWith { key ->
                                val value = json.get(key)
                                when (value) {
                                    is JSONArray -> (0 until value.length()).map { value.get(it).toString() }
                                    JSONObject.NULL -> null
                                    else -> value
                                }
                            }
                        }
                        // Persist the authoritative final text after streamed previews.
                        terminal = true
                        trySend(LlmEvent.TextDone(response, thinking, HostTelemetry.tokensPerSecond(metrics) ?: tokensPerSecond, telemetry = HostTelemetry.line(metrics))); trySend(LlmEvent.Done); close()
                    }.onFailure { terminal = true; trySend(LlmEvent.Activity("")); trySend(LlmEvent.Error("Local Junction returned an invalid encrypted response.")); trySend(LlmEvent.Done); close() }
                    "error" -> { terminal = true; trySend(LlmEvent.Activity("")); trySend(LlmEvent.Error(snapshot.getString("error") ?: "Your Junction PC could not run the local model.")); trySend(LlmEvent.Done); close() }
                    "cancelled" -> { terminal = true; trySend(LlmEvent.Activity("")); trySend(LlmEvent.Done); close() }
                }
            }
            val timeout = launch {
                delay(AGENT_REQUEST_TIMEOUT_MS)
                if (!terminal) {
                    terminal = true
                    document.update("status", "cancel_requested")
                    trySend(LlmEvent.Activity(""))
                    trySend(LlmEvent.Error("Your Junction PC did not finish this request in time. Check that Junction and Ollama are running, then try again."))
                    trySend(LlmEvent.Done)
                    close()
                }
            }
            awaitClose {
                timeout.cancel()
                registration.remove()
                if (!terminal) document.update("status", "cancel_requested")
            }
        } catch (error: Exception) {
            if (error is CancellationException && error !is kotlinx.coroutines.TimeoutCancellationException) throw error
            val message = if (error is com.google.firebase.firestore.FirebaseFirestoreException && error.code == com.google.firebase.firestore.FirebaseFirestoreException.Code.RESOURCE_EXHAUSTED) {
                "The cloud relay quota is exhausted. Try again after the Firebase quota resets or is increased. Your PC model is not the cause."
            } else error.message ?: "Could not contact your Junction PC."
            trySend(LlmEvent.Activity("")); trySend(LlmEvent.Error(message)); trySend(LlmEvent.Done); close()
        }
    }

    override suspend fun readUntrusted(content: String, sourceHint: String) = null
    companion object {
        const val PC_OFFLINE_ERROR_MESSAGE = "Junction could not confirm a recent PC heartbeat through Firebase. The PC may be online while the relay is unavailable or over quota. Try the paired direct connection, or check Local Nethra Brain status on the PC."
        const val SOURCE = "junction_local_llm_v2"
        const val MAX_CONTEXT_BLOCKS = 8
        const val MAX_BLOCK_CHARS = 2_000
        const val AGENT_REQUEST_TIMEOUT_MS = 480_000L
        // The desktop renews presence every minute to stay within the relay's
        // write budget. Allow a missed renewal and network handover, but do not
        // treat an hours-old Firestore document as proof that the PC is online.
        const val PC_ONLINE_WINDOW_MS = 150_000L
        const val LOCAL_AGENT_SIGNAL = "junction_local_agent"
    }
}
