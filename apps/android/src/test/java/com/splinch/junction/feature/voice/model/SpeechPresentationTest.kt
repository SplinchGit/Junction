package com.splinch.junction.feature.voice.model

import java.util.Locale
import org.junit.Assert.*
import org.junit.Test

class SpeechPresentationTest {
    @Test fun `speech removes presentation markup without losing numbers or link labels`() {
        assertEquals("Results\nThe price is £12.50, down -2%. Read the guide.",
            speechText("## Results\n- The **price** is £12.50, down -2%. Read [the guide](https://example.com). [S1.p2]"))
        assertEquals("Use x = 2.", speechText("Use `x = 2`."))
    }
    @Test fun `code blocks are announced rather than read as punctuation`() {
        assertEquals("Example:\nCode is shown in the chat.", speechText("Example:\n```js\nconst x = {};\n```"))
    }
    @Test fun `voice selection prefers installed offline locale match and then quality`() {
        val voices = listOf(
            SpeechVoice("cloud", Locale.UK, 500, 100, networkRequired = true),
            SpeechVoice("missing", Locale.UK, 500, 100, installed = false),
            SpeechVoice("us", Locale.US, 500, 100),
            SpeechVoice("basic", Locale.UK, 200, 100),
            SpeechVoice("natural", Locale.UK, 400, 200),
            SpeechVoice("slow", Locale.UK, 400, 400))
        assertEquals("natural", preferredSpeechVoice(voices, Locale.UK))
        assertNull(preferredSpeechVoice(voices, Locale.JAPAN))
    }
}
