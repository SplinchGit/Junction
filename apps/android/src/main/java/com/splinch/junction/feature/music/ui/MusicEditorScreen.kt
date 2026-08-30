package com.splinch.junction.feature.music.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Paint
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Redo
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.splinch.junction.feature.music.MusicEditorController
import com.splinch.junction.feature.music.ProjectSaveState
import com.splinch.junction.feature.music.edit.MusicEditAction
import com.splinch.junction.feature.music.model.*
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.round

private const val MIN_PITCH = 36
private const val MAX_PITCH = 84
private enum class EditorPage(val label: String) { ARRANGEMENT("Arrange"), PIANO_ROLL("Piano"), MIXER("Mixer"), AUTOMATION("Automation") }

@Composable
fun MusicEditorScreen(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val controller = remember { MusicEditorController(context.applicationContext, scope) }
    var page by remember { mutableStateOf(EditorPage.ARRANGEMENT) }
    var importAsSampler by remember { mutableStateOf(false) }
    val importLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let { controller.importWav(it, importAsSampler) }
    }
    val recordPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) controller.startRecording()
    }
    DisposableEffect(controller) { onDispose(controller::close) }

    fun toggleRecording() {
        if (controller.isRecording) controller.stopRecording()
        else if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) controller.startRecording()
        else recordPermission.launch(Manifest.permission.RECORD_AUDIO)
    }

    fun shareExport() = controller.exportWav { file ->
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", file)
        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
            type = "audio/wav"; putExtra(Intent.EXTRA_STREAM, uri); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }, "Export Junction mix"))
    }

    Column(modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {
        EditorToolbar(controller, page, { page = it }, ::toggleRecording, ::shareExport)
        controller.statusMessage?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(horizontal = 12.dp)) }
        when (page) {
            EditorPage.ARRANGEMENT -> ArrangementView(
                controller,
                onOpenPattern = { controller.openPattern(it); page = EditorPage.PIANO_ROLL },
                onImportAudio = { importAsSampler = false; importLauncher.launch(arrayOf("audio/wav", "audio/x-wav")) },
                onImportSampler = { importAsSampler = true; importLauncher.launch(arrayOf("audio/wav", "audio/x-wav")) }
            )
            EditorPage.PIANO_ROLL -> PianoRollPage(controller)
            EditorPage.MIXER -> MixerView(controller)
            EditorPage.AUTOMATION -> AutomationView(controller)
        }
    }
}

@Composable
private fun EditorToolbar(
    controller: MusicEditorController,
    page: EditorPage,
    onPage: (EditorPage) -> Unit,
    onRecord: () -> Unit,
    onExport: () -> Unit
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            FilledIconButton(onClick = controller::togglePlayback) {
                Icon(if (controller.isPlaying) Icons.Default.Stop else Icons.Default.PlayArrow, if (controller.isPlaying) "Stop" else "Play arrangement")
            }
            IconButton(onClick = onRecord) { Icon(Icons.Default.FiberManualRecord, if (controller.isRecording) "Stop recording" else "Record audio", tint = if (controller.isRecording) Color.Red else LocalContentColor.current) }
            IconButton(onClick = controller::undo) { Icon(Icons.AutoMirrored.Filled.Undo, "Undo") }
            IconButton(onClick = controller::redo) { Icon(Icons.AutoMirrored.Filled.Redo, "Redo") }
            IconButton(onClick = controller::saveNow) { Icon(Icons.Default.Save, "Save project") }
            IconButton(onClick = onExport, enabled = !controller.isExporting) { Icon(Icons.Default.FileUpload, "Export WAV") }
            Column(Modifier.padding(start = 4.dp)) {
                Text(controller.project.name, style = MaterialTheme.typography.titleSmall)
                Text(saveLabel(controller.saveState), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            EditorPage.entries.forEach { FilterChip(selected = page == it, onClick = { onPage(it) }, label = { Text(it.label) }) }
        }
    }
}

private fun saveLabel(state: ProjectSaveState) = when (state) {
    ProjectSaveState.LOADING -> "Loading…"; ProjectSaveState.SAVED -> "Saved"; ProjectSaveState.UNSAVED -> "Autosave pending"
    ProjectSaveState.SAVING -> "Saving…"; ProjectSaveState.ERROR -> "Save failed"
}

@Composable
private fun ArrangementView(
    controller: MusicEditorController,
    onOpenPattern: (String) -> Unit,
    onImportAudio: () -> Unit,
    onImportSampler: () -> Unit
) {
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = controller::addInstrumentTrack) { Icon(Icons.Default.Add, null); Text("Instrument") }
            OutlinedButton(onClick = controller::addPatternClip) { Icon(Icons.Default.ContentCopy, null); Text("Place pattern") }
            OutlinedButton(onClick = onImportAudio) { Icon(Icons.Default.AudioFile, null); Text("Audio WAV") }
            OutlinedButton(onClick = onImportSampler) { Icon(Icons.Default.Piano, null); Text("Sampler") }
        }
        Text("Tap a track to select · tap a pattern to edit · drag clips to move", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
        ArrangementCanvas(controller, onOpenPattern)
    }
}

private data class ArrangementHit(val trackId: String, val clipId: String, val patternId: String?, val startBeat: Double, val rect: Rect)

@Composable
private fun ArrangementCanvas(controller: MusicEditorController, onOpenPattern: (String) -> Unit) {
    val density = LocalDensity.current
    val header = with(density) { 112.dp.toPx() }; val beatWidth = with(density) { 28.dp.toPx() }; val rowHeight = with(density) { 68.dp.toPx() }
    val width = header + controller.project.arrangementLengthBeats.toFloat() * beatWidth
    val height = maxOf(rowHeight, controller.project.tracks.size * rowHeight)
    val scrollX = rememberScrollState(); val scrollY = rememberScrollState()
    val primary = MaterialTheme.colorScheme.primary; val tertiary = MaterialTheme.colorScheme.tertiary
    val surface = MaterialTheme.colorScheme.surface; val rowAlt = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .35f)
    val outline = MaterialTheme.colorScheme.outlineVariant
    Box(Modifier.fillMaxSize().horizontalScroll(scrollX).verticalScroll(scrollY)) {
        Canvas(Modifier.size(with(density) { width.toDp() }, with(density) { height.toDp() }).pointerInput(controller.project, controller.grid) {
            awaitEachGesture {
                val down = awaitFirstDown(false); val start = down.position; var last = start; var moved = false
                val hits = arrangementHits(controller.project, header, beatWidth, rowHeight)
                val hit = hits.lastOrNull { it.rect.contains(start) }
                val row = floor(start.y / rowHeight).toInt()
                controller.project.tracks.getOrNull(row)?.let { controller.selectTrack(it.id) }
                drag(down.id) { change -> change.consume(); last = change.position; moved = moved || (last - start).getDistance() > 6.dp.toPx() }
                if (hit != null && moved) controller.moveClip(hit.trackId, hit.clipId, hit.startBeat + (last.x - start.x) / beatWidth)
                else if (hit?.patternId != null) onOpenPattern(hit.patternId)
            }
        }) {
            drawRect(surface)
            controller.project.tracks.forEachIndexed { index, track ->
                val top = index * rowHeight
                if (index % 2 == 1) drawRect(rowAlt, Offset(0f, top), Size(size.width, rowHeight))
                if (track.id == controller.selectedTrackId) drawRect(primary.copy(alpha = .10f), Offset(0f, top), Size(size.width, rowHeight))
                drawLine(outline, Offset(0f, top), Offset(size.width, top))
                drawLabel(track.name, 8f, top + 27f, if (track.type == TrackType.AUDIO) "AUDIO" else "MIDI")
            }
            var beat = 0
            while (beat <= controller.project.arrangementLengthBeats.toInt()) {
                val x = header + beat * beatWidth
                drawLine(if (beat % controller.project.timeSignature.numerator == 0) outline.copy(alpha = 1f) else outline.copy(alpha = .45f), Offset(x, 0f), Offset(x, size.height), if (beat % 4 == 0) 2f else 1f)
                beat++
            }
            arrangementHits(controller.project, header, beatWidth, rowHeight).forEach { hit ->
                drawRoundRect(if (hit.patternId == null) tertiary else primary, hit.rect.topLeft + Offset(2f, 8f), Size(hit.rect.width - 4f, hit.rect.height - 16f), CornerRadius(8f))
                drawContext.canvas.nativeCanvas.drawText(if (hit.patternId == null) "Audio" else controller.project.pattern(hit.patternId)?.name ?: "Pattern", hit.rect.left + 8f, hit.rect.top + 32f, Paint().apply { color = android.graphics.Color.WHITE; textSize = 13.dp.toPx(); isAntiAlias = true })
            }
            if (controller.playheadBeat > 0) {
                val x = header + controller.playheadBeat.toFloat() * beatWidth; drawLine(Color.Red, Offset(x, 0f), Offset(x, size.height), 3f)
            }
        }
    }
}

private fun arrangementHits(project: MusicProject, header: Float, beatWidth: Float, rowHeight: Float): List<ArrangementHit> = buildList {
    project.tracks.forEachIndexed { index, track ->
        track.patternClips.forEach { add(ArrangementHit(track.id, it.id, it.patternId, it.startBeat, Rect(header + it.startBeat.toFloat() * beatWidth, index * rowHeight, header + (it.startBeat + it.lengthBeats).toFloat() * beatWidth, (index + 1) * rowHeight))) }
        track.audioClips.forEach { add(ArrangementHit(track.id, it.id, null, it.startBeat, Rect(header + it.startBeat.toFloat() * beatWidth, index * rowHeight, header + (it.startBeat + it.lengthBeats).toFloat() * beatWidth, (index + 1) * rowHeight))) }
    }
}

private fun DrawScope.drawLabel(name: String, x: Float, y: Float, kind: String) {
    val paint = Paint().apply { color = android.graphics.Color.GRAY; textSize = 13f * density; isAntiAlias = true }
    drawContext.canvas.nativeCanvas.drawText(name.take(14), x, y, paint)
    paint.textSize = 9f * density; drawContext.canvas.nativeCanvas.drawText(kind, x, y + 18f * density, paint)
}

@Composable
private fun MixerView(controller: MusicEditorController) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        controller.project.tracks.forEach { track ->
            Card { Column(Modifier.padding(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(track.name, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                    FilterChip(track.muted, { controller.setMixer(track.id, muted = !track.muted) }, { Text("M") })
                    Spacer(Modifier.width(6.dp)); FilterChip(track.solo, { controller.setMixer(track.id, solo = !track.solo) }, { Text("S") })
                }
                Text("Volume ${(track.volume * 100).toInt()}%"); Slider(track.volume, { controller.setMixer(track.id, volume = it) })
                Text("Pan ${(track.pan * 100).toInt()}"); Slider(track.pan, { controller.setMixer(track.id, pan = it) }, valueRange = -1f..1f)
                if (track.type == TrackType.INSTRUMENT) {
                    Text("Instrument", style = MaterialTheme.typography.labelMedium)
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        controller.project.instruments.forEach { instrument -> FilterChip(track.instrumentId == instrument.id, { controller.assignInstrument(track.id, instrument.id) }, { Text(instrument.name) }) }
                    }
                }
                Text("Effects", style = MaterialTheme.typography.labelMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { EffectType.entries.forEach { type ->
                    val active = track.effects.firstOrNull { it.type == type }?.enabled == true
                    FilterChip(active, { controller.toggleEffect(track.id, type) }, { Text(type.name.replace('_', ' ')) })
                } }
                track.effects.filter { it.enabled }.forEach { effect ->
                    Text("${effect.type.name}: amount ${(effect.amount * 100).toInt()}% · mix ${(effect.mix * 100).toInt()}%", style = MaterialTheme.typography.labelSmall)
                    Slider(effect.amount, { controller.setEffect(track.id, effect.id, it, effect.mix) })
                    Slider(effect.mix, { controller.setEffect(track.id, effect.id, effect.amount, it) })
                }
            } }
        }
    }
}

@Composable
private fun AutomationView(controller: MusicEditorController) {
    var parameter by remember { mutableStateOf(AutomationParameter.VOLUME) }
    var beat by remember { mutableFloatStateOf(0f) }
    var value by remember { mutableFloatStateOf(.8f) }
    val track = controller.project.track(controller.selectedTrackId)
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Track", style = MaterialTheme.typography.labelMedium)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) { controller.project.tracks.forEach { item -> FilterChip(item.id == controller.selectedTrackId, { controller.selectTrack(item.id) }, { Text(item.name) }) } }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { AutomationParameter.entries.forEach { item -> FilterChip(item == parameter, { parameter = item; value = if (item == AutomationParameter.VOLUME) .8f else 0f }, { Text(item.name) }) } }
        Text("Beat ${"%.2f".format(beat)}"); Slider(beat, { beat = it }, valueRange = 0f..controller.project.arrangementLengthBeats.toFloat())
        Text("Value ${"%.2f".format(value)}"); Slider(value, { value = it }, valueRange = if (parameter == AutomationParameter.VOLUME) 0f..1f else -1f..1f)
        Button(onClick = { controller.addAutomationPoint(parameter, beat.toDouble(), value) }, enabled = track != null) { Icon(Icons.Default.Add, null); Text("Automation point") }
        track?.automation?.firstOrNull { it.parameter == parameter }?.points?.forEach { Text("Beat ${"%.2f".format(it.beat)} → ${"%.2f".format(it.value)}") }
    }
}

@Composable
private fun PianoRollPage(controller: MusicEditorController) {
    val pattern = controller.project.pattern(controller.activePatternId)
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            GridResolution.entries.forEach { FilterChip(controller.grid == it, { controller.chooseGrid(it) }, { Text(it.label) }) }
            IconButton(onClick = { controller.duplicateSelection() }) { Icon(Icons.Default.ContentCopy, "Duplicate notes") }
            IconButton(onClick = controller::deleteSelection) { Icon(Icons.Default.Delete, "Delete notes") }
        }
        if (pattern == null) Text("No pattern selected", Modifier.padding(24.dp)) else PianoRoll(
            pattern.notes, pattern.lengthBeats, controller.project.timeSignature.numerator, controller.grid, controller.selectedNoteIds, controller.playheadBeat,
            controller::selectNotes,
            { pitch, start -> controller.edit(MusicEditAction.AddNote(pattern.id, pitch, start, maxOf(1.0, controller.grid.stepBeats))) },
            { ids, beats, pitches -> controller.edit(MusicEditAction.MoveNotes(pattern.id, ids, beats, pitches)) },
            { ids, beats -> controller.edit(MusicEditAction.ResizeNotes(pattern.id, ids, beats)) }
        )
    }
}

@Composable
private fun PianoRoll(
    notes: List<Note>, patternLengthBeats: Double, beatsPerBar: Int, grid: GridResolution, selectedNoteIds: Set<String>, playheadBeat: Double,
    onSelect: (Set<String>) -> Unit, onAdd: (Int, Double) -> Unit, onMove: (Set<String>, Double, Int) -> Unit, onResize: (Set<String>, Double) -> Unit
) {
    val density = LocalDensity.current; val keyWidth = with(density) { 56.dp.toPx() }; val beatWidth = with(density) { 72.dp.toPx() }; val rowHeight = with(density) { 24.dp.toPx() }
    val resizeHandle = with(density) { 14.dp.toPx() }; val width = keyWidth + beatWidth * patternLengthBeats.toFloat(); val height = rowHeight * (MAX_PITCH - MIN_PITCH + 1)
    var box by remember { mutableStateOf<Rect?>(null) }
    val primary = MaterialTheme.colorScheme.primary; val selected = MaterialTheme.colorScheme.tertiary; val line = MaterialTheme.colorScheme.outlineVariant
    val surface = MaterialTheme.colorScheme.surface; val alternate = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .3f); val barLine = MaterialTheme.colorScheme.outline
    Box(Modifier.fillMaxSize().horizontalScroll(rememberScrollState()).verticalScroll(rememberScrollState(initial = (rowHeight * 18).toInt()))) {
        Canvas(Modifier.size(with(density) { width.toDp() }, with(density) { height.toDp() }).pointerInput(notes, selectedNoteIds, grid) {
            awaitEachGesture {
                val down = awaitFirstDown(false); val start = down.position; var last = start; var moved = false
                val hit = notes.lastOrNull { noteRect(it, keyWidth, beatWidth, rowHeight).contains(start) }
                val resizing = hit != null && start.x >= noteRect(hit, keyWidth, beatWidth, rowHeight).right - resizeHandle
                val ids = if (hit == null) emptySet() else if (hit.id in selectedNoteIds) selectedNoteIds else setOf(hit.id).also(onSelect)
                if (hit == null) box = Rect(start, start)
                drag(down.id) { change -> change.consume(); last = change.position; moved = moved || (last - start).getDistance() > 6.dp.toPx(); if (hit == null) box = Rect(minOf(start.x,last.x),minOf(start.y,last.y),maxOf(start.x,last.x),maxOf(start.y,last.y)) }
                if (hit == null) { val area = box; box = null; if (moved && area != null) onSelect(notes.filter { noteRect(it,keyWidth,beatWidth,rowHeight).overlaps(area) }.mapTo(mutableSetOf(), Note::id)) else if (start.x >= keyWidth) onAdd(pitchAt(start.y,rowHeight), grid.snap(((start.x-keyWidth)/beatWidth).toDouble())) }
                else if (!moved) onSelect(setOf(hit.id)) else if (resizing) onResize(ids, round(((last.x-start.x)/beatWidth)/grid.stepBeats)*grid.stepBeats) else onMove(ids, round(((last.x-start.x)/beatWidth)/grid.stepBeats)*grid.stepBeats, round((start.y-last.y)/rowHeight).toInt())
            }
        }) {
            drawRect(surface)
            for (pitch in MIN_PITCH..MAX_PITCH) { val top=(MAX_PITCH-pitch)*rowHeight; if (pitch%2==0) drawRect(alternate,Offset(keyWidth,top),Size(size.width-keyWidth,rowHeight)); drawLine(line,Offset(0f,top),Offset(size.width,top)); if(pitch%12==0) drawContext.canvas.nativeCanvas.drawText("C${pitch/12-1}",7f,top+rowHeight*.68f,Paint().apply{color=android.graphics.Color.GRAY;textSize=rowHeight*.42f}) }
            var beat=0.0; while(beat<=patternLengthBeats){val x=keyWidth+beat.toFloat()*beatWidth;drawLine(if(abs(beat-round(beat))<.001&&round(beat).toInt()%beatsPerBar==0)barLine else line,Offset(x,0f),Offset(x,size.height),if(round(beat).toInt()%beatsPerBar==0)2f else 1f);beat+=grid.stepBeats}
            notes.forEach { val rect=noteRect(it,keyWidth,beatWidth,rowHeight);drawRoundRect(if(it.id in selectedNoteIds)selected else primary.copy(alpha=.55f+it.velocity*.45f),rect.topLeft+Offset(2f,2f),Size(rect.width-4f,rect.height-4f),CornerRadius(5f));drawLine(Color.White,Offset(rect.right-resizeHandle/2,rect.top+5f),Offset(rect.right-resizeHandle/2,rect.bottom-5f),2f) }
            if(playheadBeat>0){val x=keyWidth+playheadBeat.toFloat()*beatWidth;drawLine(Color.Red,Offset(x,0f),Offset(x,size.height),3f)};box?.let{drawRect(selected.copy(alpha=.18f),it.topLeft,it.size)}
        }
    }
}

private fun noteRect(note: Note,keyWidth:Float,beatWidth:Float,rowHeight:Float):Rect { val left=keyWidth+note.startBeat.toFloat()*beatWidth;val top=(MAX_PITCH-note.pitch)*rowHeight;return Rect(left,top,left+note.durationBeats.toFloat()*beatWidth,top+rowHeight) }
private fun pitchAt(y:Float,rowHeight:Float)= (MAX_PITCH-floor(y/rowHeight).toInt()).coerceIn(MIN_PITCH,MAX_PITCH)
