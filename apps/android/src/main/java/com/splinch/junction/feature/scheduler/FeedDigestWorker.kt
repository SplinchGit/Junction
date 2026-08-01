package com.splinch.junction.feature.scheduler

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.splinch.junction.assistant.provider.ProviderRegistry
import com.splinch.junction.data.database.JunctionDatabase
import com.splinch.junction.feature.feed.FeedRepository
import com.splinch.junction.feature.feed.model.FeedStatus
import com.splinch.junction.data.preference.UserPrefsRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext

class FeedDigestWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        return withContext(Dispatchers.Default) {
            val database = JunctionDatabase.getInstance(applicationContext)
            val repository = FeedRepository(database.feedDao())
            val prefs = UserPrefsRepository(applicationContext)
            if (!prefs.digestEnabledFlow.first()) {
                NotificationHelper.cancelDigest(applicationContext)
                return@withContext Result.success()
            }
            if (DigestSchedulePolicy.suppressesAt(System.currentTimeMillis(), prefs.digestQuietHoursFlow.first())) {
                NotificationHelper.cancelDigest(applicationContext)
                return@withContext Result.success()
            }
            val profile = prefs.digestProfileFlow.first()
            val items = repository.getAll().filter {
                it.status != FeedStatus.ARCHIVED && DigestSchedulePolicy.includesCategory(profile, it.category)
            }
            val summary = buildJudgedSummary(items, prefs)
            if (summary.isNotBlank()) {
                val now = System.currentTimeMillis()
                val lastDigestAt = prefs.lastDigestAtFlow.first()
                val lastSummary = prefs.lastDigestSummaryFlow.first()
                val hasNewItems = items.any { it.timestamp > lastDigestAt }
                val unchanged = summary == lastSummary
                val withinCooldown = now - lastDigestAt < DIGEST_COOLDOWN_MS
                if (hasNewItems && !(unchanged && withinCooldown)) {
                    NotificationHelper.showDigest(applicationContext, summary)
                    // Per-item notifications ride under the digest as a group, so
                    // each one can tap straight through to the app that raised it.
                    // Newest first, since that's what the owner is most likely to
                    // still care about opening.
                    NotificationHelper.showFeedItems(
                        applicationContext,
                        items.filter { it.status == FeedStatus.NEW }.sortedByDescending { it.timestamp }
                    )
                    prefs.updateDigest(summary, now)
                }
            } else {
                NotificationHelper.cancelDigest(applicationContext)
            }
            Result.success()
        }
    }

    /**
     * §3.2 deterministic suppression. The standing-orders items are fed
     * through the tool-free reader lane (never the actor — this is a
     * JUNCTION-triggered background check, so it may only ever *propose* a
     * notification, never execute anything, per §1.4 trigger provenance).
     *
     * Suppression is a fixed numeric gate on the reader's own validated
     * [salience][com.splinch.junction.assistant.context.ReaderOutput.salience]
     * field (already clamped to 0..1 by every provider's parser) rather than
     * a freeform "NOTHING_TO_REPORT" sentinel parsed out of model text —
     * that keeps the suppression check itself immune to a chatty or
     * manipulated response smuggling a notification through, while reusing
     * the same reader contract the rest of the app already relies on.
     * Falls back to the plain top-3-by-priority digest if no provider is
     * configured or the reader call fails to parse (fail closed: on doubt,
     * still show something rather than silently going dark forever).
     */
    private suspend fun buildJudgedSummary(
        items: List<com.splinch.junction.feature.feed.model.FeedItem>,
        prefs: UserPrefsRepository
    ): String {
        if (items.isEmpty()) return ""
        val provider = ProviderRegistry(applicationContext, prefs).getActiveProvider()
            ?: return buildSummary(items)

        val content = buildString {
            append("Standing-orders check across ${items.size} pending item(s):\n")
            items.sortedByDescending { it.priority }.take(10).forEach { item ->
                append("- [").append(item.category).append("] ").append(item.title)
                item.body?.takeIf { it.isNotBlank() }?.let { append(": ").append(it.take(200)) }
                append('\n')
            }
        }
        val reader = provider.readUntrusted(content, sourceHint = "digest:standing-orders") ?: return buildSummary(items)
        if (reader.salience < SALIENCE_SUPPRESSION_THRESHOLD) return "" // deterministic suppression
        return reader.summary
    }

    private fun buildSummary(items: List<com.splinch.junction.feature.feed.model.FeedItem>): String {
        if (items.isEmpty()) return ""
        val top = items.sortedByDescending { it.priority }.take(3)
        return top.joinToString(" - ") { it.title }
    }

    companion object {
        private const val DIGEST_COOLDOWN_MS = 2 * 60 * 60 * 1000L
        private const val SALIENCE_SUPPRESSION_THRESHOLD = 0.35f
    }
}
