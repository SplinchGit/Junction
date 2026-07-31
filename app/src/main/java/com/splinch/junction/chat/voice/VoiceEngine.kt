package com.splinch.junction.chat.voice

/**
 * Everything a call needs from the device, behind one interface.
 *
 * The turn-taking -- when the microphone comes back, when a turn is over, what happens
 * when a reply never arrives -- is the part that kept breaking, and it kept breaking in
 * the *wiring* rather than the policy. [HandsFreeLoop] and [CallFloor] were both correct
 * and both unit tested while the call still died after one sentence, because nothing
 * could test how [LocalVoiceSession] joined them to the platform.
 *
 * So the platform sits behind this, [LocalVoiceSession] holds no Android types at all, and
 * a whole conversation can be run through it in a JVM test. What is left on the far side
 * of this interface is audio plumbing: engines, sample rates, echo cancellation. That part
 * genuinely needs a phone, and no amount of indirection changes it.
 */
interface VoiceEngine {

    /**
     * Monotonic milliseconds, for the deadlines in [CallFloor]. On the interface because
     * the clock is a platform detail like any other -- and because a test needs to be able
     * to skip forty seconds without waiting forty seconds.
     */
    fun nowMillis(): Long

    /** True when this device can transcribe speech at all. */
    val canRecognise: Boolean

    /** Bring the microphone and speech engines up. Everything is reported to [events]. */
    fun start(events: VoiceEngineEvents)

    /**
     * Point the recogniser at the microphone for one utterance. Returns false when it
     * refused outright, which is a stumble rather than the end of the call.
     */
    fun armRecogniser(): Boolean

    /** Stop the recogniser without producing a result. Silent: no failure is reported. */
    fun cancelRecogniser()

    /** Throw the recogniser away and build another, for when it has stopped responding. */
    fun rebuildRecogniser()

    /**
     * Say [text], tagged with [utteranceId] so a completion from a reply that has since
     * been overtaken can be told apart from the current one. Returns false when nothing
     * will be heard and no completion is coming, so the caller can end the turn itself
     * rather than wait for a callback that will never arrive.
     */
    fun speak(text: String, utteranceId: String): Boolean

    /** Stop mid-word. Reports [VoiceEngineEvents.onSpeechStopped], never `onSpeechFinished`. */
    fun stopSpeaking()

    /**
     * Listen underneath the current reply for the owner talking over it. Returns false
     * where that can't be done safely, in which case the reply is simply uninterruptible.
     */
    fun startBargeInListener(): Boolean

    fun stopBargeInListener()

    /** Release the microphone, the speech engines and anything holding audio. */
    fun shutdown()
}

/** Why the recogniser stopped, in terms the turn-taking cares about. */
enum class RecogniserFailure {
    /** No microphone permission. Retrying fails identically forever. */
    PERMISSION,

    /** Usually an OEM speech service reloading. Worth retrying a bounded number of times. */
    TRANSIENT,

    /** Something else the platform reported. Treated as a turn that heard nothing. */
    UNKNOWN
}

/** What the device tells the call. Implemented by [LocalVoiceSession]. */
interface VoiceEngineEvents {
    /** The speech engine finished starting up, or failed to. */
    fun onSpeechEngineReady(ok: Boolean)

    /** The microphone is live and the owner's turn has properly begun. */
    fun onRecogniserReady()

    /**
     * The recogniser is still there. Fired by every incidental callback the platform
     * emits while listening, which is what stops the watchdog reclaiming the floor from
     * an owner who is simply still talking.
     */
    fun onRecogniserAlive()

    /** The owner stopped speaking; a result is on its way. */
    fun onListeningEnded()

    /** Words. */
    fun onHeard(text: String)

    /** The turn produced nothing usable: silence, or audio that matched nothing. */
    fun onNothingHeard()

    /** The recogniser stopped because of [kind]; [message] is for the owner, if any. */
    fun onRecogniserFailed(kind: RecogniserFailure, message: String?)

    /** Audio is coming out of the speaker. */
    fun onSpeechStarted(utteranceId: String?)

    /** The reply reached its end of its own accord. */
    fun onSpeechFinished(utteranceId: String?)

    /** Playback was cut short -- barge-in, or a newer reply flushing this one. */
    fun onSpeechStopped()

    /** The owner talked over the reply. */
    fun onOwnerCutIn()
}
