package com.splinch.junction.assistant.context

import com.splinch.junction.assistant.context.*
import com.splinch.junction.assistant.conversation.*
import com.splinch.junction.assistant.planning.*
import com.splinch.junction.assistant.provider.*
import com.splinch.junction.assistant.runtime.*
import com.splinch.junction.assistant.tools.*
import com.splinch.junction.assistant.trust.*

data class Entity(
    val type: String,   // "person", "date", "amount", "thread_id", etc.
    val value: String
)

data class ReaderOutput(
    val summary: String,                   // ≤ 400 chars
    val entities: List<Entity> = emptyList(),
    val contentRequests: List<String> = emptyList(),  // injected instructions surfaced as observations
    val salience: Float = 0f               // 0..1, for proactivity gating
)
