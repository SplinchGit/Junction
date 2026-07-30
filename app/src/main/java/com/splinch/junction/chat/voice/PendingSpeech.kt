package com.splinch.junction.chat.voice

/**
 * Holds a reply that arrived before the text-to-speech engine finished starting.
 *
 * Extracted from [LocalVoiceSession] so the semantics are testable without an Android
 * TTS engine. The bug this guards against was silent -- an utterance was dropped with
 * only a log line, so voice appeared to work right up until Junction should have
 * spoken, and then simply didn't.
 *
 * Rules, all of which the tests pin:
 *  - the newest utterance wins; an older queued one is stale by the time the engine
 *    is up, and speaking both would talk over the owner
 *  - taking it clears it, so it is spoken exactly once
 *  - barge-in and shutdown discard it: a reply the owner interrupted must not surface
 *    afterwards
 */
class PendingSpeech {

    private var queued: String? = null

    /** Queue [text], replacing anything already waiting. Blank input is ignored. */
    fun queue(text: String) {
        if (text.isBlank()) return
        queued = text
    }

    /** Returns and clears the queued utterance, or null if there is none. */
    fun take(): String? {
        val value = queued
        queued = null
        return value
    }

    /** Discard without speaking -- barge-in, or the session shutting down. */
    fun discard() {
        queued = null
    }

    val hasPending: Boolean
        get() = queued != null
}
