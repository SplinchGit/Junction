package com.splinch.junction.feature.music.persistence

import com.splinch.junction.feature.music.model.*
import org.json.JSONArray
import org.json.JSONObject

object MusicProjectCodec {
    fun encode(project: MusicProject): String = JSONObject().apply {
        put("schemaVersion", CURRENT_MUSIC_PROJECT_SCHEMA)
        put("id", project.id)
        put("name", project.name)
        put("tempo", project.tempo)
        put("arrangementLengthBeats", project.arrangementLengthBeats)
        put("masterVolume", project.masterVolume.toDouble())
        put("updatedAtEpochMs", project.updatedAtEpochMs)
        put("timeSignature", JSONObject().apply {
            put("numerator", project.timeSignature.numerator)
            put("denominator", project.timeSignature.denominator)
        })
        put("patterns", project.patterns.toJsonArray(::encodePattern))
        put("instruments", project.instruments.toJsonArray(::encodeInstrument))
        put("audioAssets", project.audioAssets.toJsonArray(::encodeAudioAsset))
        put("tracks", project.tracks.toJsonArray(::encodeTrack))
    }.toString(2)

    fun decode(json: String): MusicProject {
        val root = JSONObject(json)
        val sourceSchema = root.optInt("schemaVersion", 1)
        require(sourceSchema in 1..CURRENT_MUSIC_PROJECT_SCHEMA) {
            "Unsupported Junction music project schema: $sourceSchema"
        }
        val signature = root.optJSONObject("timeSignature") ?: JSONObject()
        return MusicProject(
            schemaVersion = CURRENT_MUSIC_PROJECT_SCHEMA,
            id = root.getString("id"),
            name = root.getString("name"),
            tempo = root.getDouble("tempo"),
            timeSignature = TimeSignature(signature.optInt("numerator", 4), signature.optInt("denominator", 4)),
            arrangementLengthBeats = root.optDouble("arrangementLengthBeats", 64.0),
            patterns = root.optJSONArray("patterns").mapObjects(::decodePattern),
            instruments = root.optJSONArray("instruments").mapObjects(::decodeInstrument).ifEmpty { factoryInstruments() },
            audioAssets = root.optJSONArray("audioAssets").mapObjects(::decodeAudioAsset),
            tracks = root.optJSONArray("tracks").mapObjects(::decodeTrack),
            masterVolume = root.optDouble("masterVolume", 0.9).toFloat(),
            updatedAtEpochMs = root.optLong("updatedAtEpochMs", 0L)
        )
    }

    private fun encodePattern(pattern: Pattern) = JSONObject().apply {
        put("id", pattern.id); put("name", pattern.name); put("lengthBeats", pattern.lengthBeats)
        put("notes", pattern.notes.toJsonArray { note -> JSONObject().apply {
            put("id", note.id); put("pitch", note.pitch); put("startBeat", note.startBeat)
            put("durationBeats", note.durationBeats); put("velocity", note.velocity.toDouble())
        } })
    }

    private fun decodePattern(value: JSONObject) = Pattern(
        id = value.getString("id"), name = value.getString("name"), lengthBeats = value.getDouble("lengthBeats"),
        notes = value.optJSONArray("notes").mapObjects { note -> Note(
            id = note.getString("id"), pitch = note.getInt("pitch"), startBeat = note.getDouble("startBeat"),
            durationBeats = note.getDouble("durationBeats"), velocity = note.getDouble("velocity").toFloat()
        ) }
    )

    private fun encodeInstrument(value: Instrument) = JSONObject().apply {
        put("id", value.id); put("name", value.name); put("kind", value.kind.name); put("waveform", value.waveform.name)
        put("sampleAssetId", value.sampleAssetId); put("rootMidiNote", value.rootMidiNote)
        put("attackMs", value.attackMs.toDouble()); put("releaseMs", value.releaseMs.toDouble())
    }

    private fun decodeInstrument(value: JSONObject) = Instrument(
        id = value.getString("id"), name = value.getString("name"),
        kind = value.enumOr("kind", InstrumentKind.SYNTH), waveform = value.enumOr("waveform", Waveform.SINE),
        sampleAssetId = value.optString("sampleAssetId").takeIf { it.isNotBlank() && it != "null" },
        rootMidiNote = value.optInt("rootMidiNote", 60), attackMs = value.optDouble("attackMs", 5.0).toFloat(),
        releaseMs = value.optDouble("releaseMs", 180.0).toFloat()
    )

    private fun encodeAudioAsset(value: AudioAsset) = JSONObject().apply {
        put("id", value.id); put("name", value.name); put("relativePath", value.relativePath)
        put("durationSeconds", value.durationSeconds); put("sampleRate", value.sampleRate); put("channels", value.channels)
    }

    private fun decodeAudioAsset(value: JSONObject) = AudioAsset(
        id = value.getString("id"), name = value.getString("name"), relativePath = value.getString("relativePath"),
        durationSeconds = value.getDouble("durationSeconds"), sampleRate = value.getInt("sampleRate"), channels = value.getInt("channels")
    )

    private fun encodeTrack(track: ArrangementTrack) = JSONObject().apply {
        put("id", track.id); put("name", track.name); put("type", track.type.name); put("instrumentId", track.instrumentId)
        put("muted", track.muted); put("solo", track.solo); put("volume", track.volume.toDouble()); put("pan", track.pan.toDouble())
        put("patternClips", track.patternClips.toJsonArray { clip -> JSONObject().apply {
            put("id", clip.id); put("patternId", clip.patternId); put("startBeat", clip.startBeat)
            put("lengthBeats", clip.lengthBeats); put("offsetBeats", clip.offsetBeats)
        } })
        put("audioClips", track.audioClips.toJsonArray { clip -> JSONObject().apply {
            put("id", clip.id); put("assetId", clip.assetId); put("startBeat", clip.startBeat)
            put("lengthBeats", clip.lengthBeats); put("offsetSeconds", clip.offsetSeconds); put("gain", clip.gain.toDouble())
        } })
        put("effects", track.effects.toJsonArray { effect -> JSONObject().apply {
            put("id", effect.id); put("type", effect.type.name); put("enabled", effect.enabled)
            put("amount", effect.amount.toDouble()); put("mix", effect.mix.toDouble())
        } })
        put("automation", track.automation.toJsonArray { lane -> JSONObject().apply {
            put("id", lane.id); put("parameter", lane.parameter.name)
            put("points", lane.points.toJsonArray { point -> JSONObject().apply {
                put("id", point.id); put("beat", point.beat); put("value", point.value.toDouble())
            } })
        } })
    }

    private fun decodeTrack(value: JSONObject): ArrangementTrack {
        val trackType = value.enumOr("type", TrackType.INSTRUMENT)
        val patternClips = (value.optJSONArray("patternClips") ?: value.optJSONArray("clips")).mapObjects { clip -> PatternClip(
            id = clip.getString("id"), patternId = clip.getString("patternId"), startBeat = clip.getDouble("startBeat"),
            lengthBeats = clip.getDouble("lengthBeats"), offsetBeats = clip.optDouble("offsetBeats", 0.0)
        ) }
        return ArrangementTrack(
            id = value.getString("id"), name = value.getString("name"), type = trackType,
            instrumentId = value.optString("instrumentId").takeIf { it.isNotBlank() && it != "null" }
                ?: FACTORY_KEYS_ID.takeIf { trackType == TrackType.INSTRUMENT },
            muted = value.optBoolean("muted", false), solo = value.optBoolean("solo", false),
            volume = value.optDouble("volume", 0.8).toFloat(), pan = value.optDouble("pan", 0.0).toFloat(),
            patternClips = patternClips,
            audioClips = value.optJSONArray("audioClips").mapObjects { clip -> AudioClip(
                id = clip.getString("id"), assetId = clip.getString("assetId"), startBeat = clip.getDouble("startBeat"),
                lengthBeats = clip.getDouble("lengthBeats"), offsetSeconds = clip.optDouble("offsetSeconds", 0.0),
                gain = clip.optDouble("gain", 1.0).toFloat()
            ) },
            effects = value.optJSONArray("effects").mapObjects { effect -> TrackEffect(
                id = effect.getString("id"), type = effect.enumOr("type", EffectType.DRIVE),
                enabled = effect.optBoolean("enabled", true), amount = effect.optDouble("amount", 0.5).toFloat(),
                mix = effect.optDouble("mix", 0.5).toFloat()
            ) },
            automation = value.optJSONArray("automation").mapObjects { lane -> AutomationLane(
                id = lane.getString("id"), parameter = lane.enumOr("parameter", AutomationParameter.VOLUME),
                points = lane.optJSONArray("points").mapObjects { point -> AutomationPoint(
                    id = point.getString("id"), beat = point.getDouble("beat"), value = point.getDouble("value").toFloat()
                ) }
            ) }
        )
    }

    private inline fun <T> List<T>.toJsonArray(transform: (T) -> JSONObject) = JSONArray().also { out -> forEach { out.put(transform(it)) } }
    private inline fun <T> JSONArray?.mapObjects(transform: (JSONObject) -> T): List<T> =
        if (this == null) emptyList() else buildList(length()) { for (index in 0 until length()) add(transform(getJSONObject(index))) }
    private inline fun <reified T : Enum<T>> JSONObject.enumOr(key: String, fallback: T): T =
        runCatching { enumValueOf<T>(getString(key)) }.getOrDefault(fallback)
}
