package com.splinch.junction.feature.voice.model

/** What the owner sees for a call. ENDED is shown briefly with the final duration. */
enum class VoiceCallState { IDLE, CONNECTING, ACTIVE, RECONNECTING, ENDED }

/**
 * Snapshot of the live call. [activeSinceElapsedMs] is on the monotonic clock
 * (`SystemClock.elapsedRealtime`), so recreating the UI or changing the wall clock cannot
 * move the timer. [accumulatedMs] carries time already spent active before a reconnect.
 */
data class VoiceCallStatus(
    val state: VoiceCallState = VoiceCallState.IDLE,
    val sessionId: String? = null,
    val activeSinceElapsedMs: Long? = null,
    val accumulatedMs: Long = 0L,
    val endedDurationMs: Long? = null
) {
    /** Elapsed active time at [nowElapsedMs]; excludes connecting and reconnecting gaps. */
    fun elapsedMs(nowElapsedMs: Long): Long = when (state) {
        VoiceCallState.ACTIVE -> accumulatedMs + (nowElapsedMs - (activeSinceElapsedMs ?: nowElapsedMs)).coerceAtLeast(0L)
        VoiceCallState.ENDED -> endedDurationMs ?: accumulatedMs
        else -> accumulatedMs
    }

    val isLive: Boolean get() = state == VoiceCallState.CONNECTING || state == VoiceCallState.ACTIVE || state == VoiceCallState.RECONNECTING
}

/**
 * Pure state machine for the call timer. The timer starts when the call actually becomes
 * active (the recogniser is listening, or Realtime connected), not when the button is
 * pressed, and stops exactly once when the call ends or fails.
 */
class VoiceCallClock(private val newSessionId: () -> String) {
    var status: VoiceCallStatus = VoiceCallStatus()
        private set

    fun connecting(): VoiceCallStatus {
        if (status.isLive) return status
        status = VoiceCallStatus(state = VoiceCallState.CONNECTING, sessionId = newSessionId())
        return status
    }

    fun active(nowElapsedMs: Long): VoiceCallStatus {
        status = when (status.state) {
            VoiceCallState.ACTIVE -> status
            VoiceCallState.CONNECTING, VoiceCallState.RECONNECTING ->
                status.copy(state = VoiceCallState.ACTIVE, activeSinceElapsedMs = nowElapsedMs)
            // A stray "listening" callback after hang-up must not resurrect the call.
            VoiceCallState.IDLE, VoiceCallState.ENDED -> status
        }
        return status
    }

    fun reconnecting(nowElapsedMs: Long): VoiceCallStatus {
        if (status.state != VoiceCallState.ACTIVE) return status
        status = status.copy(state = VoiceCallState.RECONNECTING, accumulatedMs = status.elapsedMs(nowElapsedMs), activeSinceElapsedMs = null)
        return status
    }

    fun ended(nowElapsedMs: Long): VoiceCallStatus {
        if (!status.isLive) return status
        status = status.copy(state = VoiceCallState.ENDED, endedDurationMs = status.elapsedMs(nowElapsedMs), activeSinceElapsedMs = null)
        return status
    }

    fun idle(): VoiceCallStatus {
        if (status.isLive) return status
        status = VoiceCallStatus()
        return status
    }
}

/** "4:07", or "1:02:09" past an hour. */
fun formatCallDuration(ms: Long): String {
    val total = (ms / 1000L).coerceAtLeast(0L)
    val hours = total / 3600L
    val minutes = (total % 3600L) / 60L
    val seconds = total % 60L
    return if (hours > 0) "%d:%02d:%02d".format(hours, minutes, seconds) else "%d:%02d".format(minutes, seconds)
}
