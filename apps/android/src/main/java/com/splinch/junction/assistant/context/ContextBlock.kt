package com.splinch.junction.assistant.context

import com.splinch.junction.assistant.context.*
import com.splinch.junction.assistant.conversation.*
import com.splinch.junction.assistant.planning.*
import com.splinch.junction.assistant.provider.*
import com.splinch.junction.assistant.runtime.*
import com.splinch.junction.assistant.tools.*
import com.splinch.junction.assistant.trust.*

import com.splinch.junction.assistant.context.Provenance

data class ContextBlock(
    val role: String,        // "user", "assistant", "system"
    val content: String,
    val provenance: Provenance,
    val sourceRef: String? = null,  // e.g. notification key, email thread id
    // Optional attached image, base64-encoded already (no data: URI prefix) --
    // both AnthropicProvider and OpenAiCompatibleProvider build the right
    // multipart content shape for their own API when this is non-null.
    val imageBase64: String? = null,
    val imageMimeType: String? = null
)
