package com.splinch.junction.assistant.tools

import com.splinch.junction.assistant.context.*
import com.splinch.junction.assistant.conversation.*
import com.splinch.junction.assistant.planning.*
import com.splinch.junction.assistant.provider.*
import com.splinch.junction.assistant.runtime.*
import com.splinch.junction.assistant.tools.*
import com.splinch.junction.assistant.trust.*

import com.splinch.junction.assistant.tools.ToolDefinition
import org.json.JSONObject

data class RegisteredTool(
    val name: String,
    val description: String,
    val parametersJson: String,
    val riskTier: RiskTier,
    val isEgressTool: Boolean = riskTier.isEgress,
    val summarize: (args: JSONObject) -> String,
    /**
     * §2.2 post-condition assertion. Given the tool's args and a verifier
     * with access to app state, returns whether the step actually worked —
     * independent of whatever the tool's own apply() call reported.
     * Defaults to an honestly-labelled "trusted" outcome for tools with no
     * independently observable state (see PostConditionOutcome.trusted).
     */
    val verifyPostCondition: suspend (args: JSONObject, verifier: PostConditionVerifier) -> PostConditionOutcome =
        { _, _ -> PostConditionOutcome.trusted("Tool reported success") }
) {
    fun toToolDefinition() = ToolDefinition(name, description, parametersJson)
}

object ToolRegistry {

    private val tools = mutableMapOf<String, RegisteredTool>()

    init {
        register(
            RegisteredTool(
                name = "set_speech_mode",
                description = "Enable or disable speech (voice) mode for the current conversation.",
                parametersJson = """{"type":"object","properties":{"enabled":{"type":"boolean","description":"Whether to enable speech mode"},"conversationId":{"type":"string","description":"The conversation ID (optional)"}},"required":["enabled"]}""",
                riskTier = RiskTier.INAPP,
                summarize = { args -> "Set speech mode to ${args.optBoolean("enabled", false)}" }
            )
        )

        register(
            RegisteredTool(
                name = "set_feed_filter",
                description = "Enable or disable a specific app's notifications in the Junction feed.",
                parametersJson = """{"type":"object","properties":{"packageName":{"type":"string","description":"The Android package name of the app"},"enabled":{"type":"boolean","description":"Whether to show notifications from this app"}},"required":["packageName","enabled"]}""",
                riskTier = RiskTier.INAPP,
                summarize = { args -> "Set feed filter ${args.optString("packageName")} = ${args.optBoolean("enabled", true)}" },
                verifyPostCondition = { args, verifier ->
                    verifier.packageEnabledIs(args.optString("packageName"), args.optBoolean("enabled", true))
                }
            )
        )

        register(
            RegisteredTool(
                name = "archive_feed_item",
                description = "Archive a feed item so it no longer appears in the main feed.",
                parametersJson = """{"type":"object","properties":{"id":{"type":"string","description":"The feed item ID to archive"}},"required":["id"]}""",
                riskTier = RiskTier.INAPP,
                summarize = { args -> "Archive feed item ${args.optString("id")}" },
                verifyPostCondition = { args, verifier ->
                    verifier.feedItemHasStatus(args.optString("id"), com.splinch.junction.feature.feed.model.FeedStatus.ARCHIVED)
                }
            )
        )

        register(
            RegisteredTool(
                name = "check_for_updates",
                description = "Check whether a newer version of Junction is available.",
                parametersJson = """{"type":"object","properties":{},"required":[]}""",
                riskTier = RiskTier.READ,
                summarize = { _ -> "Check for updates" }
            )
        )

        register(
            RegisteredTool(
                name = "set_setting",
                description = "Update a Junction setting by key. Only two keys are supported: " +
                    "digest_interval_minutes (integer, minimum 15) and realtime_endpoint (URL string). " +
                    "Any other key is rejected — for speech mode use set_speech_mode, and for per-app " +
                    "notification filtering use set_feed_filter.",
                // Enumerated rather than left open-ended: applySetting() only
                // handles these two keys, and an open "e.g." description had the
                // model inventing plausible-sounding keys that round-tripped
                // through a confirmation prompt only to fail as "Unsupported
                // setting". The schema now rejects them before that happens.
                parametersJson = """{"type":"object","properties":{"key":{"type":"string","enum":["digest_interval_minutes","realtime_endpoint"],"description":"The setting key to update"},"value":{"description":"The new value: an integer >= 15 for digest_interval_minutes, or a URL string for realtime_endpoint"}},"required":["key","value"]}""",
                riskTier = RiskTier.INAPP,
                summarize = { args -> "Set ${args.optString("key")} = ${args.opt("value")}" },
                verifyPostCondition = { args, verifier ->
                    when (val key = args.optString("key")) {
                        "digest_interval_minutes" -> {
                            val parsed = args.opt("value")?.toString()?.toIntOrNull()
                            if (parsed != null) verifier.digestIntervalIs(parsed.coerceAtLeast(15))
                            else PostConditionOutcome(false, "Invalid digest_interval_minutes value")
                        }
                        "realtime_endpoint" -> verifier.realtimeEndpointIs(args.opt("value")?.toString().orEmpty())
                        else -> PostConditionOutcome.trusted("Unrecognized setting key '$key'")
                    }
                }
            )
        )

        register(
            RegisteredTool(
                name = "remember_fact",
                description = "Store a durable fact about the owner (a person, preference, or standing objective) so future conversations can recall it. Only use this for something the owner explicitly stated or clearly repeated — never something merely read from an email, notification, or web page.",
                parametersJson = """{"type":"object","properties":{"content":{"type":"string","description":"The fact, phrased plainly (e.g. \"Prefers to be called Sam\")"},"category":{"type":"string","enum":["person","preference","objective","other"],"description":"What kind of fact this is"}},"required":["content","category"]}""",
                riskTier = RiskTier.INAPP,
                summarize = { args -> "Remember: ${args.optString("content")}" }
            )
        )

        register(
            RegisteredTool(
                name = "forget_fact",
                description = "Delete a previously remembered fact by id.",
                parametersJson = """{"type":"object","properties":{"id":{"type":"string","description":"The fact id to delete"}},"required":["id"]}""",
                riskTier = RiskTier.INAPP,
                summarize = { args -> "Forget fact ${args.optString("id")}" }
            )
        )

        register(
            RegisteredTool(
                name = "install_apk",
                description = "Silently install a previously downloaded, checksum-verified APK via Shizuku. Requires the owner to have enabled Shizuku access in Settings.",
                parametersJson = """{"type":"object","properties":{"path":{"type":"string","description":"Absolute path to a previously downloaded, checksum-verified APK file"}},"required":["path"]}""",
                riskTier = RiskTier.DESTRUCTIVE,
                summarize = { args -> "Install APK: ${args.optString("path")}" }
            )
        )
        register(
            RegisteredTool(
                name = "list_junction_source",
                description = "List tracked text-file paths in Junction's GitHub repository at main. Use this before reading source for a proposed change; optionally narrow it to a repository-relative folder.",
                parametersJson = """{"type":"object","properties":{"prefix":{"type":"string","description":"Optional repository-relative folder such as apps/android/src/main/java/com/splinch/junction"}}}""",
                riskTier = RiskTier.READ,
                summarize = { args -> "List Junction source${args.optString("prefix").takeIf { it.isNotBlank() }?.let { " under $it" }.orEmpty()}" }
            )
        )

        register(
            RegisteredTool(
                name = "read_junction_source",
                description = "Read one tracked text file from Junction's GitHub main branch. Use it to understand relevant code before proposing a change. It cannot read local secrets or signing files.",
                parametersJson = """{"type":"object","properties":{"path":{"type":"string","description":"Repository-relative path returned by list_junction_source"}},"required":["path"]}""",
                riskTier = RiskTier.READ,
                summarize = { args -> "Read Junction source: ${args.optString("path")}" }
            )
        )

        register(
            RegisteredTool(
                name = "propose_code_change",
                description = "Create a reviewable pull request containing up to 12 coordinated Junction source-file replacements. " +
                    "Never use this until the owner has agreed the plan. It cannot target main, change workflows or secrets, or merge.",
                parametersJson = """{"type":"object","properties":{"changes":{"type":"array","minItems":1,"maxItems":12,"items":{"type":"object","properties":{"path":{"type":"string","description":"Repository-relative source path"},"content":{"type":"string","description":"Complete replacement contents"}},"required":["path","content"]}},"message":{"type":"string","description":"Commit and PR title"},"description":{"type":"string","description":"PR body with rationale, behaviour and test plan"}},"required":["changes","message","description"]}""",
                riskTier = RiskTier.DESTRUCTIVE,
                summarize = { args ->
                    val changes = args.optJSONArray("changes")
                    "Open a Junction pull request changing ${changes?.length() ?: 0} file(s): ${args.optString("message")}"
                }
            )
        )

        register(
            RegisteredTool(
                name = "check_github_change",
                description = "Read the state and CI check status of a Junction pull request. Does not change GitHub.",
                parametersJson = """{"type":"object","properties":{"pullRequest":{"type":"integer","minimum":1}},"required":["pullRequest"]}""",
                riskTier = RiskTier.READ,
                summarize = { args -> "Check Junction pull request #${args.optInt("pullRequest")}" }
            )
        )

        register(
            RegisteredTool(
                name = "merge_github_change",
                description = "Squash-merge a Junction pull request only after GitHub reports it mergeable and every reported check has passed.",
                parametersJson = """{"type":"object","properties":{"pullRequest":{"type":"integer","minimum":1}},"required":["pullRequest"]}""",
                riskTier = RiskTier.DESTRUCTIVE,
                summarize = { args -> "Merge verified Junction pull request #${args.optInt("pullRequest")}" }
            )
        )

        register(
            RegisteredTool(
                name = "ask_clarification",
                description = "Ask the user a clarifying question when the intent is ambiguous.",
                parametersJson = """{"type":"object","properties":{"question":{"type":"string","description":"The clarifying question to ask"},"options":{"type":"array","items":{"type":"string"},"description":"Optional list of choices"}},"required":["question"]}""",
                riskTier = RiskTier.READ,
                summarize = { args -> "Ask: ${args.optString("question")}" }
            )
        )

        register(
            RegisteredTool(
                name = "reply_notification",
                description = "Reply to a notification with a text message. Only the originating notification key may be replied to.",
                parametersJson = """{"type":"object","properties":{"notificationKey":{"type":"string","description":"The notification key (from the feed item's threadKey)"},"text":{"type":"string","description":"The reply text"}},"required":["notificationKey","text"]}""",
                riskTier = RiskTier.OUTBOUND,
                summarize = { args -> "Reply to ${args.optString("notificationKey")}: ${args.optString("text").take(40)}" },
                verifyPostCondition = { args, verifier ->
                    // Heuristic (documented): most messaging apps auto-dismiss the
                    // notification once a RemoteInput reply is delivered. Absence is
                    // treated as success; presence is reported, not silently ignored.
                    val outcome = verifier.notificationIsAbsent(args.optString("notificationKey"))
                    if (outcome.passed) outcome
                    else PostConditionOutcome(
                        true,
                        "Reply was sent to the app, but the notification is still present — the " +
                            "originating app may not auto-dismiss on reply. Verify in the app if unsure."
                    )
                }
            )
        )

        register(
            RegisteredTool(
                name = "dismiss_notification",
                description = "Dismiss a notification by its key.",
                parametersJson = """{"type":"object","properties":{"notificationKey":{"type":"string","description":"The notification key to dismiss"}},"required":["notificationKey"]}""",
                riskTier = RiskTier.INAPP,
                summarize = { args -> "Dismiss notification ${args.optString("notificationKey")}" },
                verifyPostCondition = { args, verifier ->
                    verifier.notificationIsAbsent(args.optString("notificationKey"))
                }
            )
        )

        register(
            RegisteredTool(
                name = "open_app",
                description = "Launch an installed app by its package name.",
                parametersJson = """{"type":"object","properties":{"packageName":{"type":"string","description":"The Android package name of the app to launch"}},"required":["packageName"]}""",
                riskTier = RiskTier.INAPP,
                summarize = { args -> "Open app ${args.optString("packageName")}" },
                verifyPostCondition = { args, verifier ->
                    verifier.foregroundPackageIs(args.optString("packageName"))
                }
            )
        )

        register(
            RegisteredTool(
                name = "open_deeplink",
                description = "Open a URI deep link (e.g. https://, app-specific scheme).",
                parametersJson = """{"type":"object","properties":{"uri":{"type":"string","description":"The URI to open"}},"required":["uri"]}""",
                riskTier = RiskTier.INAPP,
                // §1.7: this tier is INAPP (not OUTBOUND) but the tool still
                // sends the device somewhere external, so egress class is set
                // explicitly rather than inherited from tier — otherwise
                // TrustGate's centralized egress-destination check (§1.7/§4,
                // TrustGate.kt Rule 2) would never run for it.
                isEgressTool = true,
                // §2A.2/§1.7: never truncate — the owner must see the full,
                // untruncated destination before approving an egress action.
                summarize = { args -> "Open deep link: ${args.optString("uri")}" }
            )
        )

        register(
            RegisteredTool(
                name = "launch_intent",
                description = "Launch an Android intent with a given action and optional extras.",
                parametersJson = """{"type":"object","properties":{"action":{"type":"string","description":"The intent action (e.g. android.intent.action.VIEW)"},"uri":{"type":"string","description":"Optional URI for the intent"},"extras":{"type":"object","description":"Optional key-value string extras"}},"required":["action"]}""",
                riskTier = RiskTier.INAPP,
                // §1.7: can carry an external URI even though the tier is INAPP — see open_deeplink.
                isEgressTool = true,
                summarize = { args ->
                    val uri = args.optString("uri")
                    if (uri.isNotBlank()) {
                        "Launch intent ${args.optString("action")} -> $uri"
                    } else {
                        "Launch intent ${args.optString("action")}"
                    }
                }
            )
        )

        register(
            RegisteredTool(
                name = "gmail_triage_inbox",
                description = "List and categorize recent inbox emails using Gmail's own Primary/Social/Promotions/Updates/Forums labels, flagging which ones support one-click unsubscribe. Requires a Gmail account configured in Settings.",
                parametersJson = """{"type":"object","properties":{"maxResults":{"type":"integer","description":"Max number of messages to return (default 20, max 50)"}},"required":[]}""",
                riskTier = RiskTier.READ,
                summarize = { args -> "Triage inbox (max ${args.optInt("maxResults", 20)})" }
            )
        )

        register(
            RegisteredTool(
                name = "gmail_draft_reply",
                description = "Create a Gmail reply draft in an existing thread. The recipient is resolved only from that thread; do not provide a recipient address.",
                parametersJson = """{"type":"object","properties":{"threadId":{"type":"string","description":"Existing Gmail thread ID"},"body":{"type":"string","description":"Reply body drafted for the owner"}},"required":["threadId","body"]}""",
                riskTier = RiskTier.INAPP,
                summarize = { args -> "Draft reply in Gmail thread ${args.optString("threadId")}" }
            )
        )

        register(
            RegisteredTool(
                name = "email_send",
                description = "Send a previously created Gmail draft by ID. This is outbound and always requires confirmation.",
                parametersJson = """{"type":"object","properties":{"draftId":{"type":"string","description":"Gmail draft ID created by gmail_draft_reply"}},"required":["draftId"]}""",
                riskTier = RiskTier.OUTBOUND,
                summarize = { args -> "Send Gmail draft ${args.optString("draftId")}" }
            )
        )

        register(
            RegisteredTool(
                name = "email_archive",
                description = "Archive a Gmail message by ID.",
                parametersJson = """{"type":"object","properties":{"messageId":{"type":"string","description":"Gmail message ID"}},"required":["messageId"]}""",
                riskTier = RiskTier.INAPP,
                summarize = { args -> "Archive Gmail message ${args.optString("messageId")}" }
            )
        )

        register(
            RegisteredTool(
                name = "gmail_unsubscribe",
                description = "Unsubscribe from a mailing list using the email's List-Unsubscribe header (one-click HTTP request or unsubscribe email). Requires a Gmail account configured in Settings.",
                parametersJson = """{"type":"object","properties":{"messageId":{"type":"string","description":"The Gmail message ID to unsubscribe from"}},"required":["messageId"]}""",
                riskTier = RiskTier.OUTBOUND,
                summarize = { args -> "Unsubscribe from message ${args.optString("messageId")}" }
            )
        )

        register(
            RegisteredTool(
                name = "read_screen",
                description = "Read a structured snapshot of the currently foregrounded screen: a flattened list of interactive/labelled elements with resource-id, text, content-description, and bounds. Requires the Junction accessibility service to be enabled. Use this before tap_element/set_text to find the right selector.",
                parametersJson = """{"type":"object","properties":{},"required":[]}""",
                riskTier = RiskTier.READ,
                summarize = { _ -> "Read screen" }
            )
        )

        register(
            RegisteredTool(
                name = "tap_element",
                description = "Tap a UI element on the current screen. Selectors are checked in order of reliability: resourceId, then text, then contentDescription, then index (from the most recent read_screen call). Provide exactly one.",
                parametersJson = """{"type":"object","properties":{"resourceId":{"type":"string","description":"Android resource-id of the target element"},"text":{"type":"string","description":"Visible text of the target element"},"contentDescription":{"type":"string","description":"Accessibility content description of the target element"},"index":{"type":"integer","description":"Index from the most recent read_screen call (least reliable; screen must not have changed since)"},"expectedText":{"type":"string","description":"Optional text, content description, or resource-id that must appear after the tap"}},"required":[]}""",
                riskTier = RiskTier.INAPP,
                summarize = { args -> "Tap element: ${describeSelector(args)}" }
            )
        )

        register(
            RegisteredTool(
                name = "set_text",
                description = "Set the text of an editable field on the current screen, identified the same way as tap_element (resourceId/text/contentDescription/index).",
                parametersJson = """{"type":"object","properties":{"resourceId":{"type":"string"},"text":{"type":"string","description":"Current visible text of the target element (to locate it, not the value to set)"},"contentDescription":{"type":"string"},"index":{"type":"integer"},"value":{"type":"string","description":"The text to set into the field"}},"required":["value"]}""",
                riskTier = RiskTier.INAPP,
                summarize = { args -> "Set text on ${describeSelector(args)} = \"${args.optString("value").take(40)}\"" }
            )
        )

        register(
            RegisteredTool(
                name = "scroll",
                description = "Scroll the current screen (or a specific scrollable element) in a direction.",
                parametersJson = """{"type":"object","properties":{"direction":{"type":"string","enum":["up","down","left","right"]},"resourceId":{"type":"string"},"text":{"type":"string"},"contentDescription":{"type":"string"},"index":{"type":"integer"}},"required":["direction"]}""",
                riskTier = RiskTier.INAPP,
                summarize = { args -> "Scroll ${args.optString("direction")}" }
            )
        )

        register(
            RegisteredTool(
                name = "press_back",
                description = "Press the system back button.",
                parametersJson = """{"type":"object","properties":{},"required":[]}""",
                riskTier = RiskTier.INAPP,
                summarize = { _ -> "Press back" }
            )
        )

        register(
            RegisteredTool(
                name = "press_home",
                description = "Press the system home button.",
                parametersJson = """{"type":"object","properties":{},"required":[]}""",
                riskTier = RiskTier.INAPP,
                summarize = { _ -> "Press home" }
            )
        )
    }

    private fun describeSelector(args: JSONObject): String {
        return when {
            args.has("resourceId") && args.optString("resourceId").isNotBlank() -> "resourceId=${args.optString("resourceId")}"
            args.has("text") && args.optString("text").isNotBlank() -> "text=\"${args.optString("text")}\""
            args.has("contentDescription") && args.optString("contentDescription").isNotBlank() -> "desc=\"${args.optString("contentDescription")}\""
            args.has("index") -> "index=${args.optInt("index")}"
            else -> "(no selector)"
        }
    }

    private fun register(tool: RegisteredTool) {
        tools[tool.name] = tool
    }

    fun get(name: String): RegisteredTool? = tools[name]

    fun all(): List<RegisteredTool> = tools.values.toList()

    fun allDefinitions(): List<ToolDefinition> = tools.values.map { it.toToolDefinition() }

    fun summarize(name: String, args: JSONObject): String {
        return tools[name]?.summarize?.invoke(args) ?: name
    }
}
