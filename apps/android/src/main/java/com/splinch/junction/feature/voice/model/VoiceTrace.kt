package com.splinch.junction.feature.voice.model

import com.splinch.junction.feature.voice.local.*
import com.splinch.junction.feature.voice.model.*
import com.splinch.junction.feature.voice.realtime.*
import com.splinch.junction.feature.voice.service.*

import android.util.Log

/**
 * Stage markers for a voice turn, emitted under one tag so the PC companion can say
 * *where* voice stopped instead of the owner reporting "it doesn't work".
 *
 * A voice turn has five places it can die silently -- no recogniser installed, mic
 * permission missing, nothing recognised, no reply from the provider, no TTS engine --
 * and from the outside all five look identical: you talk, and nothing happens. Each
 * stage is one line, so `junctionctl voice` can report the last one reached.
 *
 * PRIVACY INVARIANT: never pass recognised speech, reply text, message content or any
 * credential to these. Detail is limited to stage names, counts and platform error
 * codes. Logcat is readable by the developer tooling on any connected machine, so a
 * transcript here would be a transcript leak. Character counts are deliberate: they
 * distinguish "empty reply" from "reply arrived" without revealing what was said.
 */
object VoiceTrace {

    const val TAG = "JunctionVoice"

    /** The local voice session was created; reports whether a recogniser exists at all. */
    fun sessionStart(recognizerAvailable: Boolean) =
        stage("session_start", "recognizer_available=$recognizerAvailable")

    /** TextToSpeech finished initialising -- or failed to. */
    fun ttsReady(ok: Boolean) = stage("tts_ready", "ok=$ok")

    /** Owner-visible call controls, including changes caused by recovery code. */
    fun speechMode(enabled: Boolean) = stage("speech_mode", "enabled=$enabled")
    fun mic(enabled: Boolean) = stage("mic", "enabled=$enabled")

    /** The recogniser has been pointed at the microphone for one utterance. */
    fun listeningArmed() = stage("listening_armed")

    /** The platform reports the microphone is live. */
    fun listening() = stage("listening")

    /** Speech was recognised. Length only -- never the words. */
    fun heard(chars: Int) = stage("heard", "chars=$chars")

    /** A listening turn ended with nothing usable. */
    fun silent() = stage("silent")

    /** The recogniser failed; code is the platform's SpeechRecognizer.ERROR_* value. */
    fun asrError(code: Int) = stage("asr_error", "code=$code")

    /** ERROR_CLIENT emitted in response to Junction deliberately cancelling recognition. */
    fun asrCancelled() = stage("asr_cancelled")

    /** Platform error after it has been mapped to the call policy. */
    fun recogniserFailure(kind: RecogniserFailure) =
        stage("recogniser_failure", "kind=${kind.name}")

    /** The recognised text was handed to the chat lane. */
    fun dispatched() = stage("dispatched")

    /** A model reply came back and is about to be spoken. Length only. */
    fun replyReady(chars: Int) = stage("reply_ready", "chars=$chars")

    /** Synthesis was requested. [via] is cloud, device, or queued (engine still starting). */
    fun speakRequested(chars: Int, via: String) = stage("speak_requested", "chars=$chars via=$via")

    /** Audio started playing. */
    fun speaking() = stage("speaking")

    /** Audio finished playing; the owner's turn is next. */
    fun spokeDone() = stage("spoke_done")

    /** Hands-free listening stood itself down. [reason] is silence or fatal. */
    fun handsFreeEnded(reason: String) = stage("handsfree_ended", "reason=$reason")

    /** A turn ended without anything being spoken -- an error, or tool calls only. */
    fun turnEnded(reason: String) = stage("turn_ended", "reason=$reason")

    /**
     * Whoever held the floor overran and it was taken back, which is the last line of
     * defence against a call going dead. [holder] is a [CallFloor.Holder] name.
     */
    fun floorOverrun(holder: String) = stage("floor_overrun", "holder=$holder")

    /** The barge-in microphone is live underneath the current reply. */
    fun bargeInArmed() = stage("bargein_armed")

    /** The owner cut in mid-reply; playback stops and the recogniser takes the mic. */
    fun bargeIn() = stage("bargein")

    /** Barge-in can't run here, so the reply is uninterruptible. [reason] is why. */
    fun bargeInUnavailable(reason: String) = stage("bargein_unavailable", "reason=$reason")

    private fun stage(name: String, detail: String = "") {
        Log.i(TAG, if (detail.isEmpty()) "stage=$name" else "stage=$name $detail")
    }
}
