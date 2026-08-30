package com.splinch.junction.platform.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import com.splinch.junction.feature.music.model.MusicProject
import com.splinch.junction.feature.music.playback.MusicPlaybackEngine
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class AndroidSynthPlaybackEngine : MusicPlaybackEngine {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var playbackJob: Job? = null
    @Volatile private var audioTrack: AudioTrack? = null

    override fun playArrangement(project: MusicProject, assetDirectory: File, onPosition: (Double) -> Unit, onComplete: () -> Unit) {
        stop()
        playbackJob = scope.launch {
            val sampleRate = 44_100
            val rendered = MusicProjectRenderer(assetDirectory, sampleRate).render(project)
            if (!isActive) return@launch
            val minimumBuffer = AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT).coerceAtLeast(4096)
            val track = AudioTrack.Builder()
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                .setAudioFormat(AudioFormat.Builder().setSampleRate(sampleRate).setChannelMask(AudioFormat.CHANNEL_OUT_STEREO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                .setBufferSizeInBytes(minimumBuffer * 2).setTransferMode(AudioTrack.MODE_STREAM).build()
            audioTrack = track
            val buffer = ShortArray(minimumBuffer / 2)
            val framesPerBeat = sampleRate * 60.0 / project.tempo
            var sampleIndex = 0
            try {
                track.play()
                while (isActive && sampleIndex < rendered.size) {
                    val count = minOf(buffer.size, rendered.size - sampleIndex)
                    for (index in 0 until count) buffer[index] = (rendered[sampleIndex + index].coerceIn(-1f, 1f) * Short.MAX_VALUE).toInt().toShort()
                    track.write(buffer, 0, count, AudioTrack.WRITE_BLOCKING)
                    sampleIndex += count
                    onPosition((sampleIndex / 2.0) / framesPerBeat)
                }
                if (isActive) onComplete()
            } finally {
                runCatching { track.pause() }; runCatching { track.flush() }; runCatching { track.release() }
                if (audioTrack === track) audioTrack = null
            }
        }
    }

    override fun stop() {
        playbackJob?.cancel(); playbackJob = null
        runCatching { audioTrack?.pause() }; runCatching { audioTrack?.flush() }
    }
}
