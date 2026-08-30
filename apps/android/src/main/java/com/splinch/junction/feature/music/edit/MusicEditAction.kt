package com.splinch.junction.feature.music.edit

import com.splinch.junction.feature.music.model.*

sealed interface MusicEditAction {
    val description: String

    data class AddNote(val patternId: String, val pitch: Int, val startBeat: Double, val durationBeats: Double, val velocity: Float = 0.8f) : MusicEditAction { override val description = "Add note" }
    data class MoveNotes(val patternId: String, val noteIds: Set<String>, val deltaBeats: Double, val deltaPitch: Int) : MusicEditAction { override val description = "Move notes" }
    data class ResizeNotes(val patternId: String, val noteIds: Set<String>, val deltaBeats: Double) : MusicEditAction { override val description = "Resize notes" }
    data class DuplicateNotes(val patternId: String, val noteIds: Set<String>, val offsetBeats: Double) : MusicEditAction { override val description = "Duplicate notes" }
    data class DeleteNotes(val patternId: String, val noteIds: Set<String>) : MusicEditAction { override val description = "Delete notes" }
    data class AddInstrumentTrack(val name: String, val instrumentId: String) : MusicEditAction { override val description = "Add instrument track" }
    data class AddAudioTrack(val asset: AudioAsset, val startBeat: Double, val lengthBeats: Double) : MusicEditAction { override val description = "Add audio track" }
    data class AddSamplerTrack(val asset: AudioAsset, val instrument: Instrument) : MusicEditAction { override val description = "Add sampler instrument" }
    data class AddPatternClip(val trackId: String, val patternId: String, val startBeat: Double, val lengthBeats: Double) : MusicEditAction { override val description = "Place pattern" }
    data class MoveClip(val trackId: String, val clipId: String, val startBeat: Double) : MusicEditAction { override val description = "Move clip" }
    data class AssignInstrument(val trackId: String, val instrumentId: String) : MusicEditAction { override val description = "Change instrument" }
    data class SetTrackMixer(val trackId: String, val volume: Float? = null, val pan: Float? = null, val muted: Boolean? = null, val solo: Boolean? = null) : MusicEditAction { override val description = "Adjust mixer" }
    data class ToggleEffect(val trackId: String, val type: EffectType) : MusicEditAction { override val description = "Toggle effect" }
    data class SetEffectAmount(val trackId: String, val effectId: String, val amount: Float, val mix: Float) : MusicEditAction { override val description = "Adjust effect" }
    data class AddAutomationPoint(val trackId: String, val parameter: AutomationParameter, val beat: Double, val value: Float) : MusicEditAction { override val description = "Add automation point" }
}

object MusicProjectEditor {
    fun apply(project: MusicProject, action: MusicEditAction, grid: GridResolution): MusicProject {
        val changed = when (action) {
            is MusicEditAction.AddNote,
            is MusicEditAction.MoveNotes,
            is MusicEditAction.ResizeNotes,
            is MusicEditAction.DuplicateNotes,
            is MusicEditAction.DeleteNotes -> editNotes(project, action, grid)

            is MusicEditAction.AddInstrumentTrack -> project.copy(
                tracks = project.tracks + ArrangementTrack(name = action.name, instrumentId = action.instrumentId)
            )
            is MusicEditAction.AddAudioTrack -> project.copy(
                audioAssets = project.audioAssets.replaceById(action.asset),
                tracks = project.tracks + ArrangementTrack(
                    name = action.asset.name,
                    type = TrackType.AUDIO,
                    instrumentId = null,
                    audioClips = listOf(AudioClip(assetId = action.asset.id, startBeat = grid.snap(action.startBeat), lengthBeats = action.lengthBeats))
                )
            )
            is MusicEditAction.AddSamplerTrack -> project.copy(
                audioAssets = project.audioAssets.replaceById(action.asset),
                instruments = project.instruments.filterNot { it.id == action.instrument.id } + action.instrument,
                tracks = project.tracks + ArrangementTrack(name = action.instrument.name, instrumentId = action.instrument.id)
            )
            is MusicEditAction.AddPatternClip -> project.copy(tracks = project.tracks.map { track ->
                if (track.id != action.trackId) track else track.copy(patternClips = track.patternClips + PatternClip(
                    patternId = action.patternId, startBeat = grid.snap(action.startBeat), lengthBeats = action.lengthBeats
                ))
            })
            is MusicEditAction.MoveClip -> project.copy(tracks = project.tracks.map { track ->
                if (track.id != action.trackId) track else track.copy(
                    patternClips = track.patternClips.map { if (it.id == action.clipId) it.copy(startBeat = grid.snap(action.startBeat)) else it },
                    audioClips = track.audioClips.map { if (it.id == action.clipId) it.copy(startBeat = grid.snap(action.startBeat)) else it }
                )
            })
            is MusicEditAction.AssignInstrument -> project.copy(tracks = project.tracks.map {
                if (it.id == action.trackId) it.copy(instrumentId = action.instrumentId, type = TrackType.INSTRUMENT) else it
            })
            is MusicEditAction.SetTrackMixer -> project.copy(tracks = project.tracks.map { track ->
                if (track.id != action.trackId) track else track.copy(
                    volume = action.volume?.coerceIn(0f, 1f) ?: track.volume,
                    pan = action.pan?.coerceIn(-1f, 1f) ?: track.pan,
                    muted = action.muted ?: track.muted,
                    solo = action.solo ?: track.solo
                )
            })
            is MusicEditAction.ToggleEffect -> project.copy(tracks = project.tracks.map { track ->
                if (track.id != action.trackId) track else {
                    val existing = track.effects.firstOrNull { it.type == action.type }
                    track.copy(effects = if (existing == null) track.effects + TrackEffect(type = action.type)
                    else track.effects.map { if (it.id == existing.id) it.copy(enabled = !it.enabled) else it })
                }
            })
            is MusicEditAction.SetEffectAmount -> project.copy(tracks = project.tracks.map { track ->
                if (track.id != action.trackId) track else track.copy(effects = track.effects.map {
                    if (it.id == action.effectId) it.copy(amount = action.amount.coerceIn(0f, 1f), mix = action.mix.coerceIn(0f, 1f)) else it
                })
            })
            is MusicEditAction.AddAutomationPoint -> project.copy(tracks = project.tracks.map { track ->
                if (track.id != action.trackId) track else {
                    val lane = track.automation.firstOrNull { it.parameter == action.parameter }
                    val point = AutomationPoint(beat = grid.snap(action.beat), value = action.value.coerceIn(-1f, 1f))
                    track.copy(automation = if (lane == null) track.automation + AutomationLane(parameter = action.parameter, points = listOf(point))
                    else track.automation.map { if (it.id == lane.id) it.copy(points = (it.points + point).sortedBy(AutomationPoint::beat)) else it })
                }
            })
        }
        if (changed == project) return project
        val furthestClip = changed.tracks.maxOfOrNull { track ->
            maxOf(
                track.patternClips.maxOfOrNull { it.startBeat + it.lengthBeats } ?: 0.0,
                track.audioClips.maxOfOrNull { it.startBeat + it.lengthBeats } ?: 0.0
            )
        } ?: 0.0
        val barsNeeded = kotlin.math.ceil(furthestClip / changed.timeSignature.numerator).coerceAtLeast(1.0)
        return changed.copy(
            schemaVersion = CURRENT_MUSIC_PROJECT_SCHEMA,
            arrangementLengthBeats = maxOf(changed.arrangementLengthBeats, barsNeeded * changed.timeSignature.numerator),
            updatedAtEpochMs = System.currentTimeMillis()
        )
    }

    private fun editNotes(project: MusicProject, action: MusicEditAction, grid: GridResolution): MusicProject {
        val patternId = when (action) {
            is MusicEditAction.AddNote -> action.patternId
            is MusicEditAction.MoveNotes -> action.patternId
            is MusicEditAction.ResizeNotes -> action.patternId
            is MusicEditAction.DuplicateNotes -> action.patternId
            is MusicEditAction.DeleteNotes -> action.patternId
            else -> return project
        }
        return project.copy(patterns = project.patterns.map { pattern ->
            if (pattern.id != patternId) pattern else when (action) {
                is MusicEditAction.AddNote -> {
                    val start = grid.snap(action.startBeat).coerceAtMost(pattern.lengthBeats - grid.stepBeats)
                    val duration = grid.snap(action.durationBeats).coerceAtLeast(grid.stepBeats).coerceAtMost(pattern.lengthBeats - start)
                    pattern.copy(notes = pattern.notes + Note(pitch = action.pitch.coerceIn(0, 127), startBeat = start, durationBeats = duration, velocity = action.velocity.coerceIn(0f, 1f)))
                }
                is MusicEditAction.MoveNotes -> pattern.copy(notes = pattern.notes.map { note -> if (note.id !in action.noteIds) note else note.copy(
                    pitch = (note.pitch + action.deltaPitch).coerceIn(0, 127),
                    startBeat = grid.snap(note.startBeat + action.deltaBeats).coerceIn(0.0, (pattern.lengthBeats - note.durationBeats).coerceAtLeast(0.0))
                ) })
                is MusicEditAction.ResizeNotes -> pattern.copy(notes = pattern.notes.map { note -> if (note.id !in action.noteIds) note else note.copy(
                    durationBeats = grid.snap(note.durationBeats + action.deltaBeats).coerceAtLeast(grid.stepBeats).coerceAtMost(pattern.lengthBeats - note.startBeat)
                ) })
                is MusicEditAction.DuplicateNotes -> pattern.copy(notes = pattern.notes + pattern.notes.filter { it.id in action.noteIds }.mapNotNull { note ->
                    val start = grid.snap(note.startBeat + action.offsetBeats)
                    note.copy(id = musicId(), startBeat = start).takeIf { start + note.durationBeats <= pattern.lengthBeats }
                })
                is MusicEditAction.DeleteNotes -> pattern.copy(notes = pattern.notes.filterNot { it.id in action.noteIds })
                else -> pattern
            }
        })
    }

    private fun List<AudioAsset>.replaceById(asset: AudioAsset): List<AudioAsset> = filterNot { it.id == asset.id } + asset
}
