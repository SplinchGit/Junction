package com.splinch.junction.platform.audio

import java.io.File
import java.io.RandomAccessFile

data class PcmAudio(val sampleRate: Int, val channels: Int, val samples: FloatArray) {
    val frameCount: Int get() = samples.size / channels
    val durationSeconds: Double get() = frameCount.toDouble() / sampleRate
}

object WavCodec {
    fun read(file: File): PcmAudio {
        RandomAccessFile(file, "r").use { input ->
            require(readAscii(input, 4) == "RIFF" && input.readLittleInt().also { } >= 0 && readAscii(input, 4) == "WAVE") { "Not a WAV file" }
            var channels = 0
            var sampleRate = 0
            var bitsPerSample = 0
            var format = 0
            var pcm = ByteArray(0)
            while (input.filePointer + 8 <= input.length()) {
                val id = readAscii(input, 4)
                val size = input.readLittleInt()
                when (id) {
                    "fmt " -> {
                        format = input.readLittleShort()
                        channels = input.readLittleShort()
                        sampleRate = input.readLittleInt()
                        input.skipBytes(6)
                        bitsPerSample = input.readLittleShort()
                        input.skipBytes((size - 16).coerceAtLeast(0))
                    }
                    "data" -> {
                        pcm = ByteArray(size)
                        input.readFully(pcm)
                    }
                    else -> input.skipBytes(size)
                }
                if (size % 2 == 1 && input.filePointer < input.length()) input.skipBytes(1)
            }
            require(format == 1 && bitsPerSample == 16 && channels in 1..2 && sampleRate > 0) { "Only mono/stereo 16-bit PCM WAV is supported" }
            val samples = FloatArray(pcm.size / 2)
            for (index in samples.indices) {
                val low = pcm[index * 2].toInt() and 0xff
                val high = pcm[index * 2 + 1].toInt()
                samples[index] = ((high shl 8) or low).toShort() / 32768f
            }
            return PcmAudio(sampleRate, channels, samples)
        }
    }

    fun writeStereo(file: File, samples: FloatArray, sampleRate: Int = 44_100) {
        val pcm = ByteArray(samples.size * 2)
        samples.forEachIndexed { index, value ->
            val short = (value.coerceIn(-1f, 1f) * Short.MAX_VALUE).toInt().toShort().toInt()
            pcm[index * 2] = (short and 0xff).toByte()
            pcm[index * 2 + 1] = ((short ushr 8) and 0xff).toByte()
        }
        writePcm16(file, pcm, sampleRate, 2)
    }

    fun writePcm16(file: File, pcm: ByteArray, sampleRate: Int, channels: Int) {
        file.parentFile?.mkdirs()
        file.outputStream().buffered().use { out ->
            val byteRate = sampleRate * channels * 2
            out.write("RIFF".toByteArray()); out.writeLittleInt(36 + pcm.size); out.write("WAVE".toByteArray())
            out.write("fmt ".toByteArray()); out.writeLittleInt(16); out.writeLittleShort(1); out.writeLittleShort(channels)
            out.writeLittleInt(sampleRate); out.writeLittleInt(byteRate); out.writeLittleShort(channels * 2); out.writeLittleShort(16)
            out.write("data".toByteArray()); out.writeLittleInt(pcm.size); out.write(pcm)
        }
    }

    private fun readAscii(input: RandomAccessFile, count: Int) = ByteArray(count).also(input::readFully).toString(Charsets.US_ASCII)
    private fun RandomAccessFile.readLittleShort(): Int = readUnsignedByte() or (readUnsignedByte() shl 8)
    private fun RandomAccessFile.readLittleInt(): Int = readLittleShort() or (readLittleShort() shl 16)
    private fun java.io.OutputStream.writeLittleShort(value: Int) { write(value and 0xff); write((value ushr 8) and 0xff) }
    private fun java.io.OutputStream.writeLittleInt(value: Int) { writeLittleShort(value); writeLittleShort(value ushr 16) }
}
