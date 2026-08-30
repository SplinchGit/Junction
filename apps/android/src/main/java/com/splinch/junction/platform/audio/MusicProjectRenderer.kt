package com.splinch.junction.platform.audio

import com.splinch.junction.feature.music.model.*
import java.io.File
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.tanh

class MusicProjectRenderer(
    private val assetDirectory: File,
    private val sampleRate: Int = 44_100
) {
    fun render(project: MusicProject): FloatArray {
        val framesPerBeat = sampleRate * 60.0 / project.tempo
        val totalFrames = (project.arrangementLengthBeats * framesPerBeat).toInt().coerceAtLeast(1)
        val master = FloatArray(totalFrames * 2)
        val soloed = project.tracks.any { it.solo }
        project.tracks.filter { !it.muted && (!soloed || it.solo) }.forEach { track ->
            val buffer = FloatArray(totalFrames * 2)
            mixPatterns(project, track, buffer, framesPerBeat)
            mixAudio(project, track, buffer, framesPerBeat)
            applyEffects(buffer, track.effects)
            val volumeLane = track.automation.firstOrNull { it.parameter == AutomationParameter.VOLUME }
            val panLane = track.automation.firstOrNull { it.parameter == AutomationParameter.PAN }
            for (frame in 0 until totalFrames) {
                val beat = frame / framesPerBeat
                val volume = volumeLane?.valueAt(beat, track.volume)?.coerceIn(0f, 1f) ?: track.volume
                val pan = panLane?.valueAt(beat, track.pan)?.coerceIn(-1f, 1f) ?: track.pan
                master[frame * 2] += buffer[frame * 2] * volume * (1f - pan.coerceAtLeast(0f))
                master[frame * 2 + 1] += buffer[frame * 2 + 1] * volume * (1f + pan.coerceAtMost(0f))
            }
        }
        for (index in master.indices) master[index] = tanh(master[index] * project.masterVolume)
        return master
    }

    private fun mixPatterns(project: MusicProject, track: ArrangementTrack, out: FloatArray, framesPerBeat: Double) {
        val instrument = project.instrument(track.instrumentId) ?: return
        val sample = instrument.sampleAssetId?.let(project::audioAsset)?.let(::loadAsset)
        track.patternClips.forEach { clip ->
            val pattern = project.pattern(clip.patternId) ?: return@forEach
            var repeatOffset = 0.0
            while (repeatOffset < clip.lengthBeats) {
                pattern.notes.forEach { note ->
                    val startBeat = clip.startBeat + repeatOffset + note.startBeat - clip.offsetBeats
                    if (startBeat >= clip.startBeat && startBeat < clip.startBeat + clip.lengthBeats) {
                        if (instrument.kind == InstrumentKind.SAMPLER && sample != null) mixSampleNote(out, sample, instrument, note, startBeat, framesPerBeat)
                        else mixSynthNote(out, instrument, note, startBeat, framesPerBeat)
                    }
                }
                repeatOffset += pattern.lengthBeats
            }
        }
    }

    private fun mixSynthNote(out: FloatArray, instrument: Instrument, note: Note, startBeat: Double, framesPerBeat: Double) {
        val start = (startBeat * framesPerBeat).toInt().coerceAtLeast(0)
        val frames = (note.durationBeats * framesPerBeat).toInt()
        val frequency = 440.0 * 2.0.pow((note.pitch - 69) / 12.0)
        val attack = instrument.attackMs / 1000f * sampleRate
        val release = instrument.releaseMs / 1000f * sampleRate
        for (local in 0 until frames) {
            val frame = start + local
            if (frame * 2 + 1 >= out.size) break
            val phase = frequency * local / sampleRate
            val wave = when (instrument.waveform) {
                Waveform.SINE -> sin(2.0 * PI * phase)
                Waveform.TRIANGLE -> 2.0 * abs(2.0 * (phase - floor(phase + 0.5))) - 1.0
                Waveform.SQUARE -> if (phase % 1.0 < 0.5) 1.0 else -1.0
                Waveform.SAW -> 2.0 * (phase - floor(phase + 0.5))
            }
            val envelope = minOf(1f, if (attack == 0f) 1f else local / attack, if (release == 0f) 1f else (frames - local) / release).coerceAtLeast(0f)
            val value = (wave * note.velocity * envelope * 0.22).toFloat()
            out[frame * 2] += value; out[frame * 2 + 1] += value
        }
    }

    private fun mixSampleNote(out: FloatArray, source: PcmAudio, instrument: Instrument, note: Note, startBeat: Double, framesPerBeat: Double) {
        val start = (startBeat * framesPerBeat).toInt().coerceAtLeast(0)
        val maxFrames = (note.durationBeats * framesPerBeat).toInt()
        val pitchRatio = 2.0.pow((note.pitch - instrument.rootMidiNote) / 12.0) * source.sampleRate / sampleRate
        for (local in 0 until maxFrames) {
            val sourceFrame = (local * pitchRatio).toInt()
            val target = start + local
            if (sourceFrame >= source.frameCount || target * 2 + 1 >= out.size) break
            val left = source.samples[sourceFrame * source.channels]
            val right = if (source.channels == 2) source.samples[sourceFrame * 2 + 1] else left
            out[target * 2] += left * note.velocity; out[target * 2 + 1] += right * note.velocity
        }
    }

    private fun mixAudio(project: MusicProject, track: ArrangementTrack, out: FloatArray, framesPerBeat: Double) {
        track.audioClips.forEach { clip ->
            val source = project.audioAsset(clip.assetId)?.let(::loadAsset) ?: return@forEach
            val targetStart = (clip.startBeat * framesPerBeat).toInt()
            val sourceOffset = (clip.offsetSeconds * source.sampleRate).toInt()
            val maxTargetFrames = (clip.lengthBeats * framesPerBeat).toInt()
            for (local in 0 until maxTargetFrames) {
                val sourceFrame = sourceOffset + (local.toDouble() * source.sampleRate / sampleRate).toInt()
                val target = targetStart + local
                if (sourceFrame >= source.frameCount || target * 2 + 1 >= out.size) break
                val left = source.samples[sourceFrame * source.channels] * clip.gain
                val right = if (source.channels == 2) source.samples[sourceFrame * 2 + 1] * clip.gain else left
                out[target * 2] += left; out[target * 2 + 1] += right
            }
        }
    }

    private fun loadAsset(asset: AudioAsset): PcmAudio? = runCatching { WavCodec.read(File(assetDirectory, asset.relativePath)) }.getOrNull()

    private fun applyEffects(samples: FloatArray, effects: List<TrackEffect>) {
        effects.filter(TrackEffect::enabled).forEach { effect ->
            when (effect.type) {
                EffectType.DRIVE -> for (index in samples.indices) {
                    val dry = samples[index]; val wet = tanh(dry * (1f + effect.amount * 12f))
                    samples[index] = dry * (1f - effect.mix) + wet * effect.mix
                }
                EffectType.LOW_PASS -> {
                    val alpha = 0.02f + (1f - effect.amount) * 0.45f
                    var left = 0f; var right = 0f
                    for (frame in 0 until samples.size / 2) {
                        val l = samples[frame * 2]; val r = samples[frame * 2 + 1]
                        left += alpha * (l - left); right += alpha * (r - right)
                        samples[frame * 2] = l * (1f - effect.mix) + left * effect.mix
                        samples[frame * 2 + 1] = r * (1f - effect.mix) + right * effect.mix
                    }
                }
                EffectType.DELAY -> {
                    val delayFrames = (sampleRate * (0.12 + effect.amount * 0.55)).toInt()
                    for (frame in delayFrames until samples.size / 2) for (channel in 0..1) {
                        val index = frame * 2 + channel; samples[index] += samples[(frame - delayFrames) * 2 + channel] * effect.mix * 0.55f
                    }
                }
            }
        }
    }
}
