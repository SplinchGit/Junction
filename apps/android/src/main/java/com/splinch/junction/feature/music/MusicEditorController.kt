package com.splinch.junction.feature.music

import android.content.Context
import android.net.Uri
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.splinch.junction.feature.music.edit.MusicEditAction
import com.splinch.junction.feature.music.edit.MusicProjectEditor
import com.splinch.junction.feature.music.model.*
import com.splinch.junction.feature.music.persistence.MusicAssetStore
import com.splinch.junction.feature.music.persistence.MusicProjectStore
import com.splinch.junction.feature.music.playback.MusicPlaybackEngine
import com.splinch.junction.platform.audio.AndroidAudioRecorder
import com.splinch.junction.platform.audio.AndroidSynthPlaybackEngine
import java.io.File
import kotlinx.coroutines.*

enum class ProjectSaveState { LOADING, SAVED, UNSAVED, SAVING, ERROR }

@Stable
class MusicEditorController(
    context: Context,
    private val scope: CoroutineScope,
    private val store: MusicProjectStore = MusicProjectStore(context.applicationContext),
    private val playback: MusicPlaybackEngine = AndroidSynthPlaybackEngine()
) {
    private val assets = MusicAssetStore(context.applicationContext)
    private val recorder = AndroidAudioRecorder()
    private var recordingFile: File? = null

    var project by mutableStateOf(MusicProject.starter()); private set
    var activePatternId by mutableStateOf(project.patterns.first().id); private set
    var selectedTrackId by mutableStateOf(project.tracks.first().id); private set
    var selectedNoteIds by mutableStateOf<Set<String>>(emptySet()); private set
    var grid by mutableStateOf(GridResolution.SIXTEENTH); private set
    var saveState by mutableStateOf(ProjectSaveState.LOADING); private set
    var isPlaying by mutableStateOf(false); private set
    var isRecording by mutableStateOf(false); private set
    var isExporting by mutableStateOf(false); private set
    var playheadBeat by mutableDoubleStateOf(0.0); private set
    var statusMessage by mutableStateOf<String?>(null); private set

    private val undoStack = ArrayDeque<MusicProject>()
    private val redoStack = ArrayDeque<MusicProject>()
    private var autosaveJob: Job? = null
    private var revision = 0

    init {
        scope.launch {
            val loaded = withContext(Dispatchers.IO) { store.loadOrCreate() }
            project = loaded
            activePatternId = loaded.patterns.firstOrNull()?.id.orEmpty()
            selectedTrackId = loaded.tracks.firstOrNull()?.id.orEmpty()
            saveState = ProjectSaveState.SAVED
        }
    }

    fun chooseGrid(value: GridResolution) { grid = value }
    fun selectNotes(ids: Set<String>) { selectedNoteIds = ids }
    fun selectTrack(id: String) { selectedTrackId = id }
    fun openPattern(id: String) { if (project.pattern(id) != null) activePatternId = id }

    fun edit(action: MusicEditAction) {
        val updated = MusicProjectEditor.apply(project, action, grid)
        if (updated == project) return
        undoStack.addLast(project); while (undoStack.size > MAX_HISTORY) undoStack.removeFirst()
        redoStack.clear(); project = updated
        if (selectedTrackId.isBlank() || project.track(selectedTrackId) == null) selectedTrackId = project.tracks.lastOrNull()?.id.orEmpty()
        selectedNoteIds = selectedNoteIds.filterTo(mutableSetOf()) { id -> project.pattern(activePatternId)?.notes?.any { it.id == id } == true }
        markChanged()
    }

    fun addInstrumentTrack() {
        val instrument = project.instruments.firstOrNull() ?: return
        edit(MusicEditAction.AddInstrumentTrack("Instrument ${project.tracks.size + 1}", instrument.id))
        selectedTrackId = project.tracks.last().id
    }

    fun addPatternClip() {
        val track = project.track(selectedTrackId)?.takeIf { it.type == TrackType.INSTRUMENT } ?: return
        val pattern = project.pattern(activePatternId) ?: return
        val start = track.patternClips.maxOfOrNull { it.startBeat + it.lengthBeats } ?: 0.0
        edit(MusicEditAction.AddPatternClip(track.id, pattern.id, start, pattern.lengthBeats))
    }

    fun moveClip(trackId: String, clipId: String, startBeat: Double) = edit(MusicEditAction.MoveClip(trackId, clipId, startBeat))

    fun assignInstrument(trackId: String, instrumentId: String) = edit(MusicEditAction.AssignInstrument(trackId, instrumentId))
    fun setMixer(trackId: String, volume: Float? = null, pan: Float? = null, muted: Boolean? = null, solo: Boolean? = null) =
        edit(MusicEditAction.SetTrackMixer(trackId, volume, pan, muted, solo))
    fun toggleEffect(trackId: String, type: EffectType) = edit(MusicEditAction.ToggleEffect(trackId, type))
    fun setEffect(trackId: String, effectId: String, amount: Float, mix: Float) = edit(MusicEditAction.SetEffectAmount(trackId, effectId, amount, mix))
    fun addAutomationPoint(parameter: AutomationParameter, beat: Double, value: Float) {
        if (selectedTrackId.isNotBlank()) edit(MusicEditAction.AddAutomationPoint(selectedTrackId, parameter, beat, value))
    }

    fun importWav(uri: Uri, asSampler: Boolean) {
        statusMessage = "Importing WAV…"
        scope.launch {
            runCatching { withContext(Dispatchers.IO) { assets.importWav(uri) } }
                .onSuccess { asset ->
                    if (asSampler) {
                        val instrument = Instrument(name = asset.name, kind = InstrumentKind.SAMPLER, sampleAssetId = asset.id)
                        edit(MusicEditAction.AddSamplerTrack(asset, instrument))
                        selectedTrackId = project.tracks.last().id
                        project.pattern(activePatternId)?.let { pattern ->
                            edit(MusicEditAction.AddPatternClip(selectedTrackId, pattern.id, 0.0, pattern.lengthBeats))
                        }
                    } else {
                        val beats = (asset.durationSeconds * project.tempo / 60.0).coerceAtLeast(grid.stepBeats)
                        edit(MusicEditAction.AddAudioTrack(asset, playheadBeat, beats))
                    }
                    selectedTrackId = project.tracks.last().id
                    statusMessage = if (asSampler) "Sampler added" else "Audio track added"
                }
                .onFailure { statusMessage = it.message ?: "Only 16-bit PCM WAV files are supported" }
        }
    }

    fun startRecording(): Boolean {
        stop()
        recordingFile = assets.recordingFile()
        isRecording = recorder.start()
        statusMessage = if (isRecording) "Recording…" else "Could not start microphone recording"
        return isRecording
    }

    fun stopRecording() {
        val file = recordingFile ?: return
        val pcm = recorder.stop(file)
        isRecording = false; recordingFile = null
        if (pcm == null || pcm.frameCount == 0) { statusMessage = "No audio was recorded"; return }
        val asset = assets.assetForRecording(file)
        val beats = (asset.durationSeconds * project.tempo / 60.0).coerceAtLeast(grid.stepBeats)
        edit(MusicEditAction.AddAudioTrack(asset, playheadBeat, beats))
        selectedTrackId = project.tracks.last().id
        statusMessage = "Recording added to arrangement"
    }

    fun exportWav(onReady: (File) -> Unit) {
        if (isExporting) return
        isExporting = true; statusMessage = "Rendering WAV…"
        scope.launch {
            runCatching { withContext(Dispatchers.Default) { assets.export(project) } }
                .onSuccess { statusMessage = "WAV exported"; onReady(it) }
                .onFailure { statusMessage = it.message ?: "Export failed" }
            isExporting = false
        }
    }

    fun undo() { if (undoStack.isNotEmpty()) { stop(); redoStack.addLast(project); project = undoStack.removeLast(); selectedNoteIds = emptySet(); markChanged() } }
    fun redo() { if (redoStack.isNotEmpty()) { stop(); undoStack.addLast(project); project = redoStack.removeLast(); selectedNoteIds = emptySet(); markChanged() } }
    fun duplicateSelection(offsetBeats: Double = project.timeSignature.numerator.toDouble()) { if (selectedNoteIds.isNotEmpty()) edit(MusicEditAction.DuplicateNotes(activePatternId, selectedNoteIds, offsetBeats)) }
    fun deleteSelection() { if (selectedNoteIds.isNotEmpty()) { edit(MusicEditAction.DeleteNotes(activePatternId, selectedNoteIds)); selectedNoteIds = emptySet() } }
    fun togglePlayback() { if (isPlaying) stop() else play() }

    fun play() {
        isPlaying = true; playheadBeat = 0.0
        playback.playArrangement(project, assets.assetDirectory,
            onPosition = { beat -> scope.launch { playheadBeat = beat } },
            onComplete = { scope.launch { isPlaying = false; playheadBeat = 0.0 } })
    }

    fun stop() { playback.stop(); isPlaying = false; playheadBeat = 0.0 }

    fun saveNow() {
        autosaveJob?.cancel(); val snapshot = project; val savingRevision = revision; saveState = ProjectSaveState.SAVING
        scope.launch { runCatching { withContext(Dispatchers.IO) { store.save(snapshot) } }
            .onSuccess { saveState = if (revision == savingRevision) ProjectSaveState.SAVED else ProjectSaveState.UNSAVED }
            .onFailure { saveState = ProjectSaveState.ERROR } }
    }

    fun close() {
        if (isRecording) stopRecording(); stop(); autosaveJob?.cancel()
        if (saveState in setOf(ProjectSaveState.UNSAVED, ProjectSaveState.SAVING, ProjectSaveState.ERROR)) runCatching { runBlocking(Dispatchers.IO) { store.save(project) } }
    }

    private fun markChanged() {
        revision += 1; saveState = ProjectSaveState.UNSAVED; autosaveJob?.cancel()
        autosaveJob = scope.launch { delay(AUTOSAVE_DELAY_MS); saveNow() }
    }

    companion object { private const val MAX_HISTORY = 100; private const val AUTOSAVE_DELAY_MS = 750L }
}
