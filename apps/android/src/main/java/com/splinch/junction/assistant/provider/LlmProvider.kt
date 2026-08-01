package com.splinch.junction.assistant.provider

import com.splinch.junction.assistant.context.*
import com.splinch.junction.assistant.conversation.*
import com.splinch.junction.assistant.planning.*
import com.splinch.junction.assistant.provider.*
import com.splinch.junction.assistant.runtime.*
import com.splinch.junction.assistant.tools.*
import com.splinch.junction.assistant.trust.*

import kotlinx.coroutines.flow.Flow

/**
 * Prompt used by [LlmProvider.describeImage]. Asks for a factual description
 * dense enough to answer follow-up questions from text alone, since that
 * description is what replaces the image on every later turn.
 */
internal const val DESCRIBE_IMAGE_PROMPT =
    "Describe this image factually in 2-3 sentences. Include any visible text verbatim, " +
        "plus the key objects, people, layout, and anything that looks significant. This " +
        "description will stand in for the image later, so be specific rather than general. " +
        "Reply with the description only."

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

    /**
     * Reader lane, image variant — also tool-free. Returns a one-line
     * description of an image so it can be replayed as cheap text in later
     * turns rather than re-uploading the bytes every request.
     *
     * Defaults to null so a provider without vision (or a custom endpoint of
     * unknown capability) degrades to "an image was attached" rather than
     * failing the turn.
     */
    suspend fun describeImage(imageBase64: String, mimeType: String): String? = null
}
