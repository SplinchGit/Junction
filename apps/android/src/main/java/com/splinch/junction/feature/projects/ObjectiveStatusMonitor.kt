package com.splinch.junction.feature.projects

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.splinch.junction.data.sync.lan.NethraClient
import com.splinch.junction.data.secret.KeyStorage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * One shared copy of the objective list for the chat header and the Tasks sheet.
 * Polled only while chat is on screen: every minute on LAN, every three minutes over
 * the relay, where each request costs billed Firestore writes.
 */
object ObjectiveStatusMonitor {
    private const val CACHE_KEY = "nethra_objective_snapshot_v1"
    private val state = MutableStateFlow<List<Map<*, *>>>(emptyList())
    val objectives: StateFlow<List<Map<*, *>>> = state
    private val syncTime = MutableStateFlow<Long?>(null)
    val lastSyncedAt: StateFlow<Long?> = syncTime
    private val connection = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = connection

    fun restore(context: Context) {
        if (syncTime.value != null) return
        runCatching { ObjectiveSnapshotCodec.decode(KeyStorage(context.applicationContext).getSecret(CACHE_KEY)) }
            .onSuccess { cached -> state.value = cached.objectives; syncTime.value = cached.asOf }
    }

    fun publish(context: Context, objectives: List<Map<*, *>>) {
        val now = System.currentTimeMillis()
        state.value = objectives
        syncTime.value = now
        connection.value = true
        runCatching { KeyStorage(context.applicationContext).setSecret(CACHE_KEY, ObjectiveSnapshotCodec.encode(now, objectives)) }
    }

    fun disconnected() { connection.value = false }

    suspend fun pollWhileVisible(context: Context, client: NethraClient) {
        restore(context)
        while (true) {
            var failed = false
            try {
                publish(context, (client.request("nethra.list")["objectives"] as? List<*>)?.mapNotNull { it as? Map<*, *> }.orEmpty())
            } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { failed = true; disconnected() }
            delay(if (!failed && NethraClient.lastTransport == NethraClient.Transport.LAN) 60_000L else 180_000L)
        }
    }
}

fun ObjectiveLight.color(): Color = when (this) {
    ObjectiveLight.GREEN -> Color(0xFF2EB872)
    ObjectiveLight.AMBER -> Color(0xFFF2A93B)
    ObjectiveLight.RED -> Color(0xFFE05252)
    ObjectiveLight.GREY -> Color(0xFF8A8F98)
}

@Composable
fun StatusDot(light: ObjectiveLight, size: Dp = 10.dp, modifier: Modifier = Modifier) {
    Box(modifier.size(size).background(light.color(), CircleShape))
}
