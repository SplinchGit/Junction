package com.splinch.junction.feature.selfimprove

import android.content.Context

/** The one Junction PR currently being followed by the self-update flow. */
data class TrackedPullRequest(val number: Int, val url: String, val branch: String)

class GitHubPullRequestStore(context: Context) {
    private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    fun save(result: ContributionResult.Opened) {
        preferences.edit()
            .putInt(KEY_NUMBER, result.number)
            .putString(KEY_URL, result.url)
            .putString(KEY_BRANCH, result.branch)
            .apply()
    }

    fun load(): TrackedPullRequest? {
        val number = preferences.getInt(KEY_NUMBER, 0)
        if (number <= 0) return null
        return TrackedPullRequest(
            number = number,
            url = preferences.getString(KEY_URL, "").orEmpty(),
            branch = preferences.getString(KEY_BRANCH, "").orEmpty()
        )
    }

    fun clear() = preferences.edit().clear().apply()

    private companion object {
        const val PREFERENCES = "junction_github_change"
        const val KEY_NUMBER = "number"
        const val KEY_URL = "url"
        const val KEY_BRANCH = "branch"
    }
}