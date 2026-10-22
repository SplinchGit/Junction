package com.splinch.junction.assistant.provider

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The verbose footer must report what the host measured and nothing more. */
class HostTelemetryTest {

    private val full = mapOf(
        "model" to "qwen3:14b",
        "tokensPerSecond" to 30.78,
        "generatedTokens" to 1500,
        "inputTokens" to 1024,
        "durationMs" to 4480,
        "loadMs" to 12,
        "evalMs" to 4875,
        "modelCalls" to 2,
        "toolsExecuted" to 1,
        "toolCalls" to 1,
        "toolNames" to listOf("read_file"),
        "thinkingState" to "off",
        "thinkingCharacters" to 0
    )

    @Test
    fun `reports speed tokens and timing`() {
        val line = HostTelemetry.line(full)!!
        assertTrue(line, line.contains("qwen3:14b"))
        assertTrue(line, line.contains("30.8 tok/s"))
        assertTrue(line, line.contains("1,500 out"))
        assertTrue(line, line.contains("1,024 in"))
        assertTrue(line, line.contains("4.48s total"))
        assertTrue(line, line.contains("1 tool (read_file)"))
        assertTrue(line, line.contains("thinking off"))
    }

    @Test
    fun `unmeasured speed is omitted rather than shown as zero`() {
        val line = HostTelemetry.line(mapOf("model" to "qwen3:14b", "tokensPerSecond" to 0, "durationMs" to 1200))!!
        assertTrue(line, !line.contains("tok/s"))
        assertTrue(line, line.contains("1.20s total"))
        assertNull(HostTelemetry.tokensPerSecond(mapOf("tokensPerSecond" to 0)))
    }

    @Test
    fun `absent or empty metrics produce no footer`() {
        assertNull(HostTelemetry.line(null))
        assertNull(HostTelemetry.line(emptyMap()))
        assertNull(HostTelemetry.tokensPerSecond(null))
    }

    @Test
    fun `string encoded numbers are accepted`() {
        assertEquals(30.78, HostTelemetry.tokensPerSecond(mapOf("tokensPerSecond" to "30.78"))!!, 0.001)
    }

    @Test
    fun `tool requests that never executed are distinguished`() {
        val line = HostTelemetry.line(mapOf("toolCalls" to 2, "toolsExecuted" to 0))!!
        assertTrue(line, line.contains("2 tool requests; none executed"))
    }

    @Test
    fun `thinking states are described distinctly`() {
        assertTrue(HostTelemetry.line(mapOf("thinkingState" to "reported", "thinkingCharacters" to 970))!!.contains("970 thinking chars"))
        assertTrue(HostTelemetry.line(mapOf("thinkingState" to "enabled_no_output"))!!.contains("thinking on; none reported"))
    }

    @Test
    fun `long runs switch to a coarser duration`() {
        assertTrue(HostTelemetry.line(mapOf("durationMs" to 46161))!!.contains("46.2s total"))
    }
}
