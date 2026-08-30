package com.splinch.junction.feature.music

import com.splinch.junction.feature.music.edit.MusicEditAction
import com.splinch.junction.feature.music.edit.MusicProjectEditor
import com.splinch.junction.feature.music.model.ArrangementTrack
import com.splinch.junction.feature.music.model.AutomationLane
import com.splinch.junction.feature.music.model.AutomationParameter
import com.splinch.junction.feature.music.model.AutomationPoint
import com.splinch.junction.feature.music.model.AudioAsset
import com.splinch.junction.feature.music.model.AudioClip
import com.splinch.junction.feature.music.model.EffectType
import com.splinch.junction.feature.music.model.GridResolution
import com.splinch.junction.feature.music.model.MusicProject
import com.splinch.junction.feature.music.model.Note
import com.splinch.junction.feature.music.model.Pattern
import com.splinch.junction.feature.music.model.PatternClip
import com.splinch.junction.feature.music.model.TrackEffect
import com.splinch.junction.feature.music.persistence.MusicProjectCodec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class MusicProjectTest {
    @Test
    fun `project codec round trips durable musical data`() {
        val pattern = Pattern(
            id = "pattern-a",
            name = "Bass",
            lengthBeats = 8.0,
            notes = listOf(Note(id = "note-a", pitch = 43, startBeat = 1.25, durationBeats = 0.5, velocity = 0.73f))
        )
        val project = MusicProject(
            id = "project-a",
            name = "Night Drive",
            tempo = 174.0,
            patterns = listOf(pattern),
            audioAssets = listOf(AudioAsset("asset-a", "Vocal", "asset-a.wav", 2.0, 44_100, 1)),
            tracks = listOf(
                ArrangementTrack(
                    id = "track-a",
                    name = "Bass",
                    volume = 0.65f,
                    pan = -0.2f,
                    patternClips = listOf(
                        PatternClip(id = "clip-a", patternId = pattern.id, startBeat = 4.0, lengthBeats = 8.0)
                    ),
                    audioClips = listOf(AudioClip(id = "audio-clip", assetId = "asset-a", startBeat = 12.0, lengthBeats = 4.0)),
                    effects = listOf(TrackEffect(id = "effect-a", type = EffectType.DELAY, amount = 0.3f, mix = 0.2f)),
                    automation = listOf(AutomationLane(id = "lane-a", parameter = AutomationParameter.PAN, points = listOf(AutomationPoint(id = "point-a", beat = 0.0, value = -0.5f))))
                )
            ),
            updatedAtEpochMs = 1234L
        )

        assertEquals(project, MusicProjectCodec.decode(MusicProjectCodec.encode(project)))
    }

    @Test
    fun `schema one project migrates with factory instruments and arrangement defaults`() {
        val legacy = """{
            "schemaVersion":1,"id":"old","name":"Legacy","tempo":120,
            "patterns":[{"id":"p","name":"Pattern","lengthBeats":4,"notes":[]}],
            "tracks":[{"id":"t","name":"Track","muted":false,"solo":false,"volume":0.8,"pan":0,
              "clips":[{"id":"c","patternId":"p","startBeat":0,"lengthBeats":4,"offsetBeats":0}]}]
        }"""

        val migrated = MusicProjectCodec.decode(legacy)

        assertEquals(2, migrated.schemaVersion)
        assertEquals(64.0, migrated.arrangementLengthBeats, 0.0)
        assertEquals(1, migrated.tracks.single().patternClips.size)
        assertEquals("factory-keys", migrated.tracks.single().instrumentId)
    }

    @Test
    fun `automation interpolates between musical points`() {
        val lane = AutomationLane(
            parameter = AutomationParameter.VOLUME,
            points = listOf(AutomationPoint(beat = 0.0, value = 0f), AutomationPoint(beat = 4.0, value = 1f))
        )
        assertEquals(0.5f, lane.valueAt(2.0, 0.8f), 0.0001f)
    }

    @Test
    fun `move and resize use musical grid rather than pixels`() {
        val note = Note(id = "note-a", pitch = 60, startBeat = 0.0, durationBeats = 1.0)
        val pattern = Pattern(id = "pattern-a", name = "Lead", notes = listOf(note))
        val project = MusicProject(patterns = listOf(pattern))

        val moved = MusicProjectEditor.apply(
            project,
            MusicEditAction.MoveNotes(pattern.id, setOf(note.id), deltaBeats = 0.37, deltaPitch = 12),
            GridResolution.SIXTEENTH
        )
        val resized = MusicProjectEditor.apply(
            moved,
            MusicEditAction.ResizeNotes(pattern.id, setOf(note.id), deltaBeats = -0.38),
            GridResolution.SIXTEENTH
        )

        val result = resized.pattern(pattern.id)!!.notes.single()
        assertEquals(72, result.pitch)
        assertEquals(0.25, result.startBeat, 0.00001)
        assertEquals(0.5, result.durationBeats, 0.00001)
    }

    @Test
    fun `duplicate creates independent note identity`() {
        val note = Note(id = "note-a", pitch = 60, startBeat = 0.0, durationBeats = 1.0)
        val pattern = Pattern(id = "pattern-a", name = "Lead", notes = listOf(note))
        val project = MusicProject(patterns = listOf(pattern))

        val duplicated = MusicProjectEditor.apply(
            project,
            MusicEditAction.DuplicateNotes(pattern.id, setOf(note.id), offsetBeats = 4.0),
            GridResolution.SIXTEENTH
        ).pattern(pattern.id)!!.notes

        assertEquals(2, duplicated.size)
        assertEquals(4.0, duplicated.last().startBeat, 0.00001)
        assertNotEquals(duplicated.first().id, duplicated.last().id)
    }

    @Test
    fun `out of range duplicate is ignored instead of corrupting pattern`() {
        val note = Note(id = "note-a", pitch = 60, startBeat = 15.5, durationBeats = 0.5)
        val pattern = Pattern(id = "pattern-a", name = "Lead", notes = listOf(note))
        val project = MusicProject(patterns = listOf(pattern))

        val notes = MusicProjectEditor.apply(
            project,
            MusicEditAction.DuplicateNotes(pattern.id, setOf(note.id), offsetBeats = 4.0),
            GridResolution.SIXTEENTH
        ).pattern(pattern.id)!!.notes

        assertEquals(listOf(note), notes)
    }
}
