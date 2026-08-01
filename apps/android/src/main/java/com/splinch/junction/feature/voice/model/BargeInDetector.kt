package com.splinch.junction.feature.voice.model

import com.splinch.junction.feature.voice.local.*
import com.splinch.junction.feature.voice.model.*
import com.splinch.junction.feature.voice.realtime.*
import com.splinch.junction.feature.voice.service.*

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.log10
import kotlin.math.sqrt

/**
 * Listens for the owner cutting in while Junction is speaking, and says so once.
 *
 * The microphone half of barge-in. [BargeInGate] holds the decision; this only turns the
 * microphone into frames of loudness and hands them over.
 *
 * It does not compete with the recogniser for the microphone. This runs only while
 * Junction is speaking, which is exactly when [LocalVoiceSession] has deliberately left
 * the recogniser un-armed; the moment it fires, it stops, and the recogniser is armed in
 * its place. Two capture clients at once would be a fight one of them loses silently --
 * and the recognition service runs in another process, so the loser would be us.
 *
 * Refuses to run without hardware echo cancellation. Everything below is trying to tell
 * the owner's voice apart from Junction's own voice coming back through the speaker, and
 * without an echo canceller there is not enough difference to find: Junction would
 * interrupt itself constantly, which is worse than not being interruptible at all. A
 * device without it keeps the old half-duplex behaviour, where the mic button is the way
 * to cut in.
 *
 * Nothing is recorded, buffered or transcribed here. Each frame is reduced to a single
 * loudness number and discarded, so no audio of the owner outlives the 20 ms it took to
 * measure it.
 */
class BargeInDetector(
    private val gate: BargeInGate = BargeInGate(),
    /** Invoked on the main thread, at most once per [start], when the owner cuts in. */
    private val onBargeIn: () -> Unit
) {

    private val main = Handler(Looper.getMainLooper())
    private val running = AtomicBoolean(false)
    private var thread: Thread? = null

    /** Whether this device can do barge-in at all. Fixed for the lifetime of the device. */
    val isSupported: Boolean
        get() = runCatching { AcousticEchoCanceler.isAvailable() }.getOrDefault(false)

    /**
     * Begin listening underneath the current reply. Returns false when barge-in isn't
     * possible here -- no echo canceller, no microphone, permission withheld -- in which
     * case the caller simply carries on speaking uninterruptibly.
     */
    fun start(): Boolean {
        if (running.get()) return true
        if (!isSupported) {
            VoiceTrace.bargeInUnavailable("no_aec")
            return false
        }
        // A previous reply's listener may still be letting go of the microphone -- replies
        // can follow each other by microseconds. Opening a second capture on top of it
        // fails, and the new reply would silently be uninterruptible. The loop exits
        // within a frame, so this waits for a rounding error, not a reply.
        thread?.takeIf { it.isAlive }?.let { previous ->
            runCatching { previous.join(HANDOVER_WAIT_MS) }
        }
        thread = null

        val minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE_HZ, CHANNEL, ENCODING)
        if (minBuffer <= 0) {
            VoiceTrace.bargeInUnavailable("no_buffer")
            return false
        }

        val record = runCatching {
            AudioRecord(
                // VOICE_COMMUNICATION rather than MIC: it is the source the platform runs
                // its echo canceller and gain control on, which is the whole point here.
                MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                SAMPLE_RATE_HZ,
                CHANNEL,
                ENCODING,
                maxOf(minBuffer, FRAME_SAMPLES * 2 * BUFFER_FRAMES)
            )
        }.onFailure {
            // SecurityException when the mic permission was revoked mid-call, and
            // IllegalArgumentException on devices that reject the configuration. Neither
            // is worth ending a call over: the reply just isn't interruptible.
            Log.w(TAG, "Could not open the barge-in microphone", it)
            VoiceTrace.bargeInUnavailable("open_failed")
        }.getOrNull() ?: return false

        if (record.state != AudioRecord.STATE_INITIALIZED) {
            runCatching { record.release() }
            VoiceTrace.bargeInUnavailable("uninitialised")
            return false
        }

        val effects = attachEffects(record.audioSessionId)
        val started = runCatching { record.startRecording() }
            .onFailure { Log.w(TAG, "Could not start the barge-in microphone", it) }
            .isSuccess
        if (!started || record.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
            releaseAll(record, effects)
            VoiceTrace.bargeInUnavailable("start_failed")
            return false
        }

        gate.reset()
        running.set(true)
        VoiceTrace.bargeInArmed()
        thread = Thread({ readLoop(record, effects) }, "junction-barge-in").apply {
            // Below the audio thread but above the UI: falling behind here only costs
            // responsiveness on an interruption, never correctness elsewhere.
            priority = Thread.NORM_PRIORITY + 1
            start()
        }
        return true
    }

    /**
     * Stop listening. Safe to call when never started, and safe to call twice.
     *
     * Returns immediately rather than waiting for the audio thread to finish: this is
     * called from the main thread on the way to arming the recogniser, and blocking there
     * would show up as a stutter at the exact moment the owner starts talking. [start]
     * picks up the wait instead, where it costs nothing.
     */
    fun stop() {
        running.set(false)
    }

    private fun readLoop(record: AudioRecord, effects: List<android.media.audiofx.AudioEffect>) {
        val frame = ShortArray(FRAME_SAMPLES)
        try {
            while (running.get()) {
                val read = record.read(frame, 0, frame.size)
                if (read <= 0) {
                    // ERROR_INVALID_OPERATION or a dead session: nothing to recover, and
                    // spinning on a failing read would burn the battery mid-call.
                    if (read < 0) break else continue
                }
                if (!gate.offer(frameDb(frame, read))) continue

                VoiceTrace.bargeIn()
                running.set(false)
                main.post { onBargeIn() }
                break
            }
        } catch (e: Exception) {
            Log.w(TAG, "Barge-in listener stopped", e)
        } finally {
            running.set(false)
            releaseAll(record, effects)
        }
    }

    /**
     * Root-mean-square loudness of one frame in dBFS, where 0 dB is full scale and every
     * real value is negative. dB rather than raw amplitude because speech energy spans
     * orders of magnitude, and a margin in dB is a constant ratio at any volume.
     */
    private fun frameDb(frame: ShortArray, count: Int): Double {
        var sumOfSquares = 0.0
        for (i in 0 until count) {
            val sample = frame[i].toDouble()
            sumOfSquares += sample * sample
        }
        val rms = sqrt(sumOfSquares / count)
        if (rms <= 0.0) return BargeInGate.SILENCE_DB
        return 20.0 * log10(rms / Short.MAX_VALUE.toDouble())
    }

    /**
     * Echo cancellation is mandatory (see the class doc); noise suppression is a bonus
     * that stops a noisy room drifting the measured floor upward mid-reply.
     */
    private fun attachEffects(sessionId: Int): List<android.media.audiofx.AudioEffect> =
        listOfNotNull(
            runCatching { AcousticEchoCanceler.create(sessionId)?.apply { enabled = true } }
                .onFailure { Log.w(TAG, "Echo canceller unavailable on this session", it) }
                .getOrNull(),
            runCatching {
                if (NoiseSuppressor.isAvailable()) {
                    NoiseSuppressor.create(sessionId)?.apply { enabled = true }
                } else {
                    null
                }
            }.getOrNull()
        )

    private fun releaseAll(record: AudioRecord, effects: List<android.media.audiofx.AudioEffect>) {
        effects.forEach { effect -> runCatching { effect.release() } }
        runCatching { if (record.recordingState == AudioRecord.RECORDSTATE_RECORDING) record.stop() }
        runCatching { record.release() }
    }

    private companion object {
        const val TAG = "BargeInDetector"

        /** Matches what the platform recognisers use, and every device supports it. */
        const val SAMPLE_RATE_HZ = 16_000
        const val CHANNEL = AudioFormat.CHANNEL_IN_MONO
        const val ENCODING = AudioFormat.ENCODING_PCM_16BIT

        /** 20 ms at 16 kHz: fine enough to time an interruption, coarse enough to be cheap. */
        const val FRAME_SAMPLES = 320

        /** Headroom so a scheduling hiccup drops responsiveness rather than samples. */
        const val BUFFER_FRAMES = 8

        /** Ceiling on waiting for the previous reply's listener to release the mic. */
        const val HANDOVER_WAIT_MS = 100L
    }
}
