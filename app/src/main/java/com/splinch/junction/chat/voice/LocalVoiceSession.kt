package com.splinch.junction.chat.voice

import android.content.Context
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale
import java.util.UUID

interface LocalVoiceListener {
    fun onUserUtterance(text: String)
    fun onListeningStateChanged(listening: Boolean)
    fun onSpeakingStateChanged(speaking: Boolean)
    fun onError(message: String)
}

/**
 * §3.1 provider-agnostic voice: a non-Realtime voice path built on Android's
 * own on-device `SpeechRecognizer` (ASR) and `TextToSpeech` (TTS) rather than
 * OpenAI Realtime. Recognized speech is handed to the listener as plain text
 * — the caller feeds it through the same `chat/provider/LlmProvider` text
 * lane every other message goes through, so voice gets the identical
 * tool/trust/plan pipeline as typed chat, just with a different front end.
 *
 * Barge-in: starting to listen always stops any in-progress TTS playback
 * first, matching the interruptibility Realtime mode provides via WebRTC.
 */
class LocalVoiceSession(
    private val context: Context,
    private val listener: LocalVoiceListener
) {
    private var tts: TextToSpeech? = null
    private var recognizer: SpeechRecognizer? = null
    private var ttsReady = false
    private var started = false

    fun start() {
        if (started) return
        started = true
        tts = TextToSpeech(context) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (ttsReady) tts?.language = Locale.getDefault()
        }
        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {
                listener.onSpeakingStateChanged(true)
            }

            override fun onDone(utteranceId: String?) {
                listener.onSpeakingStateChanged(false)
            }

            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) {
                listener.onSpeakingStateChanged(false)
            }
        })

        if (SpeechRecognizer.isRecognitionAvailable(context)) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
                setRecognitionListener(recognitionListener())
            }
        } else {
            listener.onError("Speech recognition is not available on this device.")
        }
    }

    fun stop() {
        started = false
        recognizer?.destroy()
        recognizer = null
        tts?.stop()
        tts?.shutdown()
        tts = null
        ttsReady = false
    }

    /** Barge-in: cut any current TTS playback and start listening for the owner's next utterance. */
    fun startListening() {
        tts?.stop()
        val intent = android.content.Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
        }
        runCatching { recognizer?.startListening(intent) }
            .onFailure { listener.onError(it.message ?: "Failed to start listening") }
    }

    fun stopListening() {
        runCatching { recognizer?.stopListening() }
    }

    fun speak(text: String) {
        if (text.isBlank()) return
        if (!ttsReady) {
            Log.w(TAG, "TTS not ready; dropping utterance")
            return
        }
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, UUID.randomUUID().toString())
    }

    private fun recognitionListener() = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {
            listener.onListeningStateChanged(true)
        }

        override fun onResults(results: Bundle?) {
            listener.onListeningStateChanged(false)
            val text = results
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull()
                ?.trim()
            if (!text.isNullOrBlank()) listener.onUserUtterance(text)
        }

        override fun onError(error: Int) {
            listener.onListeningStateChanged(false)
            // NO_MATCH / SPEECH_TIMEOUT are routine (silence, unclear audio) — not worth surfacing as errors.
            if (error != SpeechRecognizer.ERROR_NO_MATCH && error != SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                listener.onError("Speech recognition error (code $error)")
            }
        }

        override fun onEndOfSpeech() {
            listener.onListeningStateChanged(false)
        }

        override fun onBeginningOfSpeech() = Unit
        override fun onRmsChanged(rmsdB: Float) = Unit
        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onPartialResults(partialResults: Bundle?) = Unit
        override fun onEvent(eventType: Int, params: Bundle?) = Unit
    }

    private companion object {
        const val TAG = "LocalVoiceSession"
    }
}
