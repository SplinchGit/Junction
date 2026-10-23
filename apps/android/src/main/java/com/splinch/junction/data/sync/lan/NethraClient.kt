package com.splinch.junction.data.sync.lan

import android.content.Context
import com.google.firebase.Timestamp
import com.google.firebase.firestore.ListenerRegistration
import com.splinch.junction.data.secret.KeyStorage
import com.splinch.junction.data.sync.firebase.FirebaseProvider
import com.splinch.junction.data.sync.firebase.LocalBrainPairingStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import kotlin.coroutines.coroutineContext
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Uses only this device's saved PC trust and existing encrypted device relay. */
class NethraClient(context: Context) {
    private val context = context.applicationContext
    private val identity = LanIdentityStore(this.context)
    private val keys = KeyStorage(this.context)
    private val pendingPreferences = this.context.getSharedPreferences("nethra_pending_request_ids", Context.MODE_PRIVATE)
    private val unresolved = PendingNethraRequestIds(
        load = { pendingPreferences.getString(it, null) },
        save = { key, id -> check(pendingPreferences.edit().putString(key, id).commit()) { "Could not save the pending Junction request identity" } },
        remove = { key -> check(pendingPreferences.edit().remove(key).commit()) { "Could not clear the completed Junction request identity" } }
    )
    private class Rejected(message: String) : IllegalStateException(message)

    suspend fun request(type: String, payload: Map<String, Any?> = emptyMap()): Map<String, Any?> = try { withTimeout(45_000) {
        require(type in TYPES) { "Unsupported Nethra request" }
        val mutation = type !in setOf("nethra.list", "nethra.get", "nethra.reunion", "nethra.status", "nethra.device.pull")
        // Persist a digest-bound id before sending so a process restart cannot replay a mutation as new.
        val (binding, requestId) = if (mutation) unresolved.getOrCreate(type, payload) else "" to UUID.randomUUID().toString()
        val pairing = identity.loadPairing()
        // The paired LAN path is always attempted first. A saved relay preference
        // must not strand objectives on an otherwise reachable private network.
        if (pairing != null) {
            val discovered = mutableListOf<LanEndpoint>()
            val discovery = LanDiscovery(context)
            try {
                runCatching { discovery.discover({ endpoint ->
                    if (endpoint.instanceId == pairing.instanceId) synchronized(discovered) {
                        if (discovered.size < 8) discovered.add(endpoint)
                    }
                }) }
                delay(1_500)
            } finally { discovery.stop() }
            val lanDeadline = android.os.SystemClock.elapsedRealtime() + 9_000L
            for (candidate in lanCandidates(synchronized(discovered) { discovered.toList() }, pairing, keys.getSecret("lan_manual_host_v1")).take(4)) {
                val remaining = lanDeadline - android.os.SystemClock.elapsedRealtime()
                if (remaining <= 0) break
                val transport = LanTransport(identity)
                try {
                    val response = withTimeoutOrNull(minOf(remaining, 7_000L)) {
                        transport.connect(candidate).getOrThrow()
                        transport.request(type, payload, timeoutMs = 6_000, requestId = requestId)
                    }
                    if (response != null) {
                        if (response.type != "$type.result") {
                            if (mutation) unresolved.clear(binding)
                            throw Rejected(response.payload["message"]?.toString() ?: "Junction Windows rejected the request.")
                        }
                        if (mutation) unresolved.clear(binding)
                        return@withTimeout response.payload
                    }
                } catch (_: TimeoutCancellationException) { coroutineContext.ensureActive() }
                catch (error: CancellationException) { throw error }
                catch (error: Rejected) { throw error }
                catch (error: Exception) {
                    coroutineContext.ensureActive()
                    if (!canTryAnotherLanAddress(error)) throw error
                } finally { transport.close() }
                }
        }
        coroutineContext.ensureActive()
        val result = exchange(type, payload, requestId)
        if (mutation) unresolved.clear(binding)
        result
    } } catch (timeout: TimeoutCancellationException) {
        coroutineContext.ensureActive()
        throw IllegalStateException("The PC did not confirm within 45 seconds. Refresh to check saved progress; retrying the same request uses its original identity.", timeout)
    }

    private suspend fun exchange(type: String, payload: Map<String, Any?>, requestId: String): Map<String, Any?> {
        val pairing = LocalBrainPairingStore.load(context) ?: error("The PC is unreachable. Connect on Wi-Fi or set up the encrypted PC pairing in Settings.")
        val uid = LocalBrainPairingStore.ensureAnonymous(context)
        check(uid == pairing.clientUid) { "The saved device identity changed. Pair this phone with the PC again." }
        val firestore = FirebaseProvider.firestoreOrNull() ?: error("The encrypted PC relay is unavailable.")
        val id = UUID.randomUUID().toString()
        val body = JSONObject().put("mode", "agent_api").put("type", type).put("payload", JSONObject(payload)).put("requestId", requestId)
        val encrypted = LocalBrainPairingStore.encrypt(pairing.key, "JBP1|${pairing.brainId}|$id|request", body.toString())
        val ref = firestore.collection("local_brains").document(pairing.brainId).collection("commands").document(id)
        // Preserve the established relay document fields and AES-GCM associated data.
        // A fresh encrypted relay command uses the same owner request ID as LAN.
        ref.set(mapOf("id" to id, "clientUid" to uid, "status" to "pending", "ciphertext" to encrypted.first, "nonce" to encrypted.second, "createdAt" to Timestamp.now(), "source" to "junction_local_llm_v2")).await()
        var listener: ListenerRegistration? = null
        val response = try {
            suspendCancellableCoroutine<String> { continuation ->
                listener = ref.addSnapshotListener { snapshot, failure ->
                    if (!continuation.isActive) return@addSnapshotListener
                    if (failure != null) { continuation.resumeWithException(failure); return@addSnapshotListener }
                    when (snapshot?.getString("status")) {
                        "done" -> runCatching {
                            LocalBrainPairingStore.decrypt(pairing.key, "JBP1|${pairing.brainId}|$id|response", snapshot.getString("responseCiphertext") ?: error("Missing encrypted reply"), snapshot.getString("responseNonce") ?: error("Missing encrypted reply nonce"))
                        }.fold({ continuation.resume(it) }, { continuation.resumeWithException(it) })
                        "error" -> continuation.resumeWithException(Rejected(snapshot.getString("error") ?: "The PC rejected the request."))
                    }
                }
                continuation.invokeOnCancellation { listener?.remove() }
                if (!continuation.isActive) listener?.remove()
            }
        } finally { listener?.remove() }
        return objectMap(JSONObject(response))
    }

    companion object {
        private val TYPES = setOf("nethra.list", "nethra.get", "nethra.reunion", "nethra.create", "nethra.configure", "nethra.control", "nethra.approve", "nethra.settings", "nethra.status", "nethra.answer", "nethra.device.pull", "nethra.device.result")
        private fun value(value: Any?): Any? = when (value) {
            is JSONObject -> objectMap(value)
            is JSONArray -> (0 until value.length()).map { value(value.get(it)) }
            JSONObject.NULL -> null
            else -> value
        }
        private fun objectMap(json: JSONObject): Map<String, Any?> = json.keys().asSequence().associateWith { value(json.get(it)) }
    }
}
