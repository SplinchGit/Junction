package com.splinch.junction.chat.provider

import com.splinch.junction.chat.Provenance

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
