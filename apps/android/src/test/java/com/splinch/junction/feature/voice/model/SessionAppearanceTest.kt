package com.splinch.junction.feature.voice.model

import com.splinch.junction.assistant.runtime.InputMode
import com.splinch.junction.assistant.runtime.TurnSessionContext
import com.splinch.junction.data.preference.AppearancePrefs
import org.junit.Assert.*
import org.junit.Test

class SessionAppearanceTest {
    @Test fun `ended call cannot leak voice identity into next text turn`() {
        val ended = VoiceCallStatus(VoiceCallState.ENDED, "old-call", endedDurationMs = 500)
        val context = TurnSessionContext.of(ended, true, InputMode.TYPED, 900)
        assertEquals("text", context.mode)
        assertFalse(context.voiceActive)
        assertNull(context.sessionId)
        assertFalse(context.toPayload().containsKey("elapsedMs"))
    }

    @Test fun `typed message during a call remains typed with authoritative elapsed time`() {
        val live = VoiceCallStatus(VoiceCallState.ACTIVE, "call", activeSinceElapsedMs = 100)
        val context = TurnSessionContext.of(live, true, InputMode.TYPED, 900)
        assertEquals("typed", context.toPayload()["input"])
        assertEquals(800L, context.toPayload()["elapsedMs"])
        assertTrue(context.spokenOutput)
    }

    @Test fun `read aloud outside call reports output independently of call state`() {
        val context = TurnSessionContext.of(VoiceCallStatus(), true, InputMode.TYPED, 900)
        assertFalse(context.voiceActive)
        assertTrue(context.spokenOutput)
        assertTrue(context.promptLine().contains("read aloud"))
    }

    @Test fun `motion respects reduced motion power saving and artwork choice`() {
        val art = AppearancePrefs(artwork = "sakura-mountain")
        assertTrue(art.petalsAllowed(false, false))
        assertFalse(art.petalsAllowed(true, false))
        assertFalse(art.petalsAllowed(false, true))
        assertFalse(art.copy(artwork = "none").petalsAllowed(false, false))
        assertFalse(art.copy(motion = "reduced").petalsAllowed(false, false))
        assertEquals(100, art.copy(backgroundIntensity = 200).normalized().backgroundIntensity)
        assertEquals("system", art.copy(mode = "invalid").normalized().mode)
    }
}
