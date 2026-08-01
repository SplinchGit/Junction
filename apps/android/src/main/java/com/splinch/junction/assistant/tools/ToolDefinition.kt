package com.splinch.junction.assistant.tools

import com.splinch.junction.assistant.context.*
import com.splinch.junction.assistant.conversation.*
import com.splinch.junction.assistant.planning.*
import com.splinch.junction.assistant.provider.*
import com.splinch.junction.assistant.runtime.*
import com.splinch.junction.assistant.tools.*
import com.splinch.junction.assistant.trust.*

data class ToolDefinition(
    val name: String,
    val description: String,
    val parametersJson: String   // JSON Schema object string for the "parameters" field
)
