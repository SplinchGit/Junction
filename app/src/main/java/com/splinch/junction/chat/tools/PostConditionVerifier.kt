package com.splinch.junction.chat.tools

import com.splinch.junction.accessibility.JunctionAccessibilityService
import com.splinch.junction.feed.FeedRepository
import com.splinch.junction.feed.model.FeedStatus
import com.splinch.junction.settings.UserPrefsRepository
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first

/**
 * §2.2 Post-condition verification.
 *
 * Every step declares how it will be verified. After execution, we assert it
 * — even if the tool call itself returned success. If the assertion fails,
 * the step is FAILED and Junction says so plainly rather than reporting
 * success.
 *
 * Tools with no independently-observable state (e.g. launching an intent)
 * honestly report [PostConditionOutcome.trusted] rather than fabricating a
 * check — this is stated plainly per the spec's "what this does not solve"
 * principle, not hidden.
 */
data class PostConditionOutcome(val passed: Boolean, val detail: String) {
    companion object {
        fun trusted(reason: String) = PostConditionOutcome(
            passed = true,
            detail = "$reason (no independent verification available for this tool; trusting the tool's own result)"
        )
    }
}

class PostConditionVerifier(
    private val prefs: UserPrefsRepository,
    private val feedRepository: FeedRepository,
    private val activeNotificationKeys: () -> Set<String>
) {
    suspend fun feedItemHasStatus(id: String, expected: FeedStatus): PostConditionOutcome {
        val entity = feedRepository.getEntityById(id)
            ?: return PostConditionOutcome(false, "Feed item $id no longer exists")
        return if (entity.status == expected) {
            PostConditionOutcome(true, "Feed item $id has status $expected")
        } else {
            PostConditionOutcome(false, "Feed item $id has status ${entity.status}, expected $expected")
        }
    }

    suspend fun packageEnabledIs(packageName: String, expected: Boolean): PostConditionOutcome {
        val actual = prefs.isPackageEnabled(packageName)
        return if (actual == expected) {
            PostConditionOutcome(true, "$packageName feed filter is now ${if (expected) "enabled" else "disabled"}")
        } else {
            PostConditionOutcome(false, "$packageName feed filter did not change (still ${if (actual) "enabled" else "disabled"})")
        }
    }

    suspend fun digestIntervalIs(expectedMinutes: Int): PostConditionOutcome {
        val actual = prefs.digestIntervalMinutesFlow.first()
        return if (actual == expectedMinutes) {
            PostConditionOutcome(true, "Digest interval confirmed at $actual minutes")
        } else {
            PostConditionOutcome(false, "Digest interval reads back as $actual, expected $expectedMinutes")
        }
    }

    suspend fun realtimeEndpointIs(expected: String): PostConditionOutcome {
        val actual = prefs.realtimeEndpointFlow.first()
        return if (actual == expected) {
            PostConditionOutcome(true, "Realtime endpoint confirmed")
        } else {
            PostConditionOutcome(false, "Realtime endpoint reads back as '$actual', expected '$expected'")
        }
    }

    fun notificationIsAbsent(key: String): PostConditionOutcome {
        val stillActive = activeNotificationKeys().contains(key)
        return if (!stillActive) {
            PostConditionOutcome(true, "Notification $key no longer active")
        } else {
            PostConditionOutcome(false, "Notification $key is still active on the device")
        }
    }

    suspend fun foregroundPackageIs(expectedPackageName: String): PostConditionOutcome {
        var lastPackageName: String? = null
        repeat(10) { attempt ->
            val snapshot = JunctionAccessibilityService.readScreen()
            if (!snapshot.connected) {
                return PostConditionOutcome(
                    false,
                    "Cannot verify app launch because accessibility is not connected"
                )
            }
            if (packageMatchesExpected(expectedPackageName, snapshot.packageName)) {
                return PostConditionOutcome(true, "$expectedPackageName is now in the foreground")
            }
            lastPackageName = snapshot.packageName
            if (attempt < 9) delay(100)
        }
        return PostConditionOutcome(
            false,
            "Foreground package is ${lastPackageName ?: "unknown"}, expected $expectedPackageName"
        )
    }

    companion object {
        internal fun packageMatchesExpected(expected: String, observed: String?): Boolean =
            expected.isNotBlank() && expected == observed
    }
}
