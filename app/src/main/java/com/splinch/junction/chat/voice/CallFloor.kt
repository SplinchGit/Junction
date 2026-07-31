package com.splinch.junction.chat.voice

/**
 * Tracks who holds the floor on a call, and notices when whoever holds it has stopped
 * handing it back.
 *
 * [HandsFreeLoop] decides *whether* to re-arm the microphone once a turn ends. This
 * decides *that a turn ended at all* -- which turned out to be the harder half. The
 * recogniser only ever came back because a spoken reply finished, so every other way a
 * turn can end left the floor with Junction forever: a provider error, a turn that was
 * nothing but tool calls, a plan waiting on approval, a blank reply, a TTS engine that
 * never fires its completion callback, a recognition service that wedges without calling
 * back. In all of those the mic chip stayed lit and Junction never listened again. From
 * the owner's side that is one sentence per tap -- a walkie-talkie, not a call.
 *
 * So every holder gets a deadline. Overrun it and the floor is forfeit, the caller
 * re-arms, and the line survives a failure nobody predicted. The budgets are deliberately
 * generous: cutting a real reply short is a worse bug than recovering a few seconds late.
 *
 * Pure state machine, no Android types and no clock of its own -- the caller passes the
 * time in, so the policy is unit tested rather than inferred from a device.
 */
class CallFloor(
    private val listeningBudgetMillis: Long = DEFAULT_LISTENING_BUDGET_MS,
    private val thinkingBudgetMillis: Long = DEFAULT_THINKING_BUDGET_MS,
    private val millisPerChar: Long = DEFAULT_MILLIS_PER_CHAR,
    private val speechGraceMillis: Long = DEFAULT_SPEECH_GRACE_MS
) {

    /** Who is expected to produce the next thing that happens. */
    enum class Holder {
        /** Between turns, or the call is over. Nothing is owed. */
        NOBODY,

        /** The mic is armed and the owner's words are what everyone is waiting on. */
        OWNER,

        /** The owner has finished speaking and a reply is being worked out. */
        JUNCTION_THINKING,

        /** A reply is being spoken aloud. */
        JUNCTION_SPEAKING
    }

    var holder: Holder = Holder.NOBODY
        private set

    /** When the current holder forfeits, or null when nothing is owed. */
    private var deadlineMillis: Long? = null

    /**
     * The mic is armed, or the recogniser has just proved it is still alive.
     *
     * Called both on arming and on every liveness callback the recogniser emits while it
     * listens (`onRmsChanged` fires roughly ten times a second), so the budget only runs
     * out when the recognition service has genuinely stopped talking to us. An engine that
     * emits no liveness callbacks at all costs the owner one long utterance rather than
     * the call.
     */
    fun ownerListening(nowMillis: Long) {
        holder = Holder.OWNER
        deadlineMillis = nowMillis + listeningBudgetMillis
    }

    /** The owner finished; a reply is being worked out. */
    fun junctionThinking(nowMillis: Long) {
        holder = Holder.JUNCTION_THINKING
        deadlineMillis = nowMillis + thinkingBudgetMillis
    }

    /**
     * A reply is going to be spoken. The budget scales with the length of the reply --
     * a paragraph legitimately takes far longer to say than a sentence -- plus a flat
     * grace that covers cloud synthesis happening before a single word is audible.
     */
    fun junctionSpeaking(nowMillis: Long, replyChars: Int) {
        holder = Holder.JUNCTION_SPEAKING
        deadlineMillis = nowMillis + speechBudgetMillis(replyChars)
    }

    /** Nothing is owed: the turn closed cleanly, or the call ended. */
    fun release() {
        holder = Holder.NOBODY
        deadlineMillis = null
    }

    /**
     * True exactly once when the current holder has overrun. Consuming rather than
     * querying, so a caller polling once a second recovers the turn once instead of
     * re-arming the recogniser on every tick.
     */
    fun takeOverrun(nowMillis: Long): Boolean {
        val deadline = deadlineMillis ?: return false
        if (nowMillis < deadline) return false
        release()
        return true
    }

    private fun speechBudgetMillis(replyChars: Int): Long =
        replyChars.coerceAtLeast(0) * millisPerChar + speechGraceMillis

    companion object {
        /**
         * How long the recogniser may go without saying anything at all -- not how long
         * the owner may speak. Any callback resets it.
         */
        const val DEFAULT_LISTENING_BUDGET_MS = 30_000L

        /**
         * A model turn that has produced nothing this long into a live conversation has
         * failed as far as the call is concerned, whatever it is still doing.
         */
        const val DEFAULT_THINKING_BUDGET_MS = 45_000L

        /** Around 11 characters a second: slower than any real speaking rate, on purpose. */
        const val DEFAULT_MILLIS_PER_CHAR = 90L

        /** Covers network synthesis and engine start-up before the first audible word. */
        const val DEFAULT_SPEECH_GRACE_MS = 10_000L
    }
}
