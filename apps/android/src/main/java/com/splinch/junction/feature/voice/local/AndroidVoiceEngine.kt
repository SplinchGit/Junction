package com.splinch.junction.feature.voice.local

import com.splinch.junction.feature.voice.local.*
import com.splinch.junction.feature.voice.model.*
import com.splinch.junction.feature.voice.realtime.*
import com.splinch.junction.feature.voice.service.*

import android.Manifest
import android.content.pm.PackageManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import androidx.core.content.ContextCompat
import java.util.Locale
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * The device half of a call: Android's on-device `SpeechRecognizer` for listening, and
 * either `TextToSpeech` or an [AzureNeuralVoice] for speaking.
 *
 * All of the audio plumbing lives here so that [LocalVoiceSession] can hold none of it.
 * Recognition always stays on-device, so no audio of the owner's voice ever leaves the
 * phone; only the assistant's reply text does, and only when a cloud voice is configured.
 *
 * Callbacks are reported on whatever thread the platform used -- the TTS engine in
 * particular reports from its own binder thread. [LocalVoiceSession] does the marshalling,
 * because getting that wrong is what made every call end after one sentence.
 */
class AndroidVoiceEngine(
    private val context: Context,
    /**
     * Supplies the optional cloud voice. When one is configured, replies are spoken by
     * Azure's neural voices instead of the on-device engine, which sounds markedly more
     * natural. Resolved per utterance rather than captured once, so a key added in
     * Settings takes effect immediately instead of after an app restart.
     */
    private val cloudVoiceProvider: () -> AzureNeuralVoice? = { null },
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
) : VoiceEngine {

    private var events: VoiceEngineEvents? = null
    private var tts: TextToSpeech? = null
    private var recognizer: SpeechRecognizer? = null
    private var ttsReady = false
    private var speakJob: Job? = null
    private var recogniserActive = false
    private var ignoreClientErrorUntilMillis = 0L

    /** The voice currently speaking, retained so barge-in can stop playback. */
    private var activeCloudVoice: AzureNeuralVoice? = null

    /**
     * The reply currently being said. Cleared by [stopSpeaking], which is what lets a
     * completion callback from a reply that has since been overtaken be ignored rather
     * than end a turn that has already moved on.
     */
    private var currentUtteranceId: String? = null

    /**
     * An utterance that arrived before TextToSpeech finished initialising.
     *
     * TTS init is asynchronous and can take hundreds of milliseconds, while a model reply
     * can land in about a second. Dropping the utterance in that window is the difference
     * between "Junction answered me" and "Junction heard me and then said nothing" on the
     * first thing an owner ever tries -- and it failed silently, with only a log line.
     * Only the most recent is held: if two replies arrive before the engine is up, the
     * newer one is the one still worth speaking.
     */
    private val pendingUtterance = PendingSpeech()

    private val bargeIn = BargeInDetector(onBargeIn = { events?.onOwnerCutIn() })

    /** Monotonic, so a clock adjustment mid-call can't expire every deadline at once. */
    override fun nowMillis(): Long = SystemClock.elapsedRealtime()

    override val canRecognise: Boolean
        get() = runCatching { SpeechRecognizer.isRecognitionAvailable(context) }.getOrDefault(false)

    override fun start(events: VoiceEngineEvents) {
        this.events = events
        VoiceTrace.sessionStart(canRecognise)

        tts = TextToSpeech(context) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            VoiceTrace.ttsReady(ttsReady)
            if (ttsReady) {
                tts?.language = Locale.getDefault()
                // Speak anything that arrived while the engine was still starting.
                pendingUtterance.take()?.let { queued -> speakOnDevice(queued) }
            } else {
                pendingUtterance.discard()
            }
            events.onSpeechEngineReady(ttsReady)
        }
        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {
                VoiceTrace.speaking()
                events.onSpeechStarted(utteranceId)
            }

            override fun onDone(utteranceId: String?) = reportFinished(utteranceId)

            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) = reportFinished(utteranceId)

            override fun onStop(utteranceId: String?, interrupted: Boolean) {
                // Deliberately silent. Every stop that matters goes through stopSpeaking,
                // which reports it; this also fires for the QUEUE_FLUSH of an overtaken
                // reply, where reporting again would end a turn that has already started.
            }
        })

        if (canRecognise) rebuildRecogniser()
    }

    override fun armRecogniser(): Boolean {
        // The mic serves one client at a time and the recognition service is in another
        // process, so anything of ours still holding it has to let go first.
        bargeIn.stop()
        // A single-shot recogniser left mid-utterance answers the next startListening with
        // ERROR_RECOGNIZER_BUSY; cancelling first is free when it is already idle.
        cancelRecogniser()
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
        }
        val listening = recognizer ?: return false
        return runCatching { listening.startListening(intent) }
            .onFailure { Log.w(TAG, "Recogniser refused to start", it) }
            .isSuccess
            .also { recogniserActive = it }
    }

    override fun cancelRecogniser() {
        if (!recogniserActive) return
        // Samsung reports an intentional cancel as ERROR_CLIENT. That callback is not a
        // failed listening turn and must not schedule a re-arm underneath TTS playback.
        ignoreClientErrorUntilMillis = SystemClock.elapsedRealtime() + CANCEL_CALLBACK_WINDOW_MS
        recogniserActive = false
        runCatching { recognizer?.cancel() }
    }

    override fun rebuildRecogniser() {
        recogniserActive = false
        runCatching { recognizer?.destroy() }
        recognizer = runCatching {
            SpeechRecognizer.createSpeechRecognizer(context).apply {
                setRecognitionListener(recognitionListener())
            }
        }.onFailure { Log.w(TAG, "Could not create the recogniser", it) }.getOrNull()
    }

    override fun speak(text: String, utteranceId: String): Boolean {
        currentUtteranceId = utteranceId

        val cloud = cloudVoiceProvider()
        if (cloud?.isConfigured == true) {
            VoiceTrace.speakRequested(text.length, "cloud")
            activeCloudVoice = cloud
            speakJob = scope.launch {
                // Returns once playback has *started*; completion arrives on the callback,
                // which is what actually ends the turn. Treating the start as the end put
                // the microphone live underneath Junction's own voice for the whole reply.
                val spoke = cloud.speak(text) { reportFinished(utteranceId) }
                if (spoke) {
                    events?.onSpeechStarted(utteranceId)
                } else {
                    // Network down, bad key, quota exhausted -- say it with the on-device
                    // engine rather than going silent.
                    Log.w(TAG, "Cloud voice unavailable; falling back to on-device TTS")
                    activeCloudVoice = null
                    if (!speakOnDevice(text)) reportFinished(utteranceId)
                }
            }
            return true
        }

        return speakOnDevice(text)
    }

    /** @return false when nothing will be heard and no completion callback is coming. */
    private fun speakOnDevice(text: String): Boolean {
        if (!ttsReady) {
            VoiceTrace.speakRequested(text.length, "queued")
            // Hold it rather than drop it -- the engine is still initialising and will
            // flush this the moment it is ready. See [pendingUtterance].
            Log.d(TAG, "TTS not ready; queueing utterance until init completes")
            pendingUtterance.queue(text)
            return true
        }
        VoiceTrace.speakRequested(text.length, "device")
        val id = currentUtteranceId ?: return false
        val accepted = tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, id)
        if (accepted != TextToSpeech.SUCCESS) Log.w(TAG, "TTS refused the utterance")
        return accepted == TextToSpeech.SUCCESS
    }

    override fun stopSpeaking() {
        val wasSpeaking = currentUtteranceId != null || pendingUtterance.hasPending
        currentUtteranceId = null
        speakJob?.cancel()
        bargeIn.stop()
        activeCloudVoice?.stop()
        activeCloudVoice = null
        // A reply still waiting on the engine to start up has been overtaken too. Left
        // queued, it would surface later, on top of whatever replaced it or straight into
        // a live microphone.
        pendingUtterance.discard()
        runCatching { tts?.stop() }
        if (wasSpeaking) events?.onSpeechStopped()
    }

    override fun startBargeInListener(): Boolean = bargeIn.start()

    override fun stopBargeInListener() = bargeIn.stop()

    override fun shutdown() {
        stopSpeaking()
        runCatching { recognizer?.destroy() }
        recognizer = null
        recogniserActive = false
        runCatching {
            tts?.stop()
            tts?.shutdown()
        }
        tts = null
        ttsReady = false
        events = null
    }

    /** Report a reply reaching its end, unless it has already been overtaken or stopped. */
    private fun reportFinished(utteranceId: String?) {
        if (utteranceId != null && utteranceId != currentUtteranceId) return
        VoiceTrace.spokeDone()
        currentUtteranceId = null
        events?.onSpeechFinished(utteranceId)
    }

    private fun recognitionListener() = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {
            recogniserActive = true
            VoiceTrace.listening()
            events?.onRecogniserReady()
        }

        override fun onResults(results: Bundle?) {
            recogniserActive = false
            val text = results
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull()
                ?.trim()
            if (text.isNullOrBlank()) {
                VoiceTrace.silent()
                events?.onNothingHeard()
            } else {
                VoiceTrace.heard(text.length)
                events?.onHeard(text)
            }
        }

        override fun onError(error: Int) {
            recogniserActive = false
            if (
                error == SpeechRecognizer.ERROR_CLIENT &&
                SystemClock.elapsedRealtime() <= ignoreClientErrorUntilMillis
            ) {
                ignoreClientErrorUntilMillis = 0L
                VoiceTrace.asrCancelled()
                return
            }
            ignoreClientErrorUntilMillis = 0L
            VoiceTrace.asrError(error)
            when (error) {
                // Routine: silence or unclear audio. Not worth surfacing, but the
                // recogniser has stopped, so it still needs re-arming.
                SpeechRecognizer.ERROR_NO_MATCH,
                SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
                SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> events?.onNothingHeard()

                // Nothing to retry: retrying spins forever and never succeeds.
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> {
                    // Samsung can report this while its audio route is still handing the
                    // microphone back after TTS. Only end the call when Android's actual
                    // permission state agrees; otherwise this is a retryable platform
                    // stumble, not a revoked permission.
                    val permissionGranted = ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.RECORD_AUDIO
                    ) == PackageManager.PERMISSION_GRANTED
                    if (permissionGranted) {
                        Log.w(TAG, "Recognizer reported missing permission while RECORD_AUDIO is granted")
                        events?.onRecogniserFailed(RecogniserFailure.TRANSIENT, null)
                    } else {
                        events?.onRecogniserFailed(
                            RecogniserFailure.PERMISSION,
                            "Microphone permission is not granted."
                        )
                    }
                }

                // Usually a stumble rather than a death -- an OEM speech service
                // reloading, or a recogniser restarted too quickly.
                SpeechRecognizer.ERROR_CLIENT -> events?.onRecogniserFailed(
                    RecogniserFailure.TRANSIENT,
                    null
                )

                else -> events?.onRecogniserFailed(
                    RecogniserFailure.UNKNOWN,
                    "Speech recognition error (code $error)"
                )
            }
        }

        override fun onEndOfSpeech() {
            events?.onListeningEnded()
        }

        // The remaining callbacks carry nothing the call needs, but each one is proof the
        // recognition service is still alive, which is what stops the watchdog reclaiming
        // the floor from an owner who is simply still talking.
        override fun onBeginningOfSpeech() {
            events?.onRecogniserAlive()
        }

        override fun onRmsChanged(rmsdB: Float) {
            events?.onRecogniserAlive()
        }

        override fun onBufferReceived(buffer: ByteArray?) {
            events?.onRecogniserAlive()
        }

        override fun onPartialResults(partialResults: Bundle?) {
            events?.onRecogniserAlive()
        }

        override fun onEvent(eventType: Int, params: Bundle?) = Unit
    }

    private companion object {
        const val TAG = "AndroidVoiceEngine"
        const val CANCEL_CALLBACK_WINDOW_MS = 1_000L
    }
}
