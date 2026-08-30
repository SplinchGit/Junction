package com.splinch.junction.feature.music.persistence

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import com.splinch.junction.feature.music.model.AudioAsset
import com.splinch.junction.feature.music.model.MusicProject
import com.splinch.junction.feature.music.model.musicId
import com.splinch.junction.platform.audio.MusicProjectRenderer
import com.splinch.junction.platform.audio.WavCodec
import java.io.File

class MusicAssetStore(private val context: Context) {
    val assetDirectory = File(context.filesDir, "music-assets").apply { mkdirs() }

    fun importWav(uri: Uri): AudioAsset {
        val displayName = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        } ?: "Imported sample.wav"
        val id = musicId()
        val file = File(assetDirectory, "$id.wav")
        context.contentResolver.openInputStream(uri).use { input ->
            requireNotNull(input) { "Cannot open audio" }
            file.outputStream().use(input::copyTo)
        }
        return try {
            val pcm = WavCodec.read(file)
            AudioAsset(id, displayName.substringBeforeLast('.'), file.name, pcm.durationSeconds, pcm.sampleRate, pcm.channels)
        } catch (error: Throwable) {
            file.delete()
            throw error
        }
    }

    fun recordingFile(): File = File(assetDirectory, "recording-${musicId()}.wav")

    fun assetForRecording(file: File): AudioAsset {
        val pcm = WavCodec.read(file)
        return AudioAsset(musicId(), "Recording", file.name, pcm.durationSeconds, pcm.sampleRate, pcm.channels)
    }

    fun export(project: MusicProject): File {
        val directory = File(context.cacheDir, "music-exports").apply { mkdirs() }
        val safeName = project.name.replace(Regex("[^A-Za-z0-9._-]"), "_").ifBlank { "Junction_Project" }
        val file = File(directory, "$safeName.wav")
        WavCodec.writeStereo(file, MusicProjectRenderer(assetDirectory).render(project))
        return file
    }
}
