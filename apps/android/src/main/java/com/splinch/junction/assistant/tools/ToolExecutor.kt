package com.splinch.junction.assistant.tools

import android.content.Context
import android.content.Intent
import android.net.Uri
import com.splinch.junction.BuildConfig
import com.splinch.junction.assistant.memory.MemoryService
import com.splinch.junction.assistant.provider.ProviderRouter
import com.splinch.junction.assistant.trust.BlockReasons
import com.splinch.junction.data.preference.UserPrefsRepository
import com.splinch.junction.data.secret.KeyStorage
import com.splinch.junction.feature.feed.FeedRepository
import com.splinch.junction.feature.gmail.GmailCopilot
import com.splinch.junction.feature.notification.service.JunctionNotificationListenerService
import com.splinch.junction.feature.scheduler.Scheduler
import com.splinch.junction.feature.selfimprove.ContributionResult
import com.splinch.junction.feature.selfimprove.GitHubContributor
import com.splinch.junction.feature.selfimprove.GitHubPullRequestStore
import com.splinch.junction.feature.selfimprove.GitHubSourceContext
import com.splinch.junction.feature.selfimprove.MergeResult
import com.splinch.junction.feature.selfimprove.SourceChange
import com.splinch.junction.feature.update.UpdateChecker
import com.splinch.junction.feature.update.UpdateInfo
import com.splinch.junction.platform.accessibility.ActionResult
import com.splinch.junction.platform.accessibility.ElementSelector
import com.splinch.junction.platform.accessibility.JunctionAccessibilityService
import com.splinch.junction.platform.accessibility.ScrollDirection
import java.io.File
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import org.json.JSONArray
import org.json.JSONObject

data class ToolDependencies(
    val context: Context,
    val prefs: UserPrefsRepository,
    val feedRepository: FeedRepository,
    val updateState: MutableStateFlow<UpdateInfo?>,
    val providerRouter: ProviderRouter,
    val memoryService: MemoryService,
    val sessionId: () -> String,
    val speechModeEnabled: () -> Boolean,
    val setSpeechMode: suspend (Boolean) -> Unit
)

/** Executes the existing tool contract without owning planning or trust decisions. */
class ToolExecutor(private val dependencies: ToolDependencies) {
    private val appContext = dependencies.context.applicationContext
    private val prefs = dependencies.prefs
    private val feedRepository = dependencies.feedRepository
    private val providerRouter = dependencies.providerRouter
    private val memoryService = dependencies.memoryService
    private val githubSourceContext = GitHubSourceContext()

    suspend fun execute(call: PendingToolCall): ToolApplyResult {
        return when (call.name) {
        "ask_clarification" -> {
            val question = call.arguments.optString("question")
            if (question.isBlank()) return ToolApplyResult("", errorOutput("Missing clarification question"))
            val options = call.arguments.optJSONArray("options")
            val detail = buildString {
                append(question)
                if (options != null && options.length() > 0) {
                    append("\nOptions: ")
                    append((0 until options.length()).joinToString(", ") { options.optString(it) })
                }
            }
            ToolApplyResult(detail, successOutput("ask_clarification", detail))
        }
        "set_speech_mode" -> {
            val target = call.arguments.optString("conversationId")
            if (target.isNotBlank() && target != dependencies.sessionId()) {
                return ToolApplyResult("", errorOutput("Unknown conversation"))
            }
            val enabled = call.arguments.optBoolean("enabled", false)
            val previous = dependencies.speechModeEnabled()
            dependencies.setSpeechMode(enabled)
            ToolApplyResult(
                confirmation = "Speech mode ${if (enabled) "enabled" else "disabled"}.",
                toolOutput = successOutput("speech_mode", enabled.toString()),
                undo = UndoAction("Undo speech mode") {
                    dependencies.setSpeechMode(previous)
                    "Reverted speech mode."
                }
            )
        }
        "set_feed_filter" -> {
            val packageName = call.arguments.optString("packageName")
            if (packageName.isBlank()) return ToolApplyResult("", errorOutput("Missing packageName"))
            val enabled = call.arguments.optBoolean("enabled", true)
            val previous = prefs.isPackageEnabled(packageName)
            prefs.setPackageEnabled(packageName, enabled)
            ToolApplyResult(
                confirmation = "Feed filter updated for $packageName.",
                toolOutput = successOutput("set_feed_filter", "$packageName=$enabled"),
                undo = UndoAction("Undo feed filter") {
                    prefs.setPackageEnabled(packageName, previous)
                    "Reverted feed filter for $packageName."
                }
            )
        }
        "archive_feed_item" -> {
            val id = call.arguments.optString("id")
            if (id.isBlank()) return ToolApplyResult("", errorOutput("Missing id"))
            val previous = feedRepository.getEntityById(id)?.status
            feedRepository.archive(id)
            ToolApplyResult(
                confirmation = "Archived feed item $id.",
                toolOutput = successOutput("archive_feed_item", id),
                undo = UndoAction("Undo archive") {
                    if (previous != null) {
                        feedRepository.updateStatus(id, previous)
                        "Restored feed item $id."
                    } else {
                        "No prior state for $id."
                    }
                }
            )
        }
        "install_apk" -> installApk(call)
        "list_junction_source" -> listJunctionSource(call)
        "read_junction_source" -> readJunctionSource(call)
        "propose_code_change" -> proposeCodeChange(call)
        "check_github_change" -> checkGitHubChange(call)
        "merge_github_change" -> mergeGitHubChange(call)
        "check_for_updates" -> {
            val update = UpdateChecker().checkForUpdate(BuildConfig.JUNCTION_VERSION_CODE)
            dependencies.updateState.value = update
            prefs.updateLastUpdateCheckAt(System.currentTimeMillis())
            val message = if (update != null) {
                "Update available: ${update.version} (build ${update.versionCode}), " +
                    "up from build ${BuildConfig.JUNCTION_VERSION_CODE}."
            } else {
                "No updates available."
            }
            ToolApplyResult(message, successOutput("check_for_updates", message))
        }
        "set_setting" -> applySetting(call.arguments.optString("key"), call.arguments.opt("value"))
        "remember_fact" -> memoryService.remember(
            content = call.arguments.optString("content"),
            category = call.arguments.optString("category").ifBlank { "other" },
            sessionId = dependencies.sessionId()
        )
        "forget_fact" -> memoryService.forget(call.arguments.optString("id"))
        "open_app" -> openApp(call)
        "open_deeplink" -> openDeepLink(call)
        "launch_intent" -> launchIntent(call)
        "reply_notification" -> replyNotification(call)
        "dismiss_notification" -> dismissNotification(call)
        "gmail_triage_inbox" -> triageGmail(call)
        "gmail_unsubscribe" -> unsubscribeGmail(call)
        "gmail_draft_reply" -> draftGmailReply(call)
        "email_send" -> sendGmailDraft(call)
        "email_archive" -> archiveGmail(call)
        "read_screen" -> readScreen()
        "tap_element" -> tapElement(call)
        "set_text" -> setText(call)
        "scroll" -> scroll(call)
        "press_back" -> {
            val before = JunctionAccessibilityService.screenFingerprint()
            accessibilityToolResult("press_back", JunctionAccessibilityService.pressBack(), beforeFingerprint = before)
        }
        "press_home" -> {
            val before = JunctionAccessibilityService.screenFingerprint()
            accessibilityToolResult("press_home", JunctionAccessibilityService.pressHome(), beforeFingerprint = before)
        }
            else -> ToolApplyResult("", errorOutput("Unsupported tool: ${call.name}"))
        }
    }

    suspend fun validateEgress(toolName: String, args: JSONObject): String? {
        val uri = when (toolName) {
            "open_deeplink", "launch_intent" -> args.optString("uri").ifBlank { null }
            else -> null
        } ?: return null
        val parsed = runCatching { Uri.parse(uri) }.getOrNull()
            ?: return BlockReasons.EGRESS_DESTINATION_NOT_ALLOWED
        return if (isAllowedWebUri(parsed)) null else BlockReasons.EGRESS_DESTINATION_NOT_ALLOWED
    }

    fun errorOutput(message: String?): String = JSONObject()
        .put("status", "error")
        .put("message", message ?: "Unknown error")
        .toString()

    fun consumeGitHubSourceContext(): String? = githubSourceContext.consumeForPrompt()

    private suspend fun installApk(call: PendingToolCall): ToolApplyResult {
        val path = call.arguments.optString("path")
        if (path.isBlank()) return ToolApplyResult("", errorOutput("Missing path"))
        val ownerEnabled = prefs.shizukuEnabledFlow.first()
        return when (
            val result = com.splinch.junction.platform.shizuku.ShizukuInstaller(appContext)
                .install(File(path), ownerEnabled)
        ) {
            is com.splinch.junction.platform.shizuku.ShizukuInstallResult.Started -> ToolApplyResult(
                confirmation = "Install session started (session ${result.sessionId}). Approve the system install prompt if shown.",
                toolOutput = successOutput("install_apk", result.sessionId.toString())
            )
            is com.splinch.junction.platform.shizuku.ShizukuInstallResult.Failed ->
                ToolApplyResult("", errorOutput("${result.reason}: ${result.diagnostic}"))
        }
    }

    private fun contributor() = GitHubContributor(
        KeyStorage(appContext).getApiKey(GitHubContributor.TOKEN_ID)
    )

    private suspend fun listJunctionSource(call: PendingToolCall): ToolApplyResult =
        contributor().listSource(call.arguments.optString("prefix")).fold(
            onSuccess = { index ->
                githubSourceContext.rememberIndex(index)
                val message = "Referenced ${index.paths.size} Junction source paths for the next turn. Ask me to read the relevant files before I draft a change."
                ToolApplyResult(message, successOutput("list_junction_source", message))
            },
            onFailure = { ToolApplyResult("", errorOutput(it.message ?: "Could not list Junction source.")) }
        )

    private suspend fun readJunctionSource(call: PendingToolCall): ToolApplyResult =
        contributor().readSource(call.arguments.optString("path")).fold(
            onSuccess = { source ->
                githubSourceContext.rememberFile(source)
                val message = "Referenced ${source.path} from Junction GitHub for the next turn. I can now use it to prepare a bounded proposal."
                ToolApplyResult(message, successOutput("read_junction_source", message))
            },
            onFailure = { ToolApplyResult("", errorOutput(it.message ?: "Could not read Junction source.")) }
        )

    private suspend fun proposeCodeChange(call: PendingToolCall): ToolApplyResult {
        val changes = call.arguments.optJSONArray("changes")?.let { array ->
            buildList {
                for (index in 0 until array.length()) {
                    val change = array.optJSONObject(index) ?: continue
                    add(SourceChange(change.optString("path"), change.optString("content")))
                }
            }
        } ?: listOf(SourceChange(call.arguments.optString("path"), call.arguments.optString("content")))
        return when (
            val result = contributor().proposeChange(
                changes,
                call.arguments.optString("message"),
                call.arguments.optString("description")
            )
        ) {
            is ContributionResult.Opened -> {
                GitHubPullRequestStore(appContext).save(result)
                val message = "Opened pull request #${result.number} from ${result.branch}: ${result.url}"
                ToolApplyResult(message, successOutput("propose_code_change", message))
            }
            is ContributionResult.Failed -> ToolApplyResult("", errorOutput(result.reason))
        }
    }

    private suspend fun checkGitHubChange(call: PendingToolCall): ToolApplyResult =
        contributor().pullRequestStatus(call.arguments.optInt("pullRequest")).fold(
            onSuccess = { status ->
                val message = "PR #${status.number}: ${status.detail} ${status.url}"
                ToolApplyResult(message, successOutput("check_github_change", message))
            },
            onFailure = { ToolApplyResult("", errorOutput(it.message ?: "Could not check the pull request.")) }
        )

    private suspend fun mergeGitHubChange(call: PendingToolCall): ToolApplyResult =
        when (val result = contributor().mergePullRequest(call.arguments.optInt("pullRequest"))) {
            is MergeResult.Merged -> ToolApplyResult(result.message, successOutput("merge_github_change", result.message))
            is MergeResult.NotReady -> ToolApplyResult("", errorOutput(result.reason))
            is MergeResult.Failed -> ToolApplyResult("", errorOutput(result.reason))
        }

    private fun openApp(call: PendingToolCall): ToolApplyResult {
        val packageName = call.arguments.optString("packageName")
        if (packageName.isBlank()) return ToolApplyResult("", errorOutput("Missing packageName"))
        val launchIntent = appContext.packageManager.getLaunchIntentForPackage(packageName)
            ?: return ToolApplyResult("", errorOutput("App not found: $packageName"))
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        appContext.startActivity(launchIntent)
        return ToolApplyResult("Launched $packageName.", successOutput("open_app", packageName))
    }

    private suspend fun openDeepLink(call: PendingToolCall): ToolApplyResult {
        val uri = call.arguments.optString("uri")
        if (uri.isBlank()) return ToolApplyResult("", errorOutput("Missing uri"))
        val parsed = Uri.parse(uri)
        if (!isAllowedWebUri(parsed)) {
            return ToolApplyResult("", errorOutput("Blocked URI: only owner-allowed HTTPS domains may be opened"))
        }
        appContext.startActivity(Intent(Intent.ACTION_VIEW, parsed).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return ToolApplyResult("Opened: $uri", successOutput("open_deeplink", uri))
    }

    private suspend fun launchIntent(call: PendingToolCall): ToolApplyResult {
        val action = call.arguments.optString("action")
        if (action.isBlank()) return ToolApplyResult("", errorOutput("Missing action"))
        val uri = call.arguments.optString("uri").ifBlank { null }
        if (uri != null && !isAllowedWebUri(Uri.parse(uri))) {
            return ToolApplyResult("", errorOutput("Blocked URI: only owner-allowed HTTPS domains may be opened"))
        }
        val intent = if (uri != null) Intent(action, Uri.parse(uri)) else Intent(action)
        call.arguments.optJSONObject("extras")?.let { extras ->
            val keys = extras.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                intent.putExtra(key, extras.optString(key))
            }
        }
        appContext.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return ToolApplyResult("Launched intent $action.", successOutput("launch_intent", action))
    }

    private fun replyNotification(call: PendingToolCall): ToolApplyResult {
        val key = call.arguments.optString("notificationKey")
        val text = call.arguments.optString("text")
        if (key.isBlank() || text.isBlank()) {
            return ToolApplyResult("", errorOutput("Missing notificationKey or text"))
        }
        return if (JunctionNotificationListenerService.replyToNotification(key, text)) {
            ToolApplyResult("Replied to notification.", successOutput("reply_notification", key))
        } else {
            ToolApplyResult("", errorOutput("Notification not found or reply not supported: $key"))
        }
    }

    private fun dismissNotification(call: PendingToolCall): ToolApplyResult {
        val key = call.arguments.optString("notificationKey")
        if (key.isBlank()) return ToolApplyResult("", errorOutput("Missing notificationKey"))
        val ok = JunctionNotificationListenerService.dismissNotification(key)
        return ToolApplyResult(
            if (ok) "Dismissed notification." else "Notification not found.",
            successOutput("dismiss_notification", if (ok) "dismissed" else "not_found")
        )
    }

    private suspend fun triageGmail(call: PendingToolCall): ToolApplyResult {
        val email = prefs.gmailAccountEmailFlow.first()
        if (email.isBlank()) {
            return ToolApplyResult("", errorOutput("Gmail account not configured. Set it in Settings first."))
        }
        val provider = providerRouter.activeProvider()
            ?: return ToolApplyResult("", errorOutput("No AI provider configured for safe Gmail reading"))
        val maxResults = call.arguments.optInt("maxResults", 20).coerceIn(1, 50).toLong()
        return runCatching { GmailCopilot(appContext, email).triageForReader(maxResults) }.fold(
            onSuccess = { emails ->
                val items = JSONArray()
                emails.forEach { emailForReader ->
                    val item = emailForReader.summary
                    val reader = provider.readUntrusted(emailForReader.rawContent, "email:${item.id}")
                        ?: return@forEach
                    items.put(
                        JSONObject()
                            .put("id", item.id)
                            .put("threadId", item.threadId)
                            .put("subject", item.subject)
                            .put("from", item.from)
                            .put("category", item.category.name)
                            .put("unsubscribable", item.hasListUnsubscribe)
                            .put("reader", readerOutputJson(reader))
                    )
                }
                ToolApplyResult(
                    "Safely triaged ${items.length()} inbox message(s).",
                    JSONObject().put("status", "applied").put("action", "gmail_triage_inbox")
                        .put("items", items).toString()
                )
            },
            onFailure = { ToolApplyResult("", errorOutput(it.message)) }
        )
    }

    private suspend fun unsubscribeGmail(call: PendingToolCall): ToolApplyResult {
        val email = prefs.gmailAccountEmailFlow.first()
        if (email.isBlank()) {
            return ToolApplyResult("", errorOutput("Gmail account not configured. Set it in Settings first."))
        }
        val messageId = call.arguments.optString("messageId")
        if (messageId.isBlank()) return ToolApplyResult("", errorOutput("Missing messageId"))
        return runCatching { GmailCopilot(appContext, email).unsubscribe(messageId) }.fold(
            onSuccess = { ok ->
                if (ok) ToolApplyResult("Unsubscribe request sent.", successOutput("gmail_unsubscribe", messageId))
                else ToolApplyResult("", errorOutput("Unsubscribe attempt did not succeed for $messageId"))
            },
            onFailure = { ToolApplyResult("", errorOutput(it.message)) }
        )
    }

    private suspend fun draftGmailReply(call: PendingToolCall): ToolApplyResult {
        val email = prefs.gmailAccountEmailFlow.first()
        val threadId = call.arguments.optString("threadId")
        val body = call.arguments.optString("body")
        if (email.isBlank() || threadId.isBlank() || body.isBlank()) {
            return ToolApplyResult("", errorOutput("Gmail account, threadId, and body are required"))
        }
        val draft = GmailCopilot(appContext, email).draftReply(threadId, body)
            ?: return ToolApplyResult("", errorOutput("Unable to create a reply draft for that thread"))
        return ToolApplyResult(
            "Drafted a reply to ${draft.recipient}. Review it before sending.",
            JSONObject().put("status", "applied").put("action", "gmail_draft_reply")
                .put("draftId", draft.draftId).put("recipient", draft.recipient).toString()
        )
    }

    private suspend fun sendGmailDraft(call: PendingToolCall): ToolApplyResult {
        val email = prefs.gmailAccountEmailFlow.first()
        val draftId = call.arguments.optString("draftId")
        if (email.isBlank() || draftId.isBlank()) {
            return ToolApplyResult("", errorOutput("Gmail account and draftId are required"))
        }
        return if (GmailCopilot(appContext, email).sendDraft(draftId)) {
            ToolApplyResult("Gmail confirmed the draft was sent.", successOutput("email_send", draftId))
        } else {
            ToolApplyResult("", errorOutput("Gmail could not confirm that draft was sent"))
        }
    }

    private suspend fun archiveGmail(call: PendingToolCall): ToolApplyResult {
        val email = prefs.gmailAccountEmailFlow.first()
        val messageId = call.arguments.optString("messageId")
        if (email.isBlank() || messageId.isBlank()) {
            return ToolApplyResult("", errorOutput("Gmail account and messageId are required"))
        }
        return if (GmailCopilot(appContext, email).archiveMessage(messageId)) {
            ToolApplyResult("Archived Gmail message.", successOutput("email_archive", messageId))
        } else {
            ToolApplyResult("", errorOutput("Gmail could not archive that message"))
        }
    }

    private suspend fun readScreen(): ToolApplyResult {
        if (!JunctionAccessibilityService.isConnected()) {
            return ToolApplyResult(
                "",
                errorOutput("Junction's accessibility service isn't enabled. Enable \"Junction\" under Settings > Accessibility.")
            )
        }
        val snapshot = JunctionAccessibilityService.readScreenSafely()
        if (snapshot.secure) {
            return ToolApplyResult(
                "This screen can't be read — it's a secure window (e.g. a banking or password screen).",
                JSONObject().put("status", "applied").put("action", "read_screen")
                    .put("secure", true).put("elements", JSONArray()).toString()
            )
        }
        val elements = JSONArray()
        snapshot.elements.forEach { element ->
            elements.put(
                JSONObject().put("index", element.index).put("className", element.className)
                    .put("text", element.text).put("contentDescription", element.contentDescription)
                    .put("resourceId", element.resourceId).put("bounds", element.bounds)
                    .put("clickable", element.clickable).put("scrollable", element.scrollable)
                    .put("editable", element.editable)
            )
        }
        val fidelityNote = if (snapshot.lowFidelity) " ${snapshot.lowFidelityReason}" else ""
        return ToolApplyResult(
            "Read ${snapshot.elements.size} element(s) from the current screen.$fidelityNote",
            JSONObject().put("status", "applied").put("action", "read_screen")
                .put("packageName", snapshot.packageName).put("lowFidelity", snapshot.lowFidelity)
                .apply { snapshot.lowFidelityReason?.let { put("lowFidelityReason", it) } }
                .put("elements", elements).toString()
        )
    }

    private suspend fun tapElement(call: PendingToolCall): ToolApplyResult {
        val selector = selectorFrom(call.arguments)
        if (selector.isEmpty()) {
            return ToolApplyResult("", errorOutput("Provide at least one of resourceId, text, contentDescription, or index"))
        }
        val before = JunctionAccessibilityService.screenFingerprint()
        return accessibilityToolResult(
            "tap_element",
            JunctionAccessibilityService.tapElement(selector),
            beforeFingerprint = before,
            expectedText = call.arguments.optString("expectedText")
        )
    }

    private suspend fun setText(call: PendingToolCall): ToolApplyResult {
        val selector = selectorFrom(call.arguments)
        if (selector.isEmpty()) {
            return ToolApplyResult("", errorOutput("Provide at least one of resourceId, text, contentDescription, or index"))
        }
        val value = call.arguments.optString("value")
        return accessibilityToolResult(
            "set_text",
            JunctionAccessibilityService.setText(selector, value),
            selector = selector,
            expectedFieldText = value
        )
    }

    private suspend fun scroll(call: PendingToolCall): ToolApplyResult {
        val direction = when (call.arguments.optString("direction").lowercase()) {
            "up" -> ScrollDirection.UP
            "down" -> ScrollDirection.DOWN
            "left" -> ScrollDirection.LEFT
            "right" -> ScrollDirection.RIGHT
            else -> return ToolApplyResult("", errorOutput("Invalid direction: ${call.arguments.optString("direction")}"))
        }
        val selector = selectorFrom(call.arguments)
        val before = JunctionAccessibilityService.screenFingerprint()
        return accessibilityToolResult(
            "scroll",
            JunctionAccessibilityService.scroll(direction, selector.takeUnless { it.isEmpty() }),
            beforeFingerprint = before
        )
    }

    private fun selectorFrom(args: JSONObject) = ElementSelector(
        resourceId = args.optString("resourceId").ifBlank { null },
        text = args.optString("text").ifBlank { null },
        contentDescription = args.optString("contentDescription").ifBlank { null },
        index = if (args.has("index")) args.optInt("index") else null
    )

    private fun readerOutputJson(reader: com.splinch.junction.assistant.context.ReaderOutput): JSONObject =
        JSONObject()
            .put("summary", reader.summary)
            .put("entities", JSONArray().apply {
                reader.entities.forEach { entity ->
                    put(JSONObject().put("type", entity.type).put("value", entity.value))
                }
            })
            .put("contentRequests", JSONArray().apply { reader.contentRequests.forEach(::put) })
            .put("salience", reader.salience)

    private suspend fun isAllowedWebUri(uri: Uri): Boolean {
        if (uri.scheme?.lowercase() != "https") return false
        val host = uri.host?.lowercase()?.trimEnd('.') ?: return false
        return prefs.allowedWebDomainsFlow.first().any { domain ->
            host == domain || host.endsWith(".$domain")
        }
    }

    private suspend fun accessibilityToolResult(
        action: String,
        result: ActionResult,
        beforeFingerprint: String? = null,
        expectedText: String? = null,
        selector: ElementSelector? = null,
        expectedFieldText: String? = null
    ): ToolApplyResult {
        if (!result.ok) return ToolApplyResult("", errorOutput(result.message))
        delay(250)
        val verified = when {
            selector != null && expectedFieldText != null ->
                JunctionAccessibilityService.selectorHasText(selector, expectedFieldText)
            !expectedText.isNullOrBlank() -> JunctionAccessibilityService.screenContains(expectedText)
            beforeFingerprint != null -> JunctionAccessibilityService.screenFingerprint() != beforeFingerprint
            else -> false
        }
        if (!verified) {
            return ToolApplyResult(
                "",
                errorOutput("$action was accepted but its post-condition did not verify on the current screen")
            )
        }
        val detail = "${result.message} Post-condition verified."
        return ToolApplyResult(detail, successOutput(action, detail))
    }

    private suspend fun applySetting(key: String, value: Any?): ToolApplyResult = when (key) {
        "digest_interval_minutes" -> {
            val previous = prefs.digestIntervalMinutesFlow.first()
            val safe = (value.toString().toIntOrNull() ?: previous).coerceAtLeast(15)
            prefs.setDigestIntervalMinutes(safe)
            Scheduler.configureFeedDigest(appContext, prefs.digestEnabledFlow.first(), safe.toLong())
            ToolApplyResult(
                "Digest interval set to $safe minutes.",
                successOutput(key, safe.toString()),
                UndoAction("Undo digest interval") {
                    prefs.setDigestIntervalMinutes(previous)
                    Scheduler.configureFeedDigest(appContext, prefs.digestEnabledFlow.first(), previous.toLong())
                    "Reverted digest interval to $previous minutes."
                }
            )
        }
        "realtime_endpoint" -> {
            val previous = prefs.realtimeEndpointFlow.first()
            val url = value?.toString()?.trim().orEmpty()
            prefs.setRealtimeEndpoint(url)
            ToolApplyResult(
                "Realtime endpoint updated.",
                successOutput(key, url),
                UndoAction("Undo realtime endpoint") {
                    prefs.setRealtimeEndpoint(previous)
                    "Reverted realtime endpoint."
                }
            )
        }
        else -> ToolApplyResult("", errorOutput("Unsupported setting: $key"))
    }

    private fun successOutput(action: String, detail: String): String = JSONObject()
        .put("status", "applied")
        .put("action", action)
        .put("detail", detail)
        .toString()
}
