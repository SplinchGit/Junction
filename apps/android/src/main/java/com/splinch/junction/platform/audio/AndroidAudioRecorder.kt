package com.splinch.junction.platform.audio

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

class AndroidAudioRecorder {
    private val sampleRate = 44_100
    private val recording = AtomicBoolean(false)
    private var recorder: AudioRecord? = null
    private var worker: Thread? = null
    private var bytes: ByteArrayOutputStream? = null

    @SuppressLint("MissingPermission")
    fun start(): Boolean = runCatching {
        if (recording.get()) return false
        val size = AudioRecord.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT).coerceAtLeast(4096)
        val active = AudioRecord(MediaRecorder.AudioSource.DEFAULT, sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, size * 2)
        require(active.state == AudioRecord.STATE_INITIALIZED)
        val output = ByteArrayOutputStream()
        recorder = active; bytes = output; recording.set(true); active.startRecording()
        worker = Thread {
            val buffer = ByteArray(size)
            while (recording.get()) {
                val read = active.read(buffer, 0, buffer.size)
                if (read > 0) output.write(buffer, 0, read)
            }
        }.apply { name = "JunctionMusicRecorder"; start() }
        true
    }.getOrDefault(false)

    fun stop(outputFile: File): PcmAudio? {
        if (!recording.getAndSet(false)) return null
        runCatching { recorder?.stop() }
        runCatching { worker?.join(1500) }
        runCatching { recorder?.release() }
        recorder = null; worker = null
        val pcm = bytes?.toByteArray() ?: return null
        bytes = null
        WavCodec.writePcm16(outputFile, pcm, sampleRate, 1)
        return runCatching { WavCodec.read(outputFile) }.getOrNull()
    }
}
