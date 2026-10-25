package com.splinch.junction.assistant.planning

import com.splinch.junction.assistant.tools.RiskTier
import java.security.MessageDigest

/**
 * Spoken confirmation for a plan that [com.splinch.junction.assistant.trust.TrustGate] has
 * already parked for owner approval. Voice never widens what can run: it is a second way
 * to give the same plan-level approval, bound to one exact plan and what was read aloud.
 *
 * Speech recognition is not speaker authentication. Approval is therefore accepted only
 * during an active, owner-started local voice call, only after the full disclosure has
 * finished playing, only for a narrow confirmation phrase, once, and briefly.
 */
object VoiceApprovalPolicy {
    /** Tools whose effect is understandable and bounded when read aloud. Everything else stays on screen. */
    val VOICE_ELIGIBLE_TOOLS = setOf(
        "email_send", "gmail_draft_reply", "reply_notification", "dismiss_notification", "email_archive",
        "schedule_calendar_reminder", "remember_fact", "forget_fact", "archive_feed_item", "set_feed_filter",
        "set_speech_mode", "open_app"
    )
    private val SEND_TOOLS = setOf("email_send", "reply_notification")
    const val MAX_STEPS = 3
    /** A tainted plan's outgoing text must be read in full; longer text needs the screen. */
    const val MAX_VERBATIM_CHARS = 600
    /** Untainted previews are concise. */
    const val PREVIEW_CHARS = 240

    data class DraftDisclosure(val recipient: String, val body: String)

    sealed class Disclosure {
        data class Eligible(val spoken: String, val digest: String, val verb: String, val summary: String) : Disclosure()
        data class ScreenOnly(val reason: String) : Disclosure()
    }

    /**
     * [drafts] resolves a Gmail draft created earlier in this session, so a send can name its
     * recipient and content rather than a draft ID. [stepHash] must be the same canonical
     * argument hash TrustGate binds, so a changed plan cannot reuse this disclosure.
     */
    fun disclose(plan: Plan, drafts: (String) -> DraftDisclosure?, stepHash: (Step) -> String): Disclosure {
        val steps = plan.steps.filter { it.status == StepStatus.PENDING }
        if (steps.isEmpty()) return Disclosure.ScreenOnly("nothing is waiting")
        // An email send is re-read from Gmail at send time and refused if it differs from what
        // was spoken (see ToolExecutor.requireExactDraft). A notification reply has no such
        // check: its target can change underneath, so it stays on screen.
        if (steps.any { it.tool == "reply_notification" }) {
            return Disclosure.ScreenOnly("a notification reply's target can't be checked again at send time")
        }
        if (steps.size > MAX_STEPS) return Disclosure.ScreenOnly("it has too many steps to read aloud")
        if (steps.any { it.riskTier == RiskTier.DESTRUCTIVE }) return Disclosure.ScreenOnly("it can change code, install software, or is not a recognised action")
        steps.firstOrNull { it.tool !in VOICE_ELIGIBLE_TOOLS }?.let { return Disclosure.ScreenOnly("${it.tool.replace('_', ' ')} needs an on-screen check") }
        val parts = mutableListOf<String>()
        for (step in steps) {
            val line = describe(step, plan.tainted, drafts) ?: return Disclosure.ScreenOnly(
                if (plan.tainted) "it was influenced by content Junction read, and the full text is too long to read aloud" else "I can't read that action back exactly"
            )
            parts += line
        }
        val verb = if (steps.any { it.tool in SEND_TOOLS }) "send" else "confirm"
        val instruction = if (verb == "send") "Say “send it” to send exactly this, or “cancel”." else "Say “confirm” to go ahead, or “cancel”."
        val spoken = "${parts.joinToString(" Then, ")} $instruction"
        // Bind the entire draft, including text omitted from the concise spoken preview.
        val draftBindings = steps.filter { it.tool == "email_send" }.map { step ->
            val draft = drafts(step.arguments.optString("draftId")) ?: return Disclosure.ScreenOnly("the draft is no longer available")
            sha256(draft.recipient + "\n" + draft.body)
        }
        val digest = sha256(plan.id + "\n" + steps.joinToString("\n") { stepHash(it) } + "\n" + draftBindings.joinToString("\n") + "\n" + spoken)
        return Disclosure.Eligible(spoken = spoken, digest = digest, verb = verb, summary = steps.joinToString("; ") { it.summary })
    }

    private fun describe(step: Step, tainted: Boolean, drafts: (String) -> DraftDisclosure?): String? {
        val args = step.arguments
        return when (step.tool) {
            "email_send" -> {
                val draft = drafts(args.optString("draftId")) ?: return null
                val body = quoted(draft.body, tainted) ?: return null
                "Ready to send the email to ${draft.recipient}. It says: $body."
            }
            "gmail_draft_reply" -> {
                val body = quoted(args.optString("body"), tainted) ?: return null
                "I'll save a reply draft in that email thread; nothing is sent yet. It says: $body."
            }
            "reply_notification" -> {
                val text = quoted(args.optString("text"), tainted) ?: return null
                "Ready to reply to that notification with: $text."
            }
            else -> step.summary.takeIf { it.isNotBlank() }?.let { "$it." }
        }
    }

    private fun quoted(text: String, tainted: Boolean): String? {
        val clean = text.replace(Regex("\\s+"), " ").trim()
        if (clean.isEmpty()) return null
        if (tainted) return if (clean.length <= MAX_VERBATIM_CHARS) "“$clean”" else null
        return if (clean.length <= PREVIEW_CHARS) "“$clean”" else "“${clean.take(PREVIEW_CHARS).substringBeforeLast(' ')}…”, and ${clean.length - PREVIEW_CHARS} more characters shown on screen"
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}

/** Classifies one recognised utterance against a pending spoken approval. */
object VoiceConfirmationParser {
    enum class Kind { CONFIRM, CANCEL, BARE_YES, OTHER }

    private val FILLER = setOf("yes", "yeah", "yep", "please", "it", "this", "that", "the", "email", "message", "reply", "now", "go", "ahead", "and", "ok", "okay", "sure", "draft", "one", "exact")
    private val BARE = setOf("yes", "yeah", "yep", "yup", "ok", "okay", "sure", "alright", "fine", "correct", "right", "mhm", "uh huh", "sounds good", "yes please")
    private val NEGATION = Regex("\\b(?:no|not|don't|dont|do not|cancel|stop|wait|never|nope|hold on|don't send)\\b")
    private val CANCEL_START = Regex("^(?:no|nope|cancel|don't|dont|do not|stop|wait|never mind|nevermind|hold on|not now|abort)\\b")

    fun classify(utterance: String, verb: String): Kind {
        val text = utterance.lowercase().replace(Regex("[^a-z' ]"), " ").replace(Regex("\\s+"), " ").trim()
        if (text.isEmpty()) return Kind.OTHER
        val words = text.split(' ')
        if (CANCEL_START.containsMatchIn(text) && words.size <= 8) return Kind.CANCEL
        if (text in BARE) return Kind.BARE_YES
        if (words.size > 6 || NEGATION.containsMatchIn(text)) return Kind.OTHER
        val verbs = if (verb == "send") setOf("send") else setOf("confirm", "confirmed", "approve", "approved")
        val phrase = verb != "send" && (text.endsWith("do it") || text == "go ahead" || text.startsWith("go ahead"))
        val hasVerb = words.any { it in verbs } || phrase
        if (!hasVerb) return Kind.OTHER
        // Anything beyond the verb and filler ("send it to Bob instead") is a new instruction.
        val extra = words.filterNot { it in verbs || it in FILLER || it == "do" || it == "i" }
        return if (extra.isEmpty()) Kind.CONFIRM else Kind.OTHER
    }
}

/**
 * Holds at most one spoken approval offer. Single-threaded by contract (main dispatcher).
 * Every exit path clears the offer, so an approval can be consumed at most once.
 */
class VoiceApprovalGate(
    private val ttlAfterPromptMs: Long = 45_000L,
    private val ttlBeforePromptMs: Long = 120_000L,
    private val maxReprompts: Int = 2
) {
    data class Pending(
        val planId: String,
        val digest: String,
        val verb: String,
        val spoken: String,
        val summary: String,
        val sessionId: String,
        val offeredAtMs: Long,
        val promptCompletedAtMs: Long? = null,
        val reprompts: Int = 0
    )

    sealed class Decision {
        /** Not an approval conversation: hand the utterance to the normal chat turn. */
        object PassThrough : Decision()
        data class Approve(val planId: String, val digest: String, val utterance: String, val summary: String) : Decision()
        data class Cancel(val planId: String, val utterance: String) : Decision()
        data class Say(val text: String, val promptAgain: Boolean = false) : Decision()
    }

    var pending: Pending? = null
        private set

    fun offer(planId: String, digest: String, verb: String, spoken: String, summary: String, sessionId: String, nowMs: Long) {
        pending = Pending(planId, digest, verb, spoken, summary, sessionId, nowMs)
    }

    /** The disclosure finished playing in full (not stopped or interrupted). */
    fun promptCompleted(nowMs: Long) {
        pending = pending?.copy(promptCompletedAtMs = nowMs)
    }

    fun clear() { pending = null }

    /**
     * [currentPlanId]/[currentDigest] describe the plan waiting right now; a different plan or
     * a changed disclosure invalidates the offer. [sessionId] is the live call, or null.
     */
    fun handle(utterance: String, nowMs: Long, sessionId: String?, currentPlanId: String?, currentDigest: String?): Decision {
        val offer = pending ?: return Decision.PassThrough
        if (sessionId == null || sessionId != offer.sessionId) { clear(); return Decision.PassThrough }
        if (currentPlanId != offer.planId || currentDigest != offer.digest) {
            clear(); return Decision.Say("The proposal changed since I read it out, so I won't act on that. Check it on screen or ask me again.")
        }
        val completed = offer.promptCompletedAtMs
        val expired = if (completed != null) nowMs - completed > ttlAfterPromptMs else nowMs - offer.offeredAtMs > ttlBeforePromptMs
        if (expired) { clear(); return Decision.Say("That confirmation timed out, so nothing was ${if (offer.verb == "send") "sent" else "done"}. It's still waiting on screen, or ask me again.") }
        return when (VoiceConfirmationParser.classify(utterance, offer.verb)) {
            VoiceConfirmationParser.Kind.CONFIRM -> if (completed == null || nowMs <= completed) {
                // A confirmation that overlaps the disclosure could be Junction's own voice.
                pending = offer.copy(promptCompletedAtMs = null)
                Decision.Say("Let me read it through first. ${offer.spoken}", promptAgain = true)
            } else {
                clear(); Decision.Approve(offer.planId, offer.digest, utterance.trim().take(80), offer.summary)
            }
            VoiceConfirmationParser.Kind.CANCEL -> { clear(); Decision.Cancel(offer.planId, utterance.trim().take(80)) }
            VoiceConfirmationParser.Kind.BARE_YES -> if (offer.reprompts >= maxReprompts) {
                clear(); Decision.Say("I'll leave it on screen for you to approve.")
            } else {
                pending = offer.copy(reprompts = offer.reprompts + 1)
                Decision.Say(if (offer.verb == "send") "To send it, say “send it”. Or say “cancel”." else "To go ahead, say “confirm”. Or say “cancel”.")
            }
            // The owner moved on. The plan stays on screen; this utterance is a normal turn.
            VoiceConfirmationParser.Kind.OTHER -> { clear(); Decision.PassThrough }
        }
    }
}
