package com.splinch.junction.assistant.provider

import android.content.Context
import android.util.Log
import com.splinch.junction.assistant.context.ContextBlock
import com.splinch.junction.assistant.context.ReaderOutput
import com.splinch.junction.assistant.tools.ToolDefinition
import com.splinch.junction.data.sync.lan.LanEndpoint
import com.splinch.junction.data.sync.lan.LanDiscovery
import com.splinch.junction.data.sync.lan.LanIdentityStore
import com.splinch.junction.data.sync.lan.LanProtocol
import com.splinch.junction.data.sync.lan.LanTransport
import com.splinch.junction.data.sync.lan.LanConversationSync
import com.splinch.junction.data.sync.lan.LanConnectionMode
import com.splinch.junction.data.secret.KeyStorage
import com.splinch.junction.data.sync.firebase.LocalBrainPairingStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.suspendCancellableCoroutine
import java.util.UUID
import kotlin.coroutines.resume

/** One mode selector for direct Wi-Fi or the existing Firebase PC provider. */
class LanFirstJunctionPcProvider(
    context: Context,
    override val workhorseModel: String,
    private val remote: JunctionPcProvider = JunctionPcProvider(workhorseModel),
    private val conversationSync: LanConversationSync? = null,
    private val scope: CoroutineScope = CoroutineScope(Dispatchers.IO)
) : LlmProvider {
    private val appContext = context.applicationContext
    override val id: String = "local"
    override val frontierModel: String? = null

    override fun act(
        context: List<ContextBlock>,
        tools: List<ToolDefinition>,
        useFrontier: Boolean,
        conversationId: String?
    ): Flow<LlmEvent> = callbackFlow {
        val identity = LanIdentityStore(appContext)
        if (LanConnectionMode.fromStored(KeyStorage(appContext).getSecret(LAN_MODE_SECRET)) == LanConnectionMode.FIREBASE) {
            remote.act(context, tools, useFrontier, conversationId).collect { trySend(it).isSuccess }
            close()
            return@callbackFlow
        }
        val transport = LanTransport(identity, scope)
        var pairing = identity.loadPairing()
        val legacy = LocalBrainPairingStore.load(appContext)
        Log.i(TAG, "Wi-Fi relay trust: lan=${pairing != null}, legacy=${legacy != null}")
        val discovered = runCatching {
            withTimeout(DISCOVERY_TIMEOUT_MS) {
                suspendCancellableCoroutine { continuation ->
                    val discovery = LanDiscovery(appContext)
                    discovery.discover({ endpoint ->
                        val sameIdentity = endpoint.instanceId == pairing?.instanceId
                        val matches = pairing == null || (sameIdentity && (legacy != null || endpoint.certificateFingerprint.equals(pairing?.certificateSha256, true)))
                        if (matches && continuation.isActive) {
                            discovery.stop(); continuation.resume(endpoint)
                        }
                    })
                    continuation.invokeOnCancellation { discovery.stop() }
                }
            }
        }.getOrNull()
        val trustChanged = discovered != null && pairing != null && !discovered.certificateFingerprint.equals(pairing.certificateSha256, true)
        if ((pairing == null || trustChanged) && discovered != null && legacy != null) {
            runCatching { withTimeout(CONNECT_TIMEOUT_MS) { transport.bootstrap(discovered, legacy).getOrThrow() } }
                .onSuccess { Log.i(TAG, "Existing PC pairing migrated to LAN trust") }
                .onFailure { Log.w(TAG, "LAN trust migration failed: ${it.javaClass.simpleName}") }
            pairing = identity.loadPairing()
        }
        if (pairing == null) {
            transport.close()
            val error = if (legacy == null) "Pair this phone with your Junction PC in Settings." else if (discovered == null) "Your paired PC was not found on this Wi-Fi. Open Junction on the PC." else "Could not verify your paired PC's LAN identity. Your existing pairing is still saved."
            trySend(LlmEvent.Error(error)); trySend(LlmEvent.Done); close(); return@callbackFlow
        }
        val endpoint = discovered ?: LanEndpoint(pairing.host, pairing.port, pairing.instanceId, pairing.certificateSha256)
        val connected = runCatching { withTimeout(CONNECT_TIMEOUT_MS) { transport.connect(endpoint).getOrThrow() } }
            .onSuccess { Log.i(TAG, "Authenticated direct LAN connection") }
            .onFailure { Log.w(TAG, "LAN authentication failed: ${it.javaClass.simpleName}") }.isSuccess
        if (!connected) {
            transport.close()
            trySend(LlmEvent.Error("Your paired Junction PC was not reachable on this Wi-Fi network."))
            trySend(LlmEvent.Done)
            close()
            return@callbackFlow
        }
        conversationSync?.reconcile(transport)

        val requestId = UUID.randomUUID().toString()
        val collector: Job = launch(start = kotlinx.coroutines.CoroutineStart.UNDISPATCHED) {
            transport.events.collect { event ->
                when (event.type) {
                    "chat.started" -> trySend(LlmEvent.Activity("Connected to Junction on this network"))
                    "chat.delta" -> event.payload["text"]?.toString()?.takeIf { it.isNotEmpty() }?.let { trySend(LlmEvent.TextDelta(it)) }
                    "chat.complete" -> {
                        val text = event.payload["content"]?.toString().orEmpty()
                        trySend(LlmEvent.TextDone(text, messageId = event.payload["messageId"]?.toString()))
                        trySend(LlmEvent.Done)
                        close()
                    }
                    "chat.error" -> {
                        trySend(LlmEvent.Error(event.payload["message"]?.toString() ?: "The local Junction connection failed."))
                        trySend(LlmEvent.Done)
                        close()
                    }
                }
            }
        }
        try {
            val content = context.lastOrNull { it.role.equals("user", ignoreCase = true) }?.content.orEmpty()
            transport.send("chat.send", mapOf(
                "conversationId" to conversationId,
                "content" to content,
                "model" to workhorseModel,
                "context" to context.takeLast(MAX_CONTEXT_BLOCKS).map { mapOf("role" to it.role, "content" to it.content.take(MAX_BLOCK_CHARS)) }
            ), requestId)
        } catch (error: Exception) {
            if (error !is CancellationException) {
                trySend(LlmEvent.Error(error.message ?: "The local Junction connection failed."))
                trySend(LlmEvent.Done)
            }
            close(error)
        }
        awaitClose {
            collector.cancel()
            if (transport.state.value.name == "CONNECTED") transport.cancel(requestId)
            transport.close()
        }
    }

    override suspend fun readUntrusted(content: String, sourceHint: String): ReaderOutput? = null

    companion object {
        const val CONNECT_TIMEOUT_MS = 5_000L
        const val DISCOVERY_TIMEOUT_MS = 5_000L
        const val MAX_CONTEXT_BLOCKS = 16
        const val MAX_BLOCK_CHARS = 8_000
        const val LAN_MODE_SECRET = "lan_mode_v1"
        private const val TAG = "JunctionLanProvider"
    }
}
