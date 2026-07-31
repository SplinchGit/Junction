package com.splinch.junction.chat.voice

/**
 * Decides when the recogniser should be re-armed while the mic is on.
 *
 * Android's [android.speech.SpeechRecognizer] is single-shot: it hears one utterance,
 * delivers a result, and stops. Without something re-arming it, turning the mic on
 * buys the owner exactly one sentence -- and the "Mic on" chip stays lit the whole
 * time, so Junction looks like it is listening when it has actually gone deaf. That
 * is indistinguishable from voice being broken.
 *
 * Re-arming naively is its own failure: a device with no recogniser, a revoked mic
 * permission, or a stuck audio route will fail instantly every time and spin a hot
 * loop that burns battery and floods the log. So empty turns are counted, and after
 * [maxSilentTurns] of them in a row the loop gives up and says so.
 *
 * Pure state machine, no Android types, so the policy is unit tested rather than
 * inferred from a device.
 */
class HandsFreeLoop(private val maxSilentTurns: Int = DEFAULT_MAX_SILENT_TURNS) {

    /** How the loop should treat an owner who has gone quiet. */
    enum class Mode {
        /**
         * One-off hands-free listening. Sustained silence stands the mic down, on the
         * assumption the owner has walked away from a single request.
         */
        HANDS_FREE,

        /**
         * A call. The owner opened the line and only the owner closes it, so silence is
         * a pause in a conversation rather than a reason to hang up.
         */
        CALL
    }

    /** What the session should do once a listening or speaking turn finishes. */
    sealed interface Decision {
        /** Re-arm the recogniser immediately: the previous turn produced speech. */
        data object ReArmNow : Decision

        /** Re-arm after a pause: the last turn heard nothing, so don't spin. */
        data class ReArmAfter(val delayMillis: Long) : Decision

        /** Too many silent turns in a row -- stand down and tell the owner. */
        data object GiveUp : Decision

        /** Hands-free is off; the owner muted the mic or ended speech mode. */
        data object Idle : Decision
    }

    var isActive: Boolean = false
        private set

    var mode: Mode = Mode.HANDS_FREE
        private set

    private var silentTurns = 0

    /** The owner turned the mic on. */
    fun start(mode: Mode = Mode.HANDS_FREE) {
        this.mode = mode
        isActive = true
        silentTurns = 0
    }

    /** The owner turned the mic off, or the session is shutting down. */
    fun stop() {
        isActive = false
        silentTurns = 0
    }

    /** A turn produced real speech; the loop is healthy. */
    fun onSpeechHeard(): Decision {
        if (!isActive) return Decision.Idle
        silentTurns = 0
        // Don't re-arm yet: a reply is on its way and the recogniser must not
        // listen to Junction's own voice.
        return Decision.Idle
    }

    /** Junction finished speaking its reply, so the owner's turn is next. */
    fun onReplyFinished(): Decision =
        if (isActive) Decision.ReArmNow else Decision.Idle

    /** A listening turn ended with nothing usable: silence, no match, or a recoverable error. */
    fun onSilentTurn(): Decision {
        if (!isActive) return Decision.Idle
        silentTurns++
        if (mode == Mode.CALL) {
            // A call is never ended by quiet. People pause to think, read something, or
            // just listen, and dropping the line mid-conversation is precisely what makes
            // voice feel broken. But a recogniser that is genuinely dead also reports
            // silence forever, so the retry backs off instead of re-arming at full tilt:
            // the line stays open at a battery cost that stops growing.
            return Decision.ReArmAfter(callBackoffMillis())
        }
        if (silentTurns >= maxSilentTurns) {
            isActive = false
            return Decision.GiveUp
        }
        return Decision.ReArmAfter(SILENT_RETRY_DELAY_MS)
    }

    /** Linear backoff to a ceiling, so a quiet line still re-checks every few seconds. */
    private fun callBackoffMillis(): Long =
        (SILENT_RETRY_DELAY_MS * silentTurns).coerceAtMost(CALL_MAX_RETRY_DELAY_MS)

    /** An unrecoverable failure -- no permission, no recogniser. Never retry these. */
    fun onFatalError(): Decision {
        isActive = false
        silentTurns = 0
        return Decision.Idle
    }

    companion object {
        /**
         * Roughly a minute of quiet at the retry delay below. Long enough that the
         * owner can think mid-conversation, short enough that a permanently broken
         * recogniser stops burning the battery.
         */
        const val DEFAULT_MAX_SILENT_TURNS = 12

        /** Long enough not to spin, short enough to feel continuous. */
        const val SILENT_RETRY_DELAY_MS = 500L

        /**
         * Ceiling for the call-mode backoff. A line quiet for a long stretch still
         * re-arms every few seconds, so the owner speaking up is picked straight back
         * up rather than after a delay that has crept into the tens of seconds.
         */
        const val CALL_MAX_RETRY_DELAY_MS = 4_000L
    }
}
