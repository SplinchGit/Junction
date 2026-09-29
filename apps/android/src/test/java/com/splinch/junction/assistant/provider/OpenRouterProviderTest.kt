package com.splinch.junction.assistant.provider

import com.splinch.junction.assistant.context.ContextBlock
import com.splinch.junction.assistant.context.Provenance
import com.splinch.junction.assistant.tools.ToolDefinition
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.TimeUnit

class OpenRouterProviderTest {
    private val model = "nvidia/nemotron-3-ultra-550b-a55b:free"

    @Test
    fun `catalog exposes only Nemotron 3 Ultra free`() {
        val openRouter = ModelCatalog.providerById("openrouter")!!

        assertEquals("https://openrouter.ai/api/v1", openRouter.baseUrl)
        assertEquals(model, openRouter.defaultModelId)
        assertEquals(listOf(model), openRouter.models.map { it.id })
        assertEquals("Nemotron 3 Ultra (FREE)", openRouter.models.single().displayName)
        assertEquals(0.0, openRouter.models.single().inputPerMillionUsd, 0.0)
        assertEquals(0.0, openRouter.models.single().outputPerMillionUsd, 0.0)
        assertTrue(ModelCatalog.primaryProviders.any { it.id == "openrouter" })
    }

    @Test
    fun `OpenRouter streams Nemotron text and sends tools plus reasoning`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setResponseCode(200).setBody(
                    """
                    data: {"model":"$model","choices":[{"delta":{"content":"Hello "}}]}

                    data: {"choices":[{"delta":{"content":"Android"}}],"usage":{"prompt_tokens":9,"completion_tokens":2}}

                    data: [DONE]

                    """.trimIndent()
                ).addHeader("Content-Type", "text/event-stream")
            )
            val provider = OpenAiCompatibleProvider(
                id = "openrouter",
                apiKey = "test-key-never-log",
                workhorseModel = model,
                baseUrl = server.url("/api/v1").toString().removeSuffix("/")
            )
            val events = provider.act(
                context = listOf(ContextBlock("system", "Be concise", Provenance.JUNCTION), ContextBlock("user", "Hi", Provenance.OWNER)),
                tools = listOf(ToolDefinition("web_search", "Search", "{\"type\":\"object\"}")),
                useFrontier = false
            ).toList()

            assertEquals(listOf("Hello ", "Android"), events.filterIsInstance<LlmEvent.TextDelta>().map { it.delta })
            assertEquals("Hello Android", events.filterIsInstance<LlmEvent.TextDone>().single().text)
            assertEquals(model, events.filterIsInstance<LlmEvent.Usage>().single().usage.model)
            val request = server.takeRequest()
            assertEquals("Bearer test-key-never-log", request.headers["Authorization"])
            assertEquals("https://junction.app", request.headers["HTTP-Referer"])
            assertEquals("Junction", request.headers["X-Title"])
            val payload = JSONObject(request.body.readUtf8())
            assertEquals(model, payload.getString("model"))
            assertTrue(payload.getBoolean("stream"))
            assertTrue(payload.getJSONObject("stream_options").getBoolean("include_usage"))
            assertEquals("high", payload.getJSONObject("reasoning").getString("effort"))
            assertEquals("web_search", payload.getJSONArray("tools").getJSONObject(0).getJSONObject("function").getString("name"))
        }
    }

    @Test
    fun `OpenRouter rate limit is useful and never includes the API key`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(429).setBody("{\"error\":{\"message\":\"test-key-never-log exhausted\"}}"))
            val provider = OpenAiCompatibleProvider("openrouter", "test-key-never-log", model, baseUrl = server.url("/api/v1").toString().removeSuffix("/"))
            val error = provider.act(listOf(ContextBlock("user", "Hi", Provenance.OWNER)), emptyList(), false).toList().filterIsInstance<LlmEvent.Error>().single().message

            assertTrue(error.contains("rate limit", ignoreCase = true))
            assertFalse(error.contains("test-key-never-log"))
        }
    }

    @Test
    fun `Nemotron never automatically falls back to another provider`() {
        assertFalse(allowsAutomaticFallback("openrouter"))
        assertFalse(allowsAutomaticFallback("local"))
        assertTrue(allowsAutomaticFallback("openai"))
    }

    @Test
    fun `cancelling Nemotron stream promptly cancels blocked network read`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse()
                    .setResponseCode(200)
                    .addHeader("Content-Type", "text/event-stream")
                    .setBody("data: [DONE]\n\n")
                    .setBodyDelay(3, TimeUnit.SECONDS)
            )
            val provider = OpenAiCompatibleProvider(
                id = "openrouter",
                apiKey = "test-key-never-log",
                workhorseModel = model,
                baseUrl = server.url("/api/v1").toString().removeSuffix("/")
            )
            val job = launch(Dispatchers.Default) {
                provider.act(listOf(ContextBlock("user", "Hi", Provenance.OWNER)), emptyList(), false).toList()
            }
            assertTrue(server.takeRequest(2, TimeUnit.SECONDS) != null)
            val started = System.nanoTime()

            job.cancelAndJoin()

            val cancellationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started)
            assertTrue("Cancellation took ${cancellationMs}ms", cancellationMs < 1_500)
        }
    }
}
