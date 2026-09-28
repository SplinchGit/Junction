package com.splinch.junction.feature.migration

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun LegacyMusicExport() {
    val context = LocalContext.current
    if (!File(context.filesDir, "music-projects/current.junction-music.json").isFile) return
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val export = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri ->
        if (uri != null) scope.launch {
            busy = true
            status = withContext(Dispatchers.IO) {
                runCatching {
                    context.contentResolver.openOutputStream(uri)?.use { MusicArchive.export(context.filesDir, it) }
                        ?: error("Cannot open export destination")
                    "Music project exported. Import this ZIP in Junction DAW. The original is still here."
                }.getOrElse { "Export failed: ${it.message}" }
            }
            busy = false
        }
    }
    OutlinedButton(onClick = { export.launch("junction-music.zip") }, enabled = !busy) { Text("Export existing music project") }
    if (status.isNotEmpty()) Text(status)
}
