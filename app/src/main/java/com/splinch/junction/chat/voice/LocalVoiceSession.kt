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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

interface LocalVoiceListener {
    fun onUserUtterance(text: String)
    fun onListeningStateChanged(listening: Boolean)
    fun onSpeakingStateChanged(speaking: Boolean)
    fun onError(message: String)

    /**
     * Hands-free listening has stopped on its own -- too much silence, or the
     * recogniser failed unrecoverably. The UI must clear its "Mic on" state:
     * showing a live mic while nothing is listening is the exact illusion that
     * makes voice look broken.
     */
    fun onHandsFreeEnded()
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
    private val listener: LocalVoiceListener,
    /**
     * Supplies the optional cloud voice. When one is configured, replies are
     * spoken by Azure's neural voices instead of the on-device engine, which
     * sounds markedly more natural. Recognition always stays on-device either
     * way. Resolved per utterance rather than captured once, so a key added in
     * Settings takes effect immediately instead of after an app restart.
     */
    private val cloudVoiceProvider: () -> AzureNeuralVoice? = { null },
    /** Scope for cloud synthesis; cancelled work simply falls back to on-device TTS. */
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
) {
    private var tts: TextToSpeech? = null
    private var recognizer: SpeechRecognizer? = null
    private var ttsReady = false
    private var started = false
    private var speakJob: Job? = null

    /** The voice currently speaking, retained so barge-in can stop playback. */
    private var activeCloudVoice: AzureNeuralVoice? = null

    /**
     * An utterance that arrived before TextToSpeech finished initialising.
     *
     * TTS init is asynchronous and can take hundreds of milliseconds, while a model
     * reply can land in about a second. Dropping the utterance in that window is the
     * difference between "Junction answered me" and "Junction heard me and then said
     * nothing" on the first thing an owner ever tries -- and it failed silently, with
     * only a log line. Only the most recent is held: if two replies arrive before the
     * engine is up, the newer one is the one still worth speaking.
     *
     * Semantics live in [PendingSpeech] so they can be unit tested without an Android
     * TTS engine -- this failure was silent, and silent failures earn a test.
     */
    private val pendingUtterance = PendingSpeech()

    /**
     * Keeps the mic live across turns. SpeechRecognizer stops after a single
     * utterance, so without this the owner gets one sentence per tap while the UI
     * still claims to be listening. See [HandsFreeLoop].
     */
    private val handsFree = HandsFreeLoop()

    /** Pending re-arm, cancelled whenever the owner or a new turn overtakes it. */
    private var reArmJob: Job? = null

    fun start() {
        if (started) return
        started = true
        tts = TextToSpeech(context) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (ttsReady) {
                tts?.language = Locale.getDefault()
                // Speak anything that arrived while the engine was still starting.
                pendingUtterance.take()?.let { queued -> speakOnDevice(queued) }
            } else {
                // Initialisation failed outright: tell the owner rather than going
                // quietly mute, which is indistinguishable from Junction ignoring them.
                pendingUtterance.discard()
                listener.onError("Text-to-speech is unavailable on this device.")
            }
        }
        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {
                listener.onSpeakingStateChanged(true)
            }

            override fun onDone(utteranceId: String?) {
                listener.onSpeakingStateChanged(false)
                // Junction has finished its reply, so the owner's turn is next.
                applyDecision(handsFree.onReplyFinished())
            }

            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) {
                listener.onSpeakingStateChanged(false)
                // Playback failed, but the conversation shouldn't die with it.
                applyDecision(handsFree.onReplyFinished())
            }

            override fun onStop(utteranceId: String?, interrupted: Boolean) {
                // Barge-in or a QUEUE_FLUSH from a newer reply. Deliberately does
                // NOT re-arm: either the owner is already talking, or another
                // utterance is about to start. Overridden explicitly because the
                // platform's default onStop funnels into onError, which would.
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
        handsFree.stop()
        reArmJob?.cancel()
        speakJob?.cancel()
        pendingUtterance.discard()
        activeCloudVoice?.stop()
        recognizer?.destroy()
        recognizer = null
        tts?.stop()
        tts?.shutdown()
        tts = null
        ttsReady = false
    }

    /**
     * The owner turned the mic on. Barge-in: cut any current TTS playback, then
     * listen — and keep listening across turns until they turn it off again.
     */
    fun startListening() {
        speakJob?.cancel()
        // Drop anything still queued from before the engine was ready: the owner has
        // started talking, so a reply they interrupted must not surface afterwards.
        pendingUtterance.discard()
        activeCloudVoice?.stop()
        tts?.stop()
        handsFree.start()
        arm()
    }

    fun stopListening() {
        handsFree.stop()
        reArmJob?.cancel()
        runCatching { recognizer?.stopListening() }
    }

    /** Point the recogniser at the microphone for one utterance. */
    private fun arm() {
        reArmJob?.cancel()
        val intent = android.content.Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
        }
        runCatching { recognizer?.startListening(intent) }
            .onFailure {
                handsFree.onFatalError()
                listener.onError(it.message ?: "Failed to start listening")
                listener.onHandsFreeEnded()
            }
    }

    /** Carry out whatever [HandsFreeLoop] decided after a turn ended. */
    private fun applyDecision(decision: HandsFreeLoop.Decision) {
        reArmJob?.cancel()
        when (decision) {
            is HandsFreeLoop.Decision.ReArmNow -> arm()
            is HandsFreeLoop.Decision.ReArmAfter -> {
                reArmJob = scope.launch {
                    delay(decision.delayMillis)
                    arm()
                }
            }
            is HandsFreeLoop.Decision.GiveUp -> {
                listener.onError("Stopped listening — nothing heard for a while.")
                listener.onHandsFreeEnded()
            }
            is HandsFreeLoop.Decision.Idle -> Unit
        }
    }

    fun speak(text: String) {
        if (text.isBlank()) return

        val cloud = cloudVoiceProvider()
        if (cloud?.isConfigured == true) {
            speakJob?.cancel()
            activeCloudVoice = cloud
            speakJob = scope.launch {
                listener.onSpeakingStateChanged(true)
                val spoke = cloud.speak(text)
                if (!spoke) {
                    // Network down, bad key, quota exhausted -- say it with the
                    // on-device engine rather than going silent.
                    Log.w(TAG, "Cloud voice unavailable; falling back to on-device TTS")
                    speakOnDevice(text)
                } else {
                    listener.onSpeakingStateChanged(false)
                    // The cloud path has no UtteranceProgressListener, so re-arm here.
                    applyDecision(handsFree.onReplyFinished())
                }
            }
            return
        }

        speakOnDevice(text)
    }

    private fun speakOnDevice(text: String) {
        if (!ttsReady) {
            // Hold it rather than drop it -- the engine is still initialising and will
            // flush this the moment it is ready. See [pendingUtterance].
            Log.d(TAG, "TTS not ready; queueing utterance until init completes")
            pendingUtterance.queue(text)
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
            if (!text.isNullOrBlank()) {
                // Stay quiet until the reply has been spoken, then re-arm — otherwise
                // the recogniser hears Junction's own voice and answers itself.
                applyDecision(handsFree.onSpeechHeard())
                listener.onUserUtterance(text)
            } else {
                applyDecision(handsFree.onSilentTurn())
            }
        }

        override fun onError(error: Int) {
            listener.onListeningStateChanged(false)
            when (error) {
                // Routine: silence or unclear audio. Not worth surfacing, but the
                // recogniser has stopped, so it still needs re-arming.
                SpeechRecognizer.ERROR_NO_MATCH,
                SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
                SpeechRecognizer.ERROR_BUSY -> applyDecision(handsFree.onSilentTurn())

                // Nothing to retry: retrying spins forever and never succeeds.
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> {
                    applyDecision(handsFree.onFatalError())
                    listener.onError("Microphone permission is not granted.")
                    listener.onHandsFreeEnded()
                }

                SpeechRecognizer.ERROR_CLIENT -> {
                    applyDecision(handsFree.onFatalError())
                    listener.onError("The speech recogniser failed to start.")
                    listener.onHandsFreeEnded()
                }

                else -> {
                    listener.onError("Speech recognition error (code $error)")
                    applyDecision(handsFree.onSilentTurn())
                }
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
