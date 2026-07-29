package com.splinch.junction.chat.provider

import com.splinch.junction.chat.Provenance

data class ContextBlock(
    val role: String,        // "user", "assistant", "system"
    val content: String,
    val provenance: Provenance,
    val sourceRef: String? = null  // e.g. notification key, email thread id
)
