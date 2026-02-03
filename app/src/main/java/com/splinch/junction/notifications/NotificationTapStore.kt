package com.splinch.junction.notifications

import android.app.PendingIntent
import android.os.SystemClock
import java.util.LinkedHashMap

object NotificationTapStore {
    private const val MAX_ENTRIES = 200
    private const val TTL_MS = 6 * 60 * 60 * 1000L
    private val entries = LinkedHashMap<String, Entry>()

    private data class Entry(
        val pendingIntent: PendingIntent,
        val storedAtElapsed: Long
    )

    fun put(threadKey: String, pendingIntent: PendingIntent?) {
        if (pendingIntent == null) return
        synchronized(entries) {
            entries[threadKey] = Entry(pendingIntent, SystemClock.elapsedRealtime())
            trimLocked()
        }
    }

    fun trySend(threadKey: String): Boolean {
        val entry = synchronized(entries) { entries[threadKey] } ?: return false
        return try {
            entry.pendingIntent.send()
            true
        } catch (_: PendingIntent.CanceledException) {
            synchronized(entries) { entries.remove(threadKey) }
            false
        }
    }

    private fun trimLocked() {
        val now = SystemClock.elapsedRealtime()
        val iterator = entries.entries.iterator()
        while (iterator.hasNext()) {
            val entry = iterator.next()
            if (now - entry.value.storedAtElapsed > TTL_MS) {
                iterator.remove()
            }
        }
        while (entries.size > MAX_ENTRIES) {
            val firstKey = entries.keys.firstOrNull() ?: break
            entries.remove(firstKey)
        }
    }
}
