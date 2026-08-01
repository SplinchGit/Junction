package com.splinch.junction.assistant.tools

import com.splinch.junction.assistant.context.*
import com.splinch.junction.assistant.conversation.*
import com.splinch.junction.assistant.planning.*
import com.splinch.junction.assistant.provider.*
import com.splinch.junction.assistant.runtime.*
import com.splinch.junction.assistant.tools.*
import com.splinch.junction.assistant.trust.*

/**
 * Client-side risk classification for every tool.
 * NEVER set by the model — only by ToolRegistry declarations.
 *
 * READ       — read-only, no state change (e.g. read_screen, check_for_updates)
 * INAPP      — modifies local app state (e.g. set_speech_mode, set_feed_filter, archive_feed_item)
 * OUTBOUND   — sends data outside the device (e.g. reply_notification, email_draft_reply)
 * DESTRUCTIVE — irreversible or high-impact (e.g. email_send, install_apk, set_setting for system)
 */
enum class RiskTier {
    READ,
    INAPP,
    OUTBOUND,
    DESTRUCTIVE;

    /** Elevate one level (used during tainted sessions). */
    fun escalated(): RiskTier = when (this) {
        READ -> INAPP
        INAPP -> OUTBOUND
        OUTBOUND -> DESTRUCTIVE
        DESTRUCTIVE -> DESTRUCTIVE
    }
}

/** Tools in these tiers send data outside the device. */
val RiskTier.isEgress: Boolean get() = this == RiskTier.OUTBOUND || this == RiskTier.DESTRUCTIVE

/** Tools that cause state changes (used for trigger-provenance enforcement). */
val RiskTier.isStateChanging: Boolean get() = this != RiskTier.READ
