package com.splinch.junction.feature.music.model

import java.util.UUID
import kotlin.math.round

const val CURRENT_MUSIC_PROJECT_SCHEMA = 2

fun musicId(): String = UUID.randomUUID().toString()

data class MusicProject(
    val schemaVersion: Int = CURRENT_MUSIC_PROJECT_SCHEMA,
    val id: String = musicId(),
    val name: String = "Untitled",
    val tempo: Double = 120.0,
    val timeSignature: TimeSignature = TimeSignature(),
    val arrangementLengthBeats: Double = 64.0,
    val patterns: List<Pattern> = listOf(Pattern(name = "Pattern 1")),
    val instruments: List<Instrument> = factoryInstruments(),
    val audioAssets: List<AudioAsset> = emptyList(),
    val tracks: List<ArrangementTrack> = listOf(ArrangementTrack(name = "Instrument 1")),
    val masterVolume: Float = 0.9f,
    val updatedAtEpochMs: Long = System.currentTimeMillis()
) {
    init {
        require(schemaVersion in 1..CURRENT_MUSIC_PROJECT_SCHEMA)
        require(name.isNotBlank())
        require(tempo in 20.0..400.0)
        require(arrangementLengthBeats > 0.0)
        require(masterVolume in 0f..1f)
        require(patterns.map { it.id }.distinct().size == patterns.size)
        require(instruments.map { it.id }.distinct().size == instruments.size)
        require(audioAssets.map { it.id }.distinct().size == audioAssets.size)
        require(tracks.map { it.id }.distinct().size == tracks.size)
    }

    fun pattern(id: String): Pattern? = patterns.firstOrNull { it.id == id }
    fun instrument(id: String?): Instrument? = instruments.firstOrNull { it.id == id }
    fun audioAsset(id: String): AudioAsset? = audioAssets.firstOrNull { it.id == id }
    fun track(id: String): ArrangementTrack? = tracks.firstOrNull { it.id == id }

    companion object {
        fun starter(): MusicProject {
            val pattern = Pattern(
                name = "Pattern 1",
                lengthBeats = 16.0,
                notes = listOf(
                    Note(pitch = 60, startBeat = 0.0, durationBeats = 1.0, velocity = 0.84f),
                    Note(pitch = 64, startBeat = 1.0, durationBeats = 1.0, velocity = 0.78f),
                    Note(pitch = 67, startBeat = 2.0, durationBeats = 1.0, velocity = 0.82f),
                    Note(pitch = 72, startBeat = 3.0, durationBeats = 1.0, velocity = 0.88f)
                )
            )
            return MusicProject(
                patterns = listOf(pattern),
                tracks = listOf(
                    ArrangementTrack(
                        name = "Instrument 1",
                        instrumentId = FACTORY_KEYS_ID,
                        patternClips = listOf(
                            PatternClip(patternId = pattern.id, startBeat = 0.0, lengthBeats = 16.0),
                            PatternClip(patternId = pattern.id, startBeat = 16.0, lengthBeats = 16.0)
                        )
                    )
                )
            )
        }
    }
}

const val FACTORY_KEYS_ID = "factory-keys"

fun factoryInstruments(): List<Instrument> = listOf(
    Instrument(id = FACTORY_KEYS_ID, name = "Junction Keys", kind = InstrumentKind.SYNTH, waveform = Waveform.TRIANGLE, attackMs = 12f, releaseMs = 240f),
    Instrument(id = "factory-bass", name = "Deep Bass", kind = InstrumentKind.SYNTH, waveform = Waveform.SQUARE, attackMs = 4f, releaseMs = 90f),
    Instrument(id = "factory-pad", name = "Soft Pad", kind = InstrumentKind.SYNTH, waveform = Waveform.SINE, attackMs = 420f, releaseMs = 900f),
    Instrument(id = "factory-pluck", name = "Bright Pluck", kind = InstrumentKind.SYNTH, waveform = Waveform.SAW, attackMs = 2f, releaseMs = 130f)
)

data class TimeSignature(val numerator: Int = 4, val denominator: Int = 4) {
    init {
        require(numerator in 1..32)
        require(denominator in setOf(1, 2, 4, 8, 16, 32))
    }
}

enum class TrackType { INSTRUMENT, AUDIO }
enum class InstrumentKind { SYNTH, SAMPLER }
enum class Waveform { SINE, TRIANGLE, SQUARE, SAW }
enum class EffectType { DRIVE, LOW_PASS, DELAY }
enum class AutomationParameter { VOLUME, PAN }

data class Instrument(
    val id: String = musicId(),
    val name: String,
    val kind: InstrumentKind,
    val waveform: Waveform = Waveform.SINE,
    val sampleAssetId: String? = null,
    val rootMidiNote: Int = 60,
    val attackMs: Float = 5f,
    val releaseMs: Float = 180f
) {
    init {
        require(name.isNotBlank())
        require(rootMidiNote in 0..127)
        require(attackMs >= 0f)
        require(releaseMs >= 0f)
    }
}

data class AudioAsset(
    val id: String = musicId(),
    val name: String,
    val relativePath: String,
    val durationSeconds: Double,
    val sampleRate: Int,
    val channels: Int
) {
    init {
        require(name.isNotBlank())
        require(relativePath.isNotBlank())
        require(durationSeconds >= 0.0)
        require(sampleRate > 0)
        require(channels in 1..2)
    }
}

data class ArrangementTrack(
    val id: String = musicId(),
    val name: String,
    val type: TrackType = TrackType.INSTRUMENT,
    val instrumentId: String? = FACTORY_KEYS_ID,
    val muted: Boolean = false,
    val solo: Boolean = false,
    val volume: Float = 0.8f,
    val pan: Float = 0f,
    val patternClips: List<PatternClip> = emptyList(),
    val audioClips: List<AudioClip> = emptyList(),
    val effects: List<TrackEffect> = emptyList(),
    val automation: List<AutomationLane> = emptyList()
) {
    init {
        require(name.isNotBlank())
        require(volume in 0f..1f)
        require(pan in -1f..1f)
    }
}

data class PatternClip(
    val id: String = musicId(),
    val patternId: String,
    val startBeat: Double,
    val lengthBeats: Double,
    val offsetBeats: Double = 0.0
) {
    init {
        require(startBeat >= 0.0)
        require(lengthBeats > 0.0)
        require(offsetBeats >= 0.0)
    }
}

data class AudioClip(
    val id: String = musicId(),
    val assetId: String,
    val startBeat: Double,
    val lengthBeats: Double,
    val offsetSeconds: Double = 0.0,
    val gain: Float = 1f
) {
    init {
        require(startBeat >= 0.0)
        require(lengthBeats > 0.0)
        require(offsetSeconds >= 0.0)
        require(gain in 0f..2f)
    }
}

data class TrackEffect(
    val id: String = musicId(),
    val type: EffectType,
    val enabled: Boolean = true,
    val amount: Float = 0.5f,
    val mix: Float = 0.5f
) {
    init {
        require(amount in 0f..1f)
        require(mix in 0f..1f)
    }
}

data class AutomationLane(
    val id: String = musicId(),
    val parameter: AutomationParameter,
    val points: List<AutomationPoint> = emptyList()
) {
    fun valueAt(beat: Double, fallback: Float): Float {
        val sorted = points.sortedBy { it.beat }
        val before = sorted.lastOrNull { it.beat <= beat } ?: return sorted.firstOrNull()?.value ?: fallback
        val after = sorted.firstOrNull { it.beat > beat } ?: return before.value
        val progress = ((beat - before.beat) / (after.beat - before.beat)).toFloat().coerceIn(0f, 1f)
        return before.value + (after.value - before.value) * progress
    }
}

data class AutomationPoint(
    val id: String = musicId(),
    val beat: Double,
    val value: Float
) {
    init {
        require(beat >= 0.0)
        require(value in -1f..1f)
    }
}

data class Pattern(
    val id: String = musicId(),
    val name: String,
    val lengthBeats: Double = 16.0,
    val notes: List<Note> = emptyList()
) {
    init {
        require(name.isNotBlank())
        require(lengthBeats > 0.0)
        require(notes.map { it.id }.distinct().size == notes.size)
    }
}

data class Note(
    val id: String = musicId(),
    val pitch: Int,
    val startBeat: Double,
    val durationBeats: Double,
    val velocity: Float = 0.8f
) {
    init {
        require(pitch in 0..127)
        require(startBeat >= 0.0)
        require(durationBeats > 0.0)
        require(velocity in 0f..1f)
    }
    val endBeat: Double get() = startBeat + durationBeats
}

enum class GridResolution(val stepBeats: Double, val label: String) {
    QUARTER(1.0, "1/4"), EIGHTH(0.5, "1/8"), SIXTEENTH(0.25, "1/16"), THIRTY_SECOND(0.125, "1/32");
    fun snap(beat: Double): Double = (round(beat / stepBeats) * stepBeats).coerceAtLeast(0.0)
}
