package com.splinch.junction.feature.voice.local

import com.splinch.junction.feature.voice.local.*
import com.splinch.junction.feature.voice.model.*
import com.splinch.junction.feature.voice.realtime.*
import com.splinch.junction.feature.voice.service.*

import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

interface LocalVoiceListener {
    fun onUserUtterance(text: String)
    fun onListeningStateChanged(listening: Boolean)
    fun onSpeakingStateChanged(speaking: Boolean)
    fun onError(message: String)

    /**
     * The call has ended on its own -- no microphone permission, or a recogniser that
     * never recovered. The UI must clear its "Mic on" state: showing a live mic while
     * nothing is listening is the exact illusion that makes voice look broken.
     */
    fun onHandsFreeEnded()
}

/**
 * §3.1 provider-agnostic voice: a call built on the device's own speech recognition and
 * synthesis rather than OpenAI Realtime. Recognised speech is handed to the listener as
 * plain text -- the caller feeds it through the same `chat/provider/LlmProvider` text lane
 * every other message goes through, so voice gets the identical tool/trust/plan pipeline
 * as typed chat, just with a different front end.
 *
 * ## What makes it a call rather than a walkie-talkie
 *
 * - **The mic comes back after every turn.** [HandsFreeLoop] decides when to re-arm, and
 *   on [HandsFreeLoop.Mode.CALL] silence is a pause rather than a reason to hang up.
 * - **A turn always ends.** [CallFloor] puts a deadline on whoever holds the floor, so a
 *   turn that dies quietly hands the line back instead of stranding it. Re-arming used to
 *   hang off a spoken reply finishing, which meant a provider error, a turn of tool calls,
 *   an empty reply or an engine that skipped its completion callback all left the mic dead
 *   with the chip still lit.
 * - **The owner can interrupt.** [BargeInDetector] listens underneath playback and cuts
 *   the reply off the moment they talk over it, where echo cancellation makes that safe.
 *
 * ## Threading
 *
 * Every entry point and every engine callback is marshalled onto [scope] before it touches
 * anything here. That is not incidental tidiness: the TTS engine reports from its own
 * binder thread and `SpeechRecognizer` throws when touched from anywhere else, so the
 * re-arm at the end of each reply threw, was swallowed, and a working recogniser was
 * written off as a fatal failure. Every call ended after exactly one sentence, and it
 * looked precisely like the re-arm policy being wrong.
 *
 * Holds no Android types at all, so a whole conversation can be run through it in a JVM
 * test with a fake [VoiceEngine] -- see `LocalVoiceSessionTest`.
 */
class LocalVoiceSession(
    private val listener: LocalVoiceListener,
    private val engine: VoiceEngine,
    /** Single-threaded by contract: everything below assumes serialised execution. */
    private val scope: CoroutineScope,
    private val handsFree: HandsFreeLoop = HandsFreeLoop(),
    private val floor: CallFloor = CallFloor()
) : VoiceEngineEvents {

    private var started = false

    /** Polls [floor] while the line is open; runs only for the duration of a call. */
    private var floorWatchJob: Job? = null

    /** Pending re-arm, cancelled whenever the owner or a new turn overtakes it. */
    private var reArmJob: Job? = null

    /** True while the owner is on a call, for callers that need to know. */
    val isOnCall: Boolean
        get() = handsFree.isActive

    fun start() = onSession {
        if (started) return@onSession
        started = true
        engine.start(this)
        if (!engine.canRecognise) {
            listener.onError("Speech recognition is not available on this device.")
        }
    }

    fun stop() = onSession {
        started = false
        handsFree.stop()
        floor.release()
        floorWatchJob?.cancel()
        reArmJob?.cancel()
        engine.shutdown()
    }

    /**
     * The owner turned the mic on. Cuts any reply still playing, then listens -- and keeps
     * listening across turns until they turn it off again.
     *
     * Defaults to [HandsFreeLoop.Mode.CALL], so this opens a line rather than a single
     * hands-free request: the owner can pause, think, or listen without Junction deciding
     * the conversation is over and standing the mic down behind their back. The line
     * closes when they close it, or on an unrecoverable recogniser failure.
     */
    fun startListening(mode: HandsFreeLoop.Mode = HandsFreeLoop.Mode.CALL) = onSession {
        // Also drops any reply still waiting on the speech engine to start: the owner is
        // talking now, so something they interrupted must not surface afterwards.
        engine.stopSpeaking()
        handsFree.start(mode)
        watchFloor()
        arm()
    }

    fun stopListening() = onSession {
        handsFree.stop()
        floor.release()
        floorWatchJob?.cancel()
        reArmJob?.cancel()
        engine.stopBargeInListener()
        engine.cancelRecogniser()
    }

    /**
     * The turn ended without a word being spoken: the provider failed, the model asked for
     * tools instead of answering, a plan is waiting for approval, or the reply was empty.
     * Hands the line back to the owner.
     *
     * Ignored unless Junction actually holds the floor, so a caller reporting the end of a
     * turn Junction never held -- a typed message, or a reply already being spoken --
     * cannot cut the owner off or double-arm the recogniser.
     */
    fun onTurnEnded(reason: String) = onSession {
        if (!handsFree.isActive) return@onSession
        if (floor.holder != CallFloor.Holder.JUNCTION_THINKING) return@onSession
        releaseFloorAndReArm(reason)
    }

    fun speak(text: String) = onSession {
        if (text.isBlank()) {
            // Nothing to say still ends the turn. Returning silently here is how a reply
            // that came back empty used to strand the line.
            releaseFloorAndReArm("empty_reply")
            return@onSession
        }

        // Never speak into a live mic: the recogniser would transcribe Junction and answer
        // it. Matters when a reply arrives from somewhere other than the call -- a typed
        // message, say -- while the owner's turn is already armed.
        reArmJob?.cancel()
        engine.cancelRecogniser()
        // A reply still playing has been overtaken.
        engine.stopSpeaking()

        floor.junctionSpeaking(engine.nowMillis(), text.length)
        if (!engine.speak(text, UUID.randomUUID().toString())) {
            // The engine refused outright, so nothing will be heard and no completion
            // callback is coming. Hand the line back rather than wait for the watchdog.
            releaseFloorAndReArm("speech_refused")
        }
    }

    // ── VoiceEngineEvents ───────────────────────────────────────────────────

    override fun onSpeechEngineReady(ok: Boolean) = onSession {
        if (ok) return@onSession
        // Going quietly mute is indistinguishable from Junction ignoring the owner.
        listener.onError("Text-to-speech is unavailable on this device.")
        // And a call must not stall waiting for a reply that can never be spoken.
        releaseFloorAndReArm("tts_unavailable")
    }

    override fun onRecogniserReady() = onSession {
        handsFree.onRecogniserReady()
        floor.ownerListening(engine.nowMillis())
        listener.onListeningStateChanged(true)
    }

    override fun onRecogniserAlive() = onSession {
        if (floor.holder == CallFloor.Holder.OWNER) floor.ownerListening(engine.nowMillis())
    }

    override fun onListeningEnded() = onSession {
        listener.onListeningStateChanged(false)
    }

    override fun onHeard(text: String) = onSession {
        listener.onListeningStateChanged(false)
        // The floor is Junction's now, and on a deadline: a reply that never comes hands
        // the line back rather than ending the conversation.
        floor.junctionThinking(engine.nowMillis())
        // Deliberately does not re-arm yet -- the recogniser must not be live while the
        // reply is spoken, or Junction transcribes itself and answers its own reply.
        applyDecision(handsFree.onSpeechHeard())
        listener.onUserUtterance(text)
    }

    override fun onNothingHeard() = onSession {
        listener.onListeningStateChanged(false)
        applyDecision(handsFree.onSilentTurn())
    }

    override fun onRecogniserFailed(kind: RecogniserFailure, message: String?) = onSession {
        listener.onListeningStateChanged(false)
        VoiceTrace.recogniserFailure(kind)
        when (kind) {
            RecogniserFailure.PERMISSION -> {
                handsFree.onFatalError()
                endCall(message ?: "The microphone is unavailable.", "fatal")
            }

            // Retried a bounded number of times. Ending the call on the first stumble
            // dropped the line mid-conversation for a reason the owner could never see.
            RecogniserFailure.TRANSIENT -> applyDecision(
                handsFree.onRecogniserFailure(),
                giveUpReason = "Stopped listening — the speech recogniser kept failing.",
                giveUpTrace = "recogniser"
            )

            RecogniserFailure.UNKNOWN -> {
                message?.let { listener.onError(it) }
                applyDecision(handsFree.onSilentTurn())
            }
        }
    }

    override fun onSpeechStarted(utteranceId: String?) = onSession {
        listener.onSpeakingStateChanged(true)
        // Only now, with audio actually coming out of the speaker: the detector calibrates
        // itself against Junction's own voice leaking back, so starting it against a silent
        // room would set the bar at room noise and Junction would interrupt itself.
        if (handsFree.isActive) engine.startBargeInListener()
    }

    override fun onSpeechFinished(utteranceId: String?) = onSession {
        listener.onSpeakingStateChanged(false)
        engine.stopBargeInListener()
        // Junction has finished its reply, so the owner's turn is next. Leave a short
        // handover for Samsung's TTS/AudioRecord path to release the microphone before
        // SpeechRecognizer asks for it. Re-arming in the same millisecond makes the OEM
        // service report a false permission failure and drops the call after every reply.
        val decision = handsFree.onReplyFinished()
        applyDecision(
            if (decision == HandsFreeLoop.Decision.ReArmNow) {
                HandsFreeLoop.Decision.ReArmAfter(REPLY_AUDIO_HANDOVER_MS)
            } else {
                decision
            }
        )
    }

    override fun onSpeechStopped() = onSession {
        // Barge-in, or a newer reply overtaking this one. Deliberately does not re-arm:
        // either the owner is already talking, or another reply is about to start.
        listener.onSpeakingStateChanged(false)
    }

    override fun onOwnerCutIn() = onSession {
        if (!handsFree.isActive) return@onSession
        engine.stopSpeaking()
        // Straight back to the owner, with no re-arm delay: they are mid-sentence.
        applyDecision(handsFree.onBargeIn())
    }

    // ── Turn plumbing ───────────────────────────────────────────────────────

    /** Point the recogniser at the microphone for one utterance. */
    private fun arm() {
        reArmJob?.cancel()
        VoiceTrace.listeningArmed()
        floor.ownerListening(engine.nowMillis())
        if (engine.armRecogniser()) return
        // Not fatal by default: this is usually a transient hiccup, and hanging up on it
        // was itself the bug. HandsFreeLoop caps how often it is retried.
        applyDecision(
            handsFree.onRecogniserFailure(),
            giveUpReason = "Stopped listening — the speech recogniser keeps failing to start.",
            giveUpTrace = "recogniser"
        )
    }

    /** A turn is over without anything having been said. One trace point for all of them. */
    private fun releaseFloorAndReArm(reason: String) {
        if (!handsFree.isActive) return
        VoiceTrace.turnEnded(reason)
        floor.release()
        applyDecision(handsFree.onTurnEnded())
    }

    /** Carry out whatever [HandsFreeLoop] decided after a turn ended. */
    private fun applyDecision(
        decision: HandsFreeLoop.Decision,
        giveUpReason: String = "Stopped listening — nothing heard for a while.",
        giveUpTrace: String = "silence"
    ) {
        reArmJob?.cancel()
        when (decision) {
            is HandsFreeLoop.Decision.ReArmNow -> arm()
            is HandsFreeLoop.Decision.ReArmAfter -> {
                // The floor is the owner's from here: the wait is part of their turn, so
                // the watchdog must not count it against a holder who has already handed
                // it over.
                floor.ownerListening(engine.nowMillis() + decision.delayMillis)
                reArmJob = scope.launch {
                    delay(decision.delayMillis)
                    arm()
                }
            }

            is HandsFreeLoop.Decision.GiveUp -> endCall(giveUpReason, giveUpTrace)
            is HandsFreeLoop.Decision.Idle -> Unit
        }
    }

    /** Stand the call down and make sure nothing is left claiming to be listening. */
    private fun endCall(message: String, trace: String) {
        floor.release()
        floorWatchJob?.cancel()
        reArmJob?.cancel()
        engine.stopBargeInListener()
        engine.cancelRecogniser()
        VoiceTrace.handsFreeEnded(trace)
        listener.onError(message)
        listener.onHandsFreeEnded()
    }

    /**
     * Watches for a turn that never ends. Everything else here is driven by a callback
     * from the platform, so a callback that simply never arrives -- a wedged recognition
     * service, an engine that skips its completion, a reply nobody ever asked to speak --
     * would otherwise leave the line open and deaf for as long as the owner kept believing
     * in it.
     */
    private fun watchFloor() {
        floorWatchJob?.cancel()
        floorWatchJob = scope.launch {
            while (isActive && handsFree.isActive) {
                delay(FLOOR_TICK_MS)
                val holder = floor.holder
                if (!floor.takeOverrun(engine.nowMillis())) continue
                VoiceTrace.floorOverrun(holder.name)
                if (holder == CallFloor.Holder.OWNER) {
                    // The recogniser has gone quiet without so much as an error. Nothing
                    // short of a new instance reliably brings it back.
                    engine.rebuildRecogniser()
                } else {
                    // Whatever was playing has outrun any sane estimate of its length;
                    // silence it so the mic doesn't come up underneath it.
                    engine.stopSpeaking()
                }
                applyDecision(handsFree.onTurnEnded())
            }
        }
    }

    /**
     * Marshals onto the session's own context. See the threading note on the class: this
     * is the whole reason a call now survives past its first reply.
     */
    private fun onSession(block: () -> Unit) {
        scope.launch { block() }
    }

    private companion object {
        /** How often the floor is checked for an overrun. Cheap; a call is minutes long. */
        const val FLOOR_TICK_MS = 1_000L

        /** Lets the platform release TTS/barge-in capture before recognition resumes. */
        const val REPLY_AUDIO_HANDOVER_MS = 250L
    }
}
