package com.splinch.junction.assistant.provider

import com.splinch.junction.assistant.context.*
import com.splinch.junction.assistant.conversation.*
import com.splinch.junction.assistant.planning.*
import com.splinch.junction.assistant.provider.*
import com.splinch.junction.assistant.runtime.*
import com.splinch.junction.assistant.tools.*
import com.splinch.junction.assistant.trust.*

sealed class LlmEvent {
    /** A concise owner-facing state transition, never raw provider diagnostics. */
    data class Activity(val label: String) : LlmEvent()
    data class TextDelta(val delta: String) : LlmEvent()
    /**
     * A completed assistant message.  Local providers can attach the reasoning
     * trace and decode speed they received from their runtime; these are kept
     * separate from answer text so the UI can keep them collapsed by default.
     */
    data class TextDone(
        val text: String,
        val thinking: String? = null,
        val tokensPerSecond: Double? = null
    ) : LlmEvent()
    data class Thinking(val text: String) : LlmEvent()
    data class ToolCallRequested(
        val callId: String,
        val name: String,
        val arguments: String
    ) : LlmEvent()
    data class Usage(val usage: ProviderUsage) : LlmEvent()
    data class Error(val message: String) : LlmEvent()
    object Done : LlmEvent()
}

/** Token counts reported by the provider for one completed model response. */
data class ProviderUsage(
    val provider: String,
    val model: String,
    val tokensIn: Int?,
    val tokensOut: Int?
)
