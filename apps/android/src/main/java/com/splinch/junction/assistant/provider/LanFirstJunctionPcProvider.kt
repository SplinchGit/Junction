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
import com.splinch.junction.data.sync.lan.LanFailure
import com.splinch.junction.data.sync.lan.LanFailureKind
import com.splinch.junction.data.secret.KeyStorage
import com.splinch.junction.data.sync.firebase.LocalBrainPairingStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.TimeoutCancellationException
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
) : LlmProvider, ResearchCapableProvider {
    private val appContext = context.applicationContext
    override val id: String = "local"
    override val frontierModel: String? = null

    override fun act(
        context: List<ContextBlock>,
        tools: List<ToolDefinition>,
        useFrontier: Boolean,
        conversationId: String?
    ): Flow<LlmEvent> = actWithResearch(context, tools, useFrontier, conversationId, false)

    override fun actWithResearch(context: List<ContextBlock>, tools: List<ToolDefinition>, useFrontier: Boolean, conversationId: String?, forceResearch: Boolean): Flow<LlmEvent> {
        val requestId = UUID.randomUUID().toString()
        return lanAct(context, tools, useFrontier, conversationId, requestId, forceResearch)
    }

    private fun lanAct(
        context: List<ContextBlock>,
        tools: List<ToolDefinition>,
        useFrontier: Boolean,
        conversationId: String?,
        requestId: String,
        forceResearch: Boolean
    ): Flow<LlmEvent> = callbackFlow {
        val identity = LanIdentityStore(appContext)
        val transport = LanTransport(identity, scope)
        try {
        var pairing = identity.loadPairing()
        val damagedTrust = pairing == null && identity.hasPairingRecord()
        val legacy = LocalBrainPairingStore.load(appContext)
        suspend fun relayFallback() {
            Log.i(TAG, "Connection stage=relay kind=FALLBACK")
            trySend(LlmEvent.Activity("Connecting through the encrypted relay"))
            remote.actWithRequestId(context, conversationId, requestId, forceResearch).collect { trySend(it) }
            close()
        }
        Log.i(TAG, "Wi-Fi relay trust: lan=${pairing != null}, legacy=${legacy != null}, damaged=$damagedTrust")
        val discovered = mutableListOf<LanEndpoint>()
        val discovery = LanDiscovery(appContext)
        try {
            runCatching { discovery.discover({ endpoint ->
                synchronized(discovered) {
                    if ((pairing == null || endpoint.instanceId == pairing?.instanceId) && discovered.size < 16) discovered.add(endpoint)
                }
            }, { error -> Log.w(TAG, "LAN stage=discovery kind=NOT_DISCOVERED cause=${error.javaClass.simpleName}") }) }
                .onFailure { Log.w(TAG, "LAN stage=discovery kind=NOT_DISCOVERED cause=${it.javaClass.simpleName}") }
            kotlinx.coroutines.delay(DISCOVERY_TIMEOUT_MS)
        } finally { discovery.stop() }
        val candidates = synchronized(discovered) { com.splinch.junction.data.sync.lan.lanCandidates(discovered.toList(), pairing, KeyStorage(appContext).getSecret("lan_manual_host_v1")) }
        if (candidates.isEmpty() || (pairing == null && legacy == null)) {
            if (canUseRelayBeforeSend(legacy != null, damagedTrust, null)) { relayFallback(); return@callbackFlow }
            val error = when {
                damagedTrust -> "Saved PC trust could not be read. Verify the pairing in Settings."
                legacy == null -> "Pair this phone with your Junction PC in Settings."
                else -> "Your paired PC was not discovered on this Wi-Fi. Open Junction on the PC."
            }
            Log.w(TAG, "LAN stage=discovery kind=${if (damagedTrust) "STALE_TRUST" else "NOT_DISCOVERED"}")
            trySend(LlmEvent.Error(error)); trySend(LlmEvent.Done); close(); return@callbackFlow
        }
        var connectionError: Throwable? = null
        var authenticated = false
        val deadline = android.os.SystemClock.elapsedRealtime() + TOTAL_CONNECT_TIMEOUT_MS
        for (candidate in candidates) {
            val remaining = deadline - android.os.SystemClock.elapsedRealtime()
            if (remaining <= 0) {
                connectionError = LanFailure(LanFailureKind.TIMEOUT, "Connection deadline exceeded")
                break
            }
            var stage = "connect"
            val attempt = runCatching {
                withTimeout(minOf(CONNECT_TIMEOUT_MS, remaining)) {
                    val trustChanged = pairing != null && !candidate.certificateFingerprint.equals(pairing?.certificateSha256, true)
                    if (pairing == null || trustChanged) {
                        if (legacy == null) throw LanFailure(LanFailureKind.STALE_TRUST, "PC identity changed")
                        stage = "bootstrap"
                        transport.bootstrap(candidate, legacy).getOrThrow()
                        pairing = identity.loadPairing()
                    }
                    stage = "connect"
                    transport.connect(candidate).getOrThrow()
                }
            }
            if (attempt.isSuccess) {
                authenticated = true
                Log.i(TAG, "LAN stage=connect kind=CONNECTED")
                break
            }
            val error = attempt.exceptionOrNull()!!
            if (error is CancellationException && error !is TimeoutCancellationException) throw error
            connectionError = error
            val kind = (error as? LanFailure)?.kind?.name ?: if (error is TimeoutCancellationException) "TIMEOUT" else "UNREACHABLE"
            Log.w(TAG, "LAN stage=$stage kind=$kind cause=${error.cause?.javaClass?.simpleName ?: error.javaClass.simpleName}")
            // Another NIC/address is useful only for network failure. Never retry rejected trust.
            if (!com.splinch.junction.data.sync.lan.canTryAnotherLanAddress(error)) break
        }
        if (!authenticated) {
            val error = connectionError ?: LanFailure(LanFailureKind.UNREACHABLE, "PC unreachable")
            if (canUseRelayBeforeSend(legacy != null, damagedTrust, error)) {
                relayFallback(); return@callbackFlow
            }
            val missingDiscovery = synchronized(discovered) { discovered.isEmpty() }
            val message = if (missingDiscovery && com.splinch.junction.data.sync.lan.canTryAnotherLanAddress(error))
                "Your paired PC was not discovered on this Wi-Fi, and its saved address could not be reached. Open Junction on the PC."
            else relayFailureMessage(error)
            trySend(LlmEvent.Error(message)); trySend(LlmEvent.Done); close(); return@callbackFlow
        }
        conversationSync?.reconcile(transport)
        kotlinx.coroutines.currentCoroutineContext().ensureActive()

        val collector: Job = launch(start = kotlinx.coroutines.CoroutineStart.UNDISPATCHED) {
            transport.events.collect { event ->
                if (event.requestId != requestId) return@collect
                when (event.type) {
                    "chat.started" -> trySend(LlmEvent.Activity("Connected to Junction on this network"))
                    // Host phases separate a queue wait or cold model load from thinking and output.
                    "chat.progress" -> event.payload["stage"]?.toString()?.takeIf { it.isNotBlank() }?.let { trySend(LlmEvent.Activity(it)) }
                    "chat.delta" -> event.payload["text"]?.toString()?.takeIf { it.isNotEmpty() }?.let { trySend(LlmEvent.TextDelta(it)) }
                    "chat.complete" -> {
                        val text = event.payload["content"]?.toString().orEmpty()
                        @Suppress("UNCHECKED_CAST")
                        val metrics = event.payload["telemetry"] as? Map<String, Any?>
                        trySend(LlmEvent.TextDone(
                            text,
                            tokensPerSecond = HostTelemetry.tokensPerSecond(metrics),
                            messageId = event.payload["messageId"]?.toString(),
                            telemetry = HostTelemetry.line(metrics)
                        ))
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
        val failureCollector = launch(start = kotlinx.coroutines.CoroutineStart.UNDISPATCHED) {
            transport.failure.collect { error ->
                if (error != null) {
                    trySend(LlmEvent.Error(relayFailureMessage(error)))
                    trySend(LlmEvent.Done); close()
                }
            }
        }
        try {
            val content = context.lastOrNull { it.role.equals("user", ignoreCase = true) }?.content.orEmpty()
            transport.send("chat.send", mapOf(
                "conversationId" to conversationId,
                "content" to content,
                "model" to workhorseModel,
                "forceSearch" to forceResearch,
                "session" to com.splinch.junction.assistant.runtime.TurnSessionContext.current?.toPayload(),
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
            failureCollector.cancel()
            if (transport.state.value.name == "CONNECTED") runCatching { transport.cancel(requestId) }
            transport.close()
        }
        } finally { transport.close() }
    }


    override suspend fun readUntrusted(content: String, sourceHint: String): ReaderOutput? = null

    companion object {
        internal fun relayFailureMessage(error: Throwable): String = when {
            error is TimeoutCancellationException || (error is LanFailure && error.kind == LanFailureKind.TIMEOUT) -> "The Junction PC connection timed out. Check that Junction is open on the same Wi-Fi."
            error is LanFailure && error.kind == LanFailureKind.AUTHENTICATION -> "The PC rejected this phone's pairing. It may have expired or been revoked. Verify pairing in Settings."
            error is LanFailure && error.kind == LanFailureKind.STALE_TRUST -> "The PC identity changed. Verify pairing in Settings before reconnecting."
            error is LanFailure && error.kind == LanFailureKind.DISCONNECTED -> "The connection to Junction PC was lost. Send the message again after reconnecting."
            error is SecurityException -> "Could not verify your paired PC's identity. Verify pairing in Settings."
            else -> "Your paired Junction PC was not reachable on this Wi-Fi network. Open Junction on the PC."
        }
        const val CONNECT_TIMEOUT_MS = 3_000L
        const val TOTAL_CONNECT_TIMEOUT_MS = 9_000L
        const val DISCOVERY_TIMEOUT_MS = 5_000L
        const val MAX_CONTEXT_BLOCKS = 16
        const val MAX_BLOCK_CHARS = 8_000
        const val LAN_MODE_SECRET = "lan_mode_v1"
        private const val TAG = "JunctionLanProvider"
    }
}

/** Never retry a request over a second transport once LAN might have received it. */
internal fun canUseRelayBeforeSend(pairedRelay: Boolean, damagedLanTrust: Boolean, connectionError: Throwable?): Boolean =
    pairedRelay && !damagedLanTrust && (connectionError == null || com.splinch.junction.data.sync.lan.canTryAnotherLanAddress(connectionError))

internal fun firebaseWithOfflineLanFallback(
    firebase: Flow<LlmEvent>,
    lan: () -> Flow<LlmEvent>
): Flow<LlmEvent> = kotlinx.coroutines.flow.flow {
    var offline = false
    firebase.collect { event ->
        if (event is LlmEvent.Error && event.message == JunctionPcProvider.PC_OFFLINE_ERROR_MESSAGE) {
            offline = true
        } else if (!(offline && event === LlmEvent.Done)) {
            emit(event)
        }
    }
    if (offline) {
        emit(LlmEvent.Activity("Trying the local Wi-Fi connection"))
        lan().collect { emit(it) }
    }
}
