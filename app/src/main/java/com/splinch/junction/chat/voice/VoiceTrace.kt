package com.splinch.junction.chat.voice

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

    private fun stage(name: String, detail: String = "") {
        Log.i(TAG, if (detail.isEmpty()) "stage=$name" else "stage=$name $detail")
    }
}
