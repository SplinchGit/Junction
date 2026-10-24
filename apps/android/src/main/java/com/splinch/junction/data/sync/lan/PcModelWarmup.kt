package com.splinch.junction.data.sync.lan

import android.content.Context
import android.os.SystemClock
import com.splinch.junction.data.sync.firebase.LocalBrainPairingStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Asks the paired PC to load its model before the owner's message arrives: on app open,
 * opening or starting a chat, and entering voice mode. The host deduplicates and never
 * generates text, appends messages or creates tasks; this side only throttles.
 * Nothing here cancels or depends on host work: leaving the app changes nothing on the PC.
 */
object PcModelWarmup {
    /** Host-reported model state: ready, busy, loading, cold, deferred, failed, unavailable, or null if unknown. */
    private val _state = MutableStateFlow<String?>(null)
    val state: StateFlow<String?> = _state.asStateFlow()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var lastRequestAt = Long.MIN_VALUE / 2
    private const val MIN_INTERVAL_MS = 20_000L

    fun request(context: Context, reason: String) {
        val now = SystemClock.elapsedRealtime()
        if (now - lastRequestAt < MIN_INTERVAL_MS) return
        lastRequestAt = now
        val app = context.applicationContext
        scope.launch {
            val paired = runCatching { LanIdentityStore(app).loadPairing() != null || LocalBrainPairingStore.load(app) != null }.getOrDefault(false)
            if (!paired) return@launch
            val client = NethraClient(app)
            val result = runCatching { client.request("nethra.warm", mapOf("reason" to reason)) }
                // An older PC host does not know nethra.warm; its status check also warms.
                .recoverCatching { error -> if (error.message?.contains("Unsupported Nethra operation") == true) client.request("nethra.status") else throw error }
                .getOrNull()
            @Suppress("UNCHECKED_CAST")
            val model = (result?.get("model") as? Map<String, Any?>) ?: (result?.get("modelState") as? Map<String, Any?>)
            _state.value = model?.get("state")?.toString() ?: if (result == null) "unreachable" else _state.value
        }
    }
}
