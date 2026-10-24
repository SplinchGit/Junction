package com.splinch.junction.assistant.runtime

import com.splinch.junction.feature.voice.model.VoiceCallState
import com.splinch.junction.feature.voice.model.VoiceCallStatus
import com.splinch.junction.feature.voice.model.formatCallDuration

/** How this one message reached Junction. */
enum class InputMode { TYPED, SPOKEN }

/**
 * Transient, per-turn interaction state: text or voice, whether a call is live, whether this
 * message was spoken, and whether the reply will be spoken. Rebuilt for every turn and never
 * written to memory, so Nethra stops "speaking" the moment a call ends.
 */
data class TurnSessionContext(
    val voiceActive: Boolean,
    val input: InputMode,
    val spokenOutput: Boolean,
    val sessionId: String?,
    val elapsedMs: Long?,
    val callState: VoiceCallState
) {
    val mode: String get() = if (voiceActive) "voice" else "text"

    /** Payload sent to the paired PC with the message (validated again on the host). */
    fun toPayload(): Map<String, Any?> = buildMap {
        put("mode", mode)
        put("voiceActive", voiceActive)
        put("input", if (input == InputMode.SPOKEN) "spoken" else "typed")
        put("spokenOutput", spokenOutput)
        sessionId?.let { put("sessionId", it) }
        elapsedMs?.let { put("elapsedMs", it) }
        if (voiceActive) put("callState", callState.name.lowercase())
    }

    /** One line for providers that receive a system prompt from the phone. */
    fun promptLine(): String = if (voiceActive) {
        "Voice call active${sessionId?.let { " (session $it" + (elapsedMs?.let { ms -> ", ${formatCallDuration(ms)} elapsed" } ?: "") + ")" } ?: ""}. " +
            "This message was ${if (input == InputMode.SPOKEN) "spoken" else "typed"}; your reply ${if (spokenOutput) "will be read aloud" else "will be shown as text"}."
    } else {
        "No voice call is active; this is text chat${if (input == InputMode.SPOKEN) " (the message was dictated)" else ""}. " +
            if (spokenOutput) "Read-aloud output is enabled; your reply will be read aloud." else "Your reply will be shown as text."
    }

    companion object {
        fun of(call: VoiceCallStatus, speechOutputOn: Boolean, input: InputMode, nowElapsedMs: Long): TurnSessionContext {
            val live = call.state == VoiceCallState.ACTIVE || call.state == VoiceCallState.RECONNECTING
            return TurnSessionContext(
                voiceActive = live,
                input = input,
                spokenOutput = speechOutputOn,
                sessionId = if (live) call.sessionId else null,
                elapsedMs = if (live) call.elapsedMs(nowElapsedMs) else null,
                callState = call.state
            )
        }

        /** Read by PC providers when they build the request for the turn in progress. */
        @Volatile var current: TurnSessionContext? = null
    }
}
