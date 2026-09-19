package com.splinch.junction.data.sync.lan

import android.util.Base64
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import com.splinch.junction.data.sync.firebase.LocalBrainPairing
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.coroutines.resume

enum class LanConnectionState { DISCONNECTED, CONNECTING, AUTHENTICATING, CONNECTED, FAILED }

/** TLS-only WebSocket client. Certificate pinning is built per paired endpoint. */
class LanTransport(
    private val identity: LanIdentity,
    private val scope: CoroutineScope = CoroutineScope(Dispatchers.IO)
) {
    private val _state = MutableStateFlow(LanConnectionState.DISCONNECTED)
    val state: StateFlow<LanConnectionState> = _state.asStateFlow()
    private val _events = MutableSharedFlow<LanProtocol.Envelope>(extraBufferCapacity = 64)
    val events: SharedFlow<LanProtocol.Envelope> = _events.asSharedFlow()
    private val pending = ConcurrentHashMap<String, CompletableDeferred<LanProtocol.Envelope>>()
    private var socket: WebSocket? = null
    private var client: okhttp3.OkHttpClient? = null
    private var handshake: CompletableDeferred<Unit>? = null
    @Volatile private var closed = false
    @Volatile private var generation = 0L
    private val _failure = MutableStateFlow<LanFailure?>(null)
    val failure: StateFlow<LanFailure?> = _failure.asStateFlow()

    suspend fun connect(endpoint: LanEndpoint): Result<Unit> {
        close()
        val session = generation
        _failure.value = null
        val stored = identity.loadPairing()
        val target = endpoint.copy(
            certificateFingerprint = endpoint.certificateFingerprint.ifBlank { stored?.certificateSha256.orEmpty() },
            instanceId = endpoint.instanceId.ifBlank { stored?.instanceId.orEmpty() }
        )
        require(target.certificateFingerprint.matches(Regex("[0-9a-fA-F]{64}"))) { "A paired certificate fingerprint is required" }
        closed = false
        _state.value = LanConnectionState.CONNECTING
        val connected = CompletableDeferred<Unit>().also { handshake = it }
        if (stored == null || target.instanceId != stored.instanceId || !target.certificateFingerprint.equals(stored.certificateSha256, true)) {
            close()
            return Result.failure(LanFailure(LanFailureKind.STALE_TRUST, "The PC identity changed. Verify the pairing in Settings."))
        }
        val client = LanTls.client(stored.certificateSha256).also { this.client = it }
        val request = Request.Builder().url("wss://${target.host}:${target.port}/lan").build()
        socket = client.newWebSocket(request, listener(connected, target, session))
        return try {
            connected.await()
            identity.savePairing(stored.copy(host = target.host, port = target.port))
            Result.success(Unit)
        } catch (error: CancellationException) { if (session == generation) close(); throw error }
        catch (error: Exception) { if (session == generation) close(); Result.failure(error) }
    }

    /** Completes the one-time QR bootstrap; the token is never persisted. */
    suspend fun pair(code: LanProtocol.PairingCode): Result<Unit> = runCatching {
        require(code.expiresAtMillis > System.currentTimeMillis()) { "LAN pairing code has expired" }
        val client = LanTls.client(code.certificateSha256)
        val deviceId = identity.deviceId(); val publicKey = identity.publicKeyBase64()
        var pairingSocket: WebSocket? = null
        try {
        suspendCancellableCoroutine<Unit> { continuation ->
            val request = Request.Builder().url("wss://${code.host}:${code.port}/lan").build()
            val ws = client.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send(LanProtocol.encode(LanProtocol.Envelope("pair", UUID.randomUUID().toString(), mapOf(
                        "token" to code.token, "deviceId" to deviceId, "publicKey" to publicKey
                    ))))
                }
                override fun onMessage(webSocket: WebSocket, text: String) {
                    if (!continuation.isActive) return
                    val message = LanProtocol.decode(text) ?: run { webSocket.close(1002, "invalid frame"); return }
                    if (message.type == "authenticated" && message.payload["paired"] == true) {
                        identity.savePairing(code); if (continuation.isActive) continuation.resume(Unit); webSocket.close(1000, "paired")
                    } else if (message.type == "chat.error" && continuation.isActive) continuation.resumeWith(Result.failure(LanFailure(LanFailureKind.AUTHENTICATION, message.payload["message"]?.toString() ?: "LAN pairing rejected")))
                }
                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    if (continuation.isActive) continuation.resumeWith(Result.failure(LanFailure(LanFailureKind.AUTHENTICATION, reason.ifBlank { "PC pairing connection closed" })))
                    webSocket.close(code, reason)
                }
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    if (continuation.isActive) continuation.resumeWith(Result.failure(LanFailure(LanFailureKind.AUTHENTICATION, reason.ifBlank { "PC pairing connection closed" })))
                }
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { if (continuation.isActive) continuation.resumeWith(Result.failure(t)) }
            })
            pairingSocket = ws
            continuation.invokeOnCancellation { ws.cancel() }
        }
        } finally { pairingSocket?.cancel(); client.connectionPool.evictAll(); client.dispatcher.executorService.shutdown() }
    }.onFailure { if (it is CancellationException) throw it }

    /** Migrates an existing encrypted Firebase pairing into asymmetric LAN trust. */
    suspend fun bootstrap(endpoint: LanEndpoint, pairing: LocalBrainPairing): Result<Unit> = runCatching {
        require(endpoint.certificateFingerprint.matches(Regex("[0-9a-fA-F]{64}")))
        val client = LanTls.client(endpoint.certificateFingerprint)
        val deviceId = identity.deviceId(); val publicKey = identity.publicKeyBase64()
        val nonce = UUID.randomUUID().toString()
        val transcript = "junction-lan-bootstrap-v2\n${pairing.brainId}\n$deviceId\n$publicKey\n${endpoint.certificateFingerprint}\n${endpoint.instanceId}\n$nonce"
        val key = Base64.decode(pairing.key, Base64.URL_SAFE or Base64.NO_WRAP)
        fun mac(role: String): ByteArray = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, "HmacSHA256")) }.doFinal("$role\n$transcript".toByteArray(Charsets.UTF_8))
        var pairingSocket: WebSocket? = null
        try {
        suspendCancellableCoroutine<Unit> { continuation ->
            val request = Request.Builder().url("wss://${endpoint.host}:${endpoint.port}/lan").build()
            val ws = client.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    val proof = mac("client")
                    webSocket.send(LanProtocol.encode(LanProtocol.Envelope("pair.bootstrap", UUID.randomUUID().toString(), mapOf(
                        "brainId" to pairing.brainId, "deviceId" to deviceId, "publicKey" to publicKey, "nonce" to nonce,
                        "proof" to Base64.encodeToString(proof, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
                    ))))
                }
                override fun onMessage(webSocket: WebSocket, text: String) {
                    if (!continuation.isActive) return
                    val message = LanProtocol.decode(text) ?: run { webSocket.close(1002, "invalid frame"); return }
                    if (message.type == "authenticated" && message.payload["paired"] == true) {
                        val supplied = runCatching { Base64.decode(message.payload["serverProof"]?.toString().orEmpty(), Base64.URL_SAFE or Base64.NO_WRAP) }.getOrDefault(byteArrayOf())
                        if (!java.security.MessageDigest.isEqual(mac("server"), supplied)) {
                            if (continuation.isActive) continuation.resumeWith(Result.failure(SecurityException("PC pairing proof did not match")))
                            webSocket.close(1008, "Untrusted PC"); return
                        }
                        identity.savePairing(LanProtocol.PairingCode(endpoint.instanceId, endpoint.host, endpoint.port, endpoint.certificateFingerprint, "", Long.MAX_VALUE))
                        if (continuation.isActive) continuation.resume(Unit); webSocket.close(1000, "paired")
                    } else if (message.type == "chat.error" && continuation.isActive) continuation.resumeWith(Result.failure(LanFailure(LanFailureKind.AUTHENTICATION, message.payload["message"]?.toString() ?: "LAN bootstrap rejected")))
                }
                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    if (continuation.isActive) continuation.resumeWith(Result.failure(LanFailure(LanFailureKind.AUTHENTICATION, reason.ifBlank { "PC pairing connection closed" })))
                    webSocket.close(code, reason)
                }
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    if (continuation.isActive) continuation.resumeWith(Result.failure(LanFailure(LanFailureKind.AUTHENTICATION, reason.ifBlank { "PC pairing connection closed" })))
                }
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { if (continuation.isActive) continuation.resumeWith(Result.failure(t)) }
            })
            pairingSocket = ws
            continuation.invokeOnCancellation { ws.cancel() }
        }
        } finally { pairingSocket?.cancel(); client.connectionPool.evictAll(); client.dispatcher.executorService.shutdown() }
    }.onFailure { if (it is CancellationException) throw it }

    fun send(type: String, payload: Map<String, Any?> = emptyMap(), requestId: String = UUID.randomUUID().toString()): String {
        check(_state.value == LanConnectionState.CONNECTED) { "LAN transport is not connected" }
        check(socket?.send(LanProtocol.encode(LanProtocol.Envelope(type, requestId, payload))) == true) { "LAN socket is closed" }
        return requestId
    }

    suspend fun request(type: String, payload: Map<String, Any?> = emptyMap(), timeoutMs: Long = 10_000L): LanProtocol.Envelope {
        val requestId = UUID.randomUUID().toString()
        val result = CompletableDeferred<LanProtocol.Envelope>()
        pending[requestId] = result
        return try {
            kotlinx.coroutines.withTimeout(timeoutMs) {
                send(type, payload, requestId)
                result.await()
            }
        } finally { pending.remove(requestId) }
    }

    fun cancel(requestId: String) { if (_state.value == LanConnectionState.CONNECTED) send("chat.cancel", emptyMap(), requestId) }

    fun close() {
        generation++
        closed = true
        handshake?.cancel(CancellationException("LAN connection closed")); handshake = null
        socket?.cancel(); socket = null
        client?.connectionPool?.evictAll(); client?.dispatcher?.executorService?.shutdown(); client = null
        pending.values.forEach { it.cancel(CancellationException("LAN socket closed")) }; pending.clear()
        _state.value = LanConnectionState.DISCONNECTED
    }

    private fun listener(connected: CompletableDeferred<Unit>, target: LanEndpoint, session: Long) = object : WebSocketListener() {
        private fun active() = session == generation && !closed && _failure.value == null
        private fun fail(error: LanFailure) {
            if (!active()) return
            _failure.value = error
            _state.value = LanConnectionState.FAILED
            connected.completeExceptionally(error)
            pending.values.forEach { it.completeExceptionally(error) }; pending.clear()
        }
        override fun onOpen(webSocket: WebSocket, response: Response) {
            if (!active()) { webSocket.cancel(); return }
            _state.value = LanConnectionState.AUTHENTICATING
            webSocket.send(LanProtocol.encode(LanProtocol.Envelope("hello", UUID.randomUUID().toString(), helloPayload(identity.deviceId(), target.certificateFingerprint))))
        }
        override fun onMessage(webSocket: WebSocket, text: String) {
            if (!active()) return
            val message = LanProtocol.decode(text) ?: run { fail(LanFailure(LanFailureKind.DISCONNECTED, "The PC sent an invalid response.")); webSocket.close(1002, "invalid frame"); return }
            if (message.type == "chat.error" && (!connected.isCompleted || message.requestId == null)) {
                fail(LanFailure(LanFailureKind.AUTHENTICATION, message.payload["message"]?.toString() ?: "The PC rejected this phone's pairing."))
                webSocket.close(1008, "authentication rejected"); return
            }
            when (message.type) {
                "challenge" -> {
                    val nonce = message.payload["nonce"]?.toString() ?: run { webSocket.close(1008, "missing challenge"); return }
                    val deviceId = identity.deviceId()
                    val signature = identity.sign(LanProtocol.authMessage(nonce, target.instanceId, deviceId))
                    webSocket.send(LanProtocol.encode(LanProtocol.Envelope("authenticate", message.requestId, authenticatePayload(deviceId, signature))))
                }
                "authenticated" -> { _state.value = LanConnectionState.CONNECTED; connected.complete(Unit) }
                "ping" -> webSocket.send(LanProtocol.encode(LanProtocol.Envelope("pong", message.requestId)))
                else -> { message.requestId?.let { pending.remove(it)?.complete(message) }; _events.tryEmit(message) }
            }
        }
        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            val kind = if (t is javax.net.ssl.SSLException) LanFailureKind.STALE_TRUST else if (connected.isCompleted) LanFailureKind.DISCONNECTED else LanFailureKind.UNREACHABLE
            fail(LanFailure(kind, if (kind == LanFailureKind.STALE_TRUST) "The PC certificate no longer matches the saved pairing." else "The Junction PC connection was lost or could not be reached.", t))
        }
        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            fail(LanFailure(if (code == 1008) LanFailureKind.AUTHENTICATION else LanFailureKind.DISCONNECTED, reason.ifBlank { "The PC closed the connection." }))
            webSocket.close(code, reason)
        }
        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            fail(LanFailure(if (code == 1008) LanFailureKind.AUTHENTICATION else LanFailureKind.DISCONNECTED, reason.ifBlank { "The PC closed the connection." }))
        }
    }

    companion object {
        fun helloPayload(deviceId: String, certificateFingerprint: String): Map<String, Any?> =
            mapOf("deviceId" to deviceId, "certificateFingerprint" to certificateFingerprint)
        fun authenticatePayload(deviceId: String, signature: String): Map<String, Any?> =
            mapOf("deviceId" to deviceId, "signature" to signature)
    }

}
