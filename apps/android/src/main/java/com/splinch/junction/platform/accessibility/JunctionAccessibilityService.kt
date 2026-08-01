package com.splinch.junction.platform.accessibility

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Context
import android.content.Intent
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.Display
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.splinch.junction.app.MainActivity
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/**
 * §Phase 2B on-device UI automation.
 *
 * Exposes a structured, flattened snapshot of the current screen (via
 * [readScreen]) and a small set of interaction primitives (tap/setText/scroll/
 * pressBack/pressHome) built on Android's AccessibilityNodeInfo API rather
 * than raw coordinates, so actions target elements by identity (resource-id,
 * text, content-description) instead of pixel position wherever possible.
 *
 * Selector tiering (most to least reliable):
 *   1. resourceId            — stable across re-layouts, may be absent on custom views
 *   2. text                  — visible label, can be localized/dynamic
 *   3. contentDescription    — accessibility label, often present on icon-only controls
 *   4. index                 — position in the most recent [readScreen] snapshot; only
 *                               valid until the screen changes, provided as a last resort.
 *
 * This is entirely inert until the owner explicitly enables "Junction" under
 * Android Settings > Accessibility — the same explicit, revocable opt-in
 * pattern used for the notification listener.
 */
class JunctionAccessibilityService : AccessibilityService() {

    private var volumeDownPressedAt: Long = 0L

    override fun onServiceConnected() {
        instance = this
        serviceInfo = AccessibilityServiceInfo().apply {
            eventTypes = AccessibilityEvent.TYPES_ALL_MASK
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            flags = AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS or
                AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS
            notificationTimeout = 100
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        super.onDestroy()
        if (instance === this) instance = null
    }

    /**
     * §Phase 2.C opt-in summon: a long-press on volume-down launches Junction
     * in voice mode. Off by default (see [summonOnVolumeDownEnabled]) since
     * swallowing a hardware key is user-visible and only desirable when
     * explicitly requested in Settings. Short presses are never consumed, so
     * normal volume control is unaffected.
     */
    override fun onKeyEvent(event: KeyEvent): Boolean {
        if (!summonOnVolumeDownEnabled || event.keyCode != KeyEvent.KEYCODE_VOLUME_DOWN) {
            return super.onKeyEvent(event)
        }
        when (event.action) {
            KeyEvent.ACTION_DOWN -> {
                if (event.repeatCount == 0) volumeDownPressedAt = System.currentTimeMillis()
                val heldMs = System.currentTimeMillis() - volumeDownPressedAt
                return heldMs >= VOLUME_LONG_PRESS_MS
            }
            KeyEvent.ACTION_UP -> {
                val heldMs = System.currentTimeMillis() - volumeDownPressedAt
                if (heldMs >= VOLUME_LONG_PRESS_MS) {
                    val intent = Intent(this, MainActivity::class.java).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        putExtra(MainActivity.EXTRA_OPEN_VOICE, true)
                    }
                    startActivity(intent)
                    return true
                }
            }
        }
        return super.onKeyEvent(event)
    }

    companion object {
        @Volatile private var instance: JunctionAccessibilityService? = null

        /** §Phase 2.C: owner opt-in, off by default. See [onKeyEvent]. */
        @Volatile var summonOnVolumeDownEnabled: Boolean = false

        private const val VOLUME_LONG_PRESS_MS = 500L
        private const val TAG = "JunctionAccessibility"

        fun isEnabled(context: Context): Boolean {
            val expected = "${context.packageName}/${JunctionAccessibilityService::class.java.name}"
            val enabled = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: return false
            return enabled.split(':').any { it.equals(expected, ignoreCase = true) }
        }

        /** True while the service is actually bound and running (not just enabled in Settings). */
        fun isConnected(): Boolean = instance != null

        private const val MAX_ELEMENTS = 150

        /** §2B.2: surfaces whose content is typically not exposed via accessibility nodes. */
        private val LOW_FIDELITY_CLASSES = listOf("WebView", "SurfaceView", "GLSurfaceView", "TextureView")

        /** §2.2 read-only structured snapshot of the foreground screen. */
        fun readScreen(): ScreenSnapshot {
            val svc = instance ?: return ScreenSnapshot(connected = false, elements = emptyList())
            val root = svc.rootInActiveWindow
                ?: return ScreenSnapshot(connected = true, elements = emptyList())
            val elements = mutableListOf<ScreenElement>()
            collectInteresting(root, elements)
            lastElements = elements
            val lowFidelityClass = elements.map { it.className }.firstOrNull { className ->
                LOW_FIDELITY_CLASSES.any { className.contains(it, ignoreCase = true) }
            }
            return ScreenSnapshot(
                connected = true,
                packageName = root.packageName?.toString(),
                elements = elements,
                lowFidelity = lowFidelityClass != null,
                lowFidelityReason = lowFidelityClass?.let {
                    "Detected a $it surface — its content usually isn't exposed to accessibility services, so this element list may be incomplete."
                }
            )
        }

        /**
         * §2B.2 the same snapshot as [readScreen], but first checks whether the
         * foreground window is FLAG_SECURE (e.g. a banking app) and, if so,
         * returns a documented "unreadable" result instead of whatever the
         * accessibility tree happens to expose — never partial content.
         */
        suspend fun readScreenSafely(): ScreenSnapshot {
            val svc = instance ?: return ScreenSnapshot(connected = false, elements = emptyList())
            if (isSecureForegroundWindow(svc)) {
                return ScreenSnapshot(connected = true, elements = emptyList(), secure = true)
            }
            return readScreen()
        }

        private suspend fun isSecureForegroundWindow(svc: JunctionAccessibilityService): Boolean {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return false
            return try {
                withTimeoutOrNull(400L) {
                    suspendCancellableCoroutine<Boolean> { cont ->
                        try {
                            svc.takeScreenshot(
                                Display.DEFAULT_DISPLAY,
                                svc.mainExecutor,
                                object : AccessibilityService.TakeScreenshotCallback {
                                    override fun onSuccess(result: AccessibilityService.ScreenshotResult) {
                                        if (cont.isActive) cont.resume(false)
                                    }

                                    override fun onFailure(errorCode: Int) {
                                        val secure = errorCode == AccessibilityService.ERROR_TAKE_SCREENSHOT_SECURE_WINDOW
                                        if (cont.isActive) cont.resume(secure)
                                    }
                                }
                            )
                        } catch (_: Exception) {
                            if (cont.isActive) cont.resume(false)
                        }
                    }
                } ?: false
            } catch (_: Exception) {
                false
            }
        }

        /** Stable representation used to verify that an accessibility action changed the active UI. */
        fun screenFingerprint(): String {
            val snapshot = readScreen()
            return buildString {
                append(snapshot.packageName.orEmpty()).append('|')
                snapshot.elements.forEach { element ->
                    append(element.resourceId.orEmpty()).append(':')
                    append(element.text.orEmpty()).append(':')
                    append(element.contentDescription.orEmpty()).append(':')
                    append(element.bounds).append(':')
                    append(element.checked).append(';')
                }
            }
        }

        fun screenContains(value: String): Boolean {
            if (value.isBlank()) return false
            return readScreen().elements.any { element ->
                element.text == value || element.contentDescription == value || element.resourceId == value
            }
        }

        fun selectorHasText(selector: ElementSelector, expectedText: String): Boolean {
            if (expectedText.isBlank()) return false
            val svc = instance ?: return false
            val root = svc.rootInActiveWindow ?: return false
            return (locate(root, selector) as? Located.Found)?.node?.text?.toString() == expectedText
        }

        fun tapElement(selector: ElementSelector): ActionResult =
            withNode(selector) { node ->
                val target = nearestClickableAncestor(node)
                if (target.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                    ActionResult(true, "Tapped element.")
                } else {
                    ActionResult(false, "Element was found but did not accept a click action.")
                }
            }

        fun setText(selector: ElementSelector, value: String): ActionResult =
            withNode(selector) { node ->
                val target = nearestEditableDescendantOrSelf(node)
                    ?: return@withNode ActionResult(false, "No editable field found at or under the matched element.")
                val args = Bundle().apply {
                    putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value)
                }
                if (target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
                    ActionResult(true, "Set text.")
                } else {
                    ActionResult(false, "Element was found but did not accept a set-text action.")
                }
            }

        fun scroll(direction: ScrollDirection, selector: ElementSelector?): ActionResult {
            val svc = instance ?: return ActionResult(false, "Accessibility service is not connected.")
            val root = svc.rootInActiveWindow ?: return ActionResult(false, "No active window to scroll.")
            val node = if (selector != null && !selector.isEmpty()) {
                when (val located = locate(root, selector)) {
                    is Located.Found -> located.node
                    is Located.NotFound -> return ActionResult(false, "No element matched the given selector.")
                    is Located.Ambiguous -> return ActionResult(false, "Selector matched ${located.count} elements; use a more specific selector.")
                }
            } else {
                firstScrollable(root) ?: return ActionResult(false, "No scrollable element found on screen.")
            }
            val action = when (direction) {
                ScrollDirection.DOWN, ScrollDirection.RIGHT -> AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
                ScrollDirection.UP, ScrollDirection.LEFT -> AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
            }
            return if (node.performAction(action)) {
                ActionResult(true, "Scrolled $direction.")
            } else {
                ActionResult(false, "Element was found but did not accept a scroll action.")
            }
        }

        fun pressBack(): ActionResult {
            val svc = instance ?: return ActionResult(false, "Accessibility service is not connected.")
            return if (svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)) {
                ActionResult(true, "Pressed back.")
            } else {
                ActionResult(false, "Back action was rejected by the system.")
            }
        }

        fun pressHome(): ActionResult {
            val svc = instance ?: return ActionResult(false, "Accessibility service is not connected.")
            return if (svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)) {
                ActionResult(true, "Pressed home.")
            } else {
                ActionResult(false, "Home action was rejected by the system.")
            }
        }

        // ── Internals ────────────────────────────────────────────────────────

        @Volatile private var lastElements: List<ScreenElement> = emptyList()

        private fun withNode(selector: ElementSelector, block: (AccessibilityNodeInfo) -> ActionResult): ActionResult {
            val svc = instance ?: return ActionResult(false, "Accessibility service is not connected.")
            val root = svc.rootInActiveWindow ?: return ActionResult(false, "No active window found.")
            return when (val located = locate(root, selector)) {
                is Located.Found -> block(located.node)
                is Located.NotFound -> ActionResult(false, "No element matched the given selector.")
                is Located.Ambiguous -> ActionResult(false, "Selector matched ${located.count} elements; use a more specific selector (resourceId is most reliable).")
            }
        }

        private sealed class Located {
            data class Found(val node: AccessibilityNodeInfo) : Located()
            object NotFound : Located()
            data class Ambiguous(val count: Int) : Located()
        }

        /**
         * Selector tiering: resourceId > text > contentDescription > index >
         * fuzzy text (last resort, case-insensitive substring match). Which
         * tier actually matched is logged so per-app selector fragility can
         * be measured over time (§2B.3).
         */
        private fun locate(root: AccessibilityNodeInfo, selector: ElementSelector): Located {
            if (selector.index != null && selector.resourceId.isNullOrBlank() &&
                selector.text.isNullOrBlank() && selector.contentDescription.isNullOrBlank()
            ) {
                val snapshot = lastElements.getOrNull(selector.index)
                    ?: return Located.NotFound
                Log.d(TAG, "Selector matched via tier=index")
                // Re-resolve the cached element against the live tree by its recorded identity,
                // since AccessibilityNodeInfo references from a prior snapshot are not retained.
                return locate(
                    root,
                    ElementSelector(
                        resourceId = snapshot.resourceId,
                        text = snapshot.text,
                        contentDescription = snapshot.contentDescription
                    )
                )
            }

            val exact = findMatches(root) { node ->
                when {
                    !selector.resourceId.isNullOrBlank() -> node.viewIdResourceName == selector.resourceId
                    !selector.text.isNullOrBlank() -> node.text?.toString()?.trim() == selector.text
                    !selector.contentDescription.isNullOrBlank() ->
                        node.contentDescription?.toString()?.trim() == selector.contentDescription
                    else -> false
                }
            }
            if (exact.isNotEmpty()) {
                val tier = when {
                    !selector.resourceId.isNullOrBlank() -> "resourceId"
                    !selector.text.isNullOrBlank() -> "text"
                    else -> "contentDescription"
                }
                Log.d(TAG, "Selector matched via tier=$tier (${exact.size} match(es))")
                return if (exact.size == 1) Located.Found(exact.first()) else Located.Ambiguous(exact.size)
            }

            // Fuzzy fallback: only meaningful for a text selector with no exact hit.
            if (!selector.text.isNullOrBlank()) {
                val needle = selector.text.trim().lowercase()
                val fuzzy = findMatches(root) { node ->
                    val nodeText = node.text?.toString()?.trim()?.lowercase()
                    val nodeDesc = node.contentDescription?.toString()?.trim()?.lowercase()
                    (nodeText != null && nodeText.contains(needle)) ||
                        (nodeDesc != null && nodeDesc.contains(needle))
                }
                if (fuzzy.isNotEmpty()) {
                    Log.d(TAG, "Selector matched via tier=fuzzy (${fuzzy.size} match(es))")
                    return if (fuzzy.size == 1) Located.Found(fuzzy.first()) else Located.Ambiguous(fuzzy.size)
                }
            }

            Log.d(TAG, "Selector matched via tier=none")
            return Located.NotFound
        }

        private fun findMatches(
            root: AccessibilityNodeInfo,
            predicate: (AccessibilityNodeInfo) -> Boolean
        ): List<AccessibilityNodeInfo> {
            val matches = mutableListOf<AccessibilityNodeInfo>()
            fun visit(node: AccessibilityNodeInfo) {
                if (node.isVisibleToUser && predicate(node)) matches.add(node)
                for (i in 0 until node.childCount) {
                    node.getChild(i)?.let { visit(it) }
                }
            }
            visit(root)
            return matches
        }

        private fun collectInteresting(node: AccessibilityNodeInfo, out: MutableList<ScreenElement>) {
            if (out.size >= MAX_ELEMENTS) return
            if (node.isVisibleToUser) {
                val text = node.text?.toString()?.trim()?.takeIf { it.isNotBlank() }
                val desc = node.contentDescription?.toString()?.trim()?.takeIf { it.isNotBlank() }
                val resId = node.viewIdResourceName
                val interesting = text != null || desc != null || resId != null ||
                    node.isClickable || node.isScrollable || node.isEditable || node.isCheckable
                if (interesting) {
                    val bounds = Rect()
                    node.getBoundsInScreen(bounds)
                    out.add(
                        ScreenElement(
                            index = out.size,
                            className = node.className?.toString()?.substringAfterLast('.') ?: "View",
                            text = text,
                            contentDescription = desc,
                            resourceId = resId,
                            bounds = "${bounds.left},${bounds.top},${bounds.right},${bounds.bottom}",
                            clickable = node.isClickable,
                            scrollable = node.isScrollable,
                            checkable = node.isCheckable,
                            checked = node.isChecked,
                            editable = node.isEditable
                        )
                    )
                }
            }
            for (i in 0 until node.childCount) {
                if (out.size >= MAX_ELEMENTS) return
                node.getChild(i)?.let { collectInteresting(it, out) }
            }
        }

        private fun nearestClickableAncestor(node: AccessibilityNodeInfo): AccessibilityNodeInfo {
            var current: AccessibilityNodeInfo? = node
            while (current != null) {
                if (current.isClickable) return current
                current = current.parent
            }
            return node
        }

        private fun nearestEditableDescendantOrSelf(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
            if (node.isEditable) return node
            for (i in 0 until node.childCount) {
                val child = node.getChild(i) ?: continue
                nearestEditableDescendantOrSelf(child)?.let { return it }
            }
            return null
        }

        private fun firstScrollable(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
            if (node.isScrollable) return node
            for (i in 0 until node.childCount) {
                val child = node.getChild(i) ?: continue
                firstScrollable(child)?.let { return it }
            }
            return null
        }
    }
}

enum class ScrollDirection { UP, DOWN, LEFT, RIGHT }

data class ElementSelector(
    val resourceId: String? = null,
    val text: String? = null,
    val contentDescription: String? = null,
    val index: Int? = null
) {
    fun isEmpty(): Boolean = resourceId.isNullOrBlank() && text.isNullOrBlank() &&
        contentDescription.isNullOrBlank() && index == null
}

data class ActionResult(val ok: Boolean, val message: String)

data class ScreenElement(
    val index: Int,
    val className: String,
    val text: String?,
    val contentDescription: String?,
    val resourceId: String?,
    val bounds: String,
    val clickable: Boolean,
    val scrollable: Boolean,
    val checkable: Boolean,
    val checked: Boolean,
    val editable: Boolean
)

data class ScreenSnapshot(
    val connected: Boolean,
    val packageName: String? = null,
    val elements: List<ScreenElement>,
    /** §2B.2: this window is FLAG_SECURE — its content is intentionally not exposed. */
    val secure: Boolean = false,
    /** §2B.2: a WebView/Canvas-like surface was detected; the element list may be incomplete. */
    val lowFidelity: Boolean = false,
    val lowFidelityReason: String? = null
)
