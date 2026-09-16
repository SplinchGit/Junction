package com.splinch.junction.data.sync.lan

import android.util.Base64
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.CertificatePinner
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.resume

enum class LanConnectionState { DISCONNECTED, CONNECTING, AUTHENTICATING, CONNECTED, FAILED }

/** TLS-only WebSocket client. Certificate pinning is built per paired endpoint. */
class LanTransport(
    private val identity: LanIdentityStore,
    private val scope: CoroutineScope = CoroutineScope(Dispatchers.IO)
) {
    private val _state = MutableStateFlow(LanConnectionState.DISCONNECTED)
    val state: StateFlow<LanConnectionState> = _state.asStateFlow()
    private val _events = MutableSharedFlow<LanProtocol.Envelope>(extraBufferCapacity = 64)
    val events: SharedFlow<LanProtocol.Envelope> = _events.asSharedFlow()
    private val pending = ConcurrentHashMap<String, CompletableDeferred<LanProtocol.Envelope>>()
    private var socket: WebSocket? = null
    private var reconnectJob: Job? = null
    private var endpoint: LanEndpoint? = null
    private var attempts = 0
    private var closed = false

    suspend fun connect(endpoint: LanEndpoint): Result<Unit> {
        val stored = identity.loadPairing()
        val target = endpoint.copy(
            certificateFingerprint = endpoint.certificateFingerprint.ifBlank { stored?.certificateSha256.orEmpty() },
            instanceId = endpoint.instanceId.ifBlank { stored?.instanceId.orEmpty() }
        )
        require(target.certificateFingerprint.matches(Regex("[0-9a-fA-F]{64}"))) { "A paired certificate fingerprint is required" }
        this.endpoint = target
        closed = false
        _state.value = LanConnectionState.CONNECTING
        val connected = CompletableDeferred<Unit>()
        val pin = "sha256/" + hexToBase64(target.certificateFingerprint)
        val client = OkHttpClient.Builder().certificatePinner(CertificatePinner.Builder().add(target.host, pin).build()).build()
        val request = Request.Builder().url("wss://${target.host}:${target.port}/lan").build()
        socket = client.newWebSocket(request, listener(connected, target))
        return runCatching { connected.await() }.onFailure { close() }
    }

    /** Completes the one-time QR bootstrap; the token is never persisted. */
    suspend fun pair(code: LanProtocol.PairingCode): Result<Unit> = runCatching {
        require(code.expiresAtMillis > System.currentTimeMillis()) { "LAN pairing code has expired" }
        val pin = "sha256/" + hexToBase64(code.certificateSha256)
        val client = OkHttpClient.Builder().certificatePinner(CertificatePinner.Builder().add(code.host, pin).build()).build()
        suspendCancellableCoroutine<Unit> { continuation ->
            val request = Request.Builder().url("wss://${code.host}:${code.port}/lan").build()
            val ws = client.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send(LanProtocol.encode(LanProtocol.Envelope("pair", UUID.randomUUID().toString(), mapOf(
                        "token" to code.token, "deviceId" to identity.deviceId(), "publicKey" to identity.publicKeyBase64()
                    ))))
                }
                override fun onMessage(webSocket: WebSocket, text: String) {
                    val message = LanProtocol.decode(text) ?: run { webSocket.close(1002, "invalid frame"); return }
                    if (message.type == "authenticated" && message.payload["paired"] == true) {
                        identity.savePairing(code.copy(token = "")); if (continuation.isActive) continuation.resume(Unit); webSocket.close(1000, "paired")
                    } else if (message.type == "chat.error" && continuation.isActive) continuation.resumeWith(Result.failure(IllegalStateException(message.payload["message"]?.toString() ?: "LAN pairing rejected")))
                }
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { if (continuation.isActive) continuation.resumeWith(Result.failure(t)) }
            })
            continuation.invokeOnCancellation { ws.cancel(); client.dispatcher.executorService.shutdown() }
        }
        client.dispatcher.executorService.shutdown()
    }

    fun send(type: String, payload: Map<String, Any?> = emptyMap(), requestId: String = UUID.randomUUID().toString()): String {
        check(_state.value == LanConnectionState.CONNECTED) { "LAN transport is not connected" }
        check(socket?.send(LanProtocol.encode(LanProtocol.Envelope(type, requestId, payload))) == true) { "LAN socket is closed" }
        return requestId
    }

    suspend fun request(type: String, payload: Map<String, Any?> = emptyMap(), timeoutMs: Long = 10_000L): LanProtocol.Envelope {
        val requestId = UUID.randomUUID().toString()
        val response = kotlinx.coroutines.withTimeout(timeoutMs) {
            coroutineScope {
                val result = async { events.filter { it.requestId == requestId }.first() }
                send(type, payload, requestId)
                result.await()
            }
        }
        return response
    }

    fun cancel(requestId: String) { if (_state.value == LanConnectionState.CONNECTED) send("chat.cancel", emptyMap(), requestId) }

    fun close() {
        closed = true; reconnectJob?.cancel(); reconnectJob = null
        socket?.close(1000, "closed"); socket = null
        pending.values.forEach { it.cancel(CancellationException("LAN socket closed")) }; pending.clear()
        _state.value = LanConnectionState.DISCONNECTED
    }

    private fun listener(connected: CompletableDeferred<Unit>, target: LanEndpoint) = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            _state.value = LanConnectionState.AUTHENTICATING
            webSocket.send(LanProtocol.encode(LanProtocol.Envelope("hello", payload = helloPayload(identity.deviceId(), target.certificateFingerprint))))
        }
        override fun onMessage(webSocket: WebSocket, text: String) {
            val message = LanProtocol.decode(text) ?: run { webSocket.close(1002, "invalid frame"); return }
            when (message.type) {
                "challenge" -> {
                    val nonce = message.payload["nonce"]?.toString() ?: run { webSocket.close(1008, "missing challenge"); return }
                    val deviceId = identity.deviceId()
                    val signature = identity.sign(LanProtocol.authMessage(nonce, target.instanceId, deviceId))
                    webSocket.send(LanProtocol.encode(LanProtocol.Envelope("authenticate", message.requestId, authenticatePayload(deviceId, signature))))
                }
                "authenticated" -> { _state.value = LanConnectionState.CONNECTED; attempts = 0; connected.complete(Unit) }
                "ping" -> webSocket.send(LanProtocol.encode(LanProtocol.Envelope("pong", message.requestId)))
                else -> { message.requestId?.let { pending.remove(it)?.complete(message) }; _events.tryEmit(message) }
            }
        }
        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            if (!connected.isCompleted) connected.completeExceptionally(t)
            _state.value = LanConnectionState.FAILED
            if (!closed) scheduleReconnect()
        }
        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { if (!closed) { _state.value = LanConnectionState.DISCONNECTED; scheduleReconnect() } }
    }

    companion object {
        fun helloPayload(deviceId: String, certificateFingerprint: String): Map<String, Any?> =
            mapOf("deviceId" to deviceId, "certificateFingerprint" to certificateFingerprint)
        fun authenticatePayload(deviceId: String, signature: String): Map<String, Any?> =
            mapOf("deviceId" to deviceId, "signature" to signature)
    }

    private fun scheduleReconnect() {
        if (reconnectJob?.isActive == true || endpoint == null) return
        reconnectJob = scope.launch {
            delay((1000L shl attempts.coerceAtMost(5)).coerceAtMost(30_000L)); attempts++
            endpoint?.let { connect(it) }
        }
    }

    private fun hexToBase64(hex: String): String = Base64.encodeToString(hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray(), Base64.NO_WRAP)
}
