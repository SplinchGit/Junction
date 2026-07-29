package com.splinch.junction.chat.provider

data class ToolDefinition(
    val name: String,
    val description: String,
    val parametersJson: String   // JSON Schema object string for the "parameters" field
)
