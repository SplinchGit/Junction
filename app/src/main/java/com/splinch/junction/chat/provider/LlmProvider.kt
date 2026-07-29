package com.splinch.junction.chat.provider

import kotlinx.coroutines.flow.Flow

interface LlmProvider {
    val id: String
    val workhorseModel: String
    val frontierModel: String?

    /**
     * Actor lane — has tools, processes owner turns.
     * [useFrontier] escalates to frontierModel if configured.
     */
    fun act(
        context: List<ContextBlock>,
        tools: List<ToolDefinition>,
        useFrontier: Boolean = false
    ): Flow<LlmEvent>

    /**
     * Reader lane — NO tools parameter. Structurally incapable of emitting a tool call.
     * Parses untrusted content into a validated ReaderOutput.
     * Returns null (discards) if the response cannot be parsed.
     */
    suspend fun readUntrusted(content: String, sourceHint: String = ""): ReaderOutput?
}
