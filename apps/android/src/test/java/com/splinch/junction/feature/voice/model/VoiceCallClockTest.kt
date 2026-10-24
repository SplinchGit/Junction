package com.splinch.junction.feature.voice.model

import org.junit.Assert.*
import org.junit.Test

class VoiceCallClockTest {
    @Test fun `timer excludes connection gaps and freezes after hangup`() {
        val clock = VoiceCallClock { "call-1" }
        assertEquals(0L, clock.connecting().elapsedMs(900))
        assertEquals(500L, clock.active(1000).elapsedMs(1500))
        assertEquals(600L, clock.reconnecting(1600).elapsedMs(3000))
        assertEquals(1100L, clock.active(3000).elapsedMs(3500))
        assertEquals(1200L, clock.ended(3600).elapsedMs(9000))
        assertEquals(VoiceCallState.ENDED, clock.active(10000).state)
        assertEquals(1200L, clock.ended(11000).elapsedMs(12000))
    }

    @Test fun `repeated active callback does not reset start time`() {
        val clock = VoiceCallClock { "call" }
        clock.connecting()
        clock.active(100)
        assertEquals(900L, clock.active(700).elapsedMs(1000))
        assertEquals("1:02:09", formatCallDuration(3729000))
    }
}
