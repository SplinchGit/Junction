package com.splinch.junction.feature.music

import com.splinch.junction.feature.music.model.ArrangementTrack
import com.splinch.junction.feature.music.model.MusicProject
import com.splinch.junction.feature.music.model.Note
import com.splinch.junction.feature.music.model.Pattern
import com.splinch.junction.feature.music.model.PatternClip
import com.splinch.junction.platform.audio.MusicProjectRenderer
import com.splinch.junction.platform.audio.WavCodec
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MusicRendererTest {
    @Test
    fun `arrangement renderer produces stereo audio and wav round trip`() {
        val pattern = Pattern(id = "pattern", name = "One note", lengthBeats = 1.0, notes = listOf(Note(pitch = 69, startBeat = 0.0, durationBeats = 1.0)))
        val project = MusicProject(
            tempo = 120.0,
            arrangementLengthBeats = 1.0,
            patterns = listOf(pattern),
            tracks = listOf(ArrangementTrack(id = "track", name = "Synth", patternClips = listOf(PatternClip(patternId = pattern.id, startBeat = 0.0, lengthBeats = 1.0))))
        )
        val directory = Files.createTempDirectory("junction-renderer").toFile()
        val samples = MusicProjectRenderer(directory).render(project)
        val wav = directory.resolve("mix.wav")
        WavCodec.writeStereo(wav, samples)
        val decoded = WavCodec.read(wav)

        assertEquals(44_100, samples.size)
        assertTrue(samples.any { kotlin.math.abs(it) > 0.001f })
        assertEquals(2, decoded.channels)
        assertEquals(samples.size, decoded.samples.size)
    }
}
