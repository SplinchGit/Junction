package com.splinch.junction.selfimprove

import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

sealed interface ContributionResult {
    data class Opened(val number: Int, val url: String, val branch: String) : ContributionResult
    data class Failed(val reason: String) : ContributionResult
}

/**
 * Lets Junction propose changes to its own source.
 *
 * **This deliberately cannot push to `main`.** Every push to `main` rebuilds the APK and
 * republishes it at the one URL the owner's phone auto-updates from, so a direct push
 * would let the model ship unreviewed code onto the owner's device with no human in the
 * loop -- and Junction reads the screen, drives apps and sends messages. A pull request
 * keeps the owner as the gate on anything that reaches their phone, which is the same
 * bargain `TrustGate` strikes everywhere else: the model proposes, the owner decides.
 *
 * The tool is registered [com.splinch.junction.chat.tools.RiskTier.DESTRUCTIVE] for the
 * same reason. It is not destructive to the device, but it writes to the repository the
 * owner's app is built from, which is about as high-impact as a proposal gets.
 */
class GitHubContributor(
    private val token: String,
    private val owner: String = DEFAULT_OWNER,
    private val repo: String = DEFAULT_REPO,
    private val httpClient: OkHttpClient = OkHttpClient()
) {

    suspend fun proposeChange(
        path: String,
        content: String,
        commitMessage: String,
        description: String,
        baseBranch: String = DEFAULT_BASE
    ): ContributionResult = withContext(Dispatchers.IO) {
        if (token.isBlank()) {
            return@withContext ContributionResult.Failed(
                "No GitHub token is stored. Add one in Settings before proposing code changes."
            )
        }
        if (path.isBlank() || commitMessage.isBlank()) {
            return@withContext ContributionResult.Failed("A file path and a commit message are both required.")
        }
        // Refuse paths that escape the repo root. The API would reject most of these, but
        // a traversal that did land would write outside the tree the owner reviews.
        if (path.startsWith("/") || path.contains("..")) {
            return@withContext ContributionResult.Failed("Path must be relative to the repository root.")
        }

        runCatching {
            val baseSha = refSha(baseBranch)
                ?: return@runCatching ContributionResult.Failed("Could not read $baseBranch to branch from.")

            val branch = "junction/${slug(commitMessage)}-${System.currentTimeMillis() / 1000}"
            createBranch(branch, baseSha)
                ?.let { return@runCatching ContributionResult.Failed(it) }

            putFile(path, content, commitMessage, branch)
                ?.let { return@runCatching ContributionResult.Failed(it) }

            openPullRequest(branch, baseBranch, commitMessage, description)
        }.getOrElse { ContributionResult.Failed(it.message ?: "GitHub request failed.") }
    }

    private fun refSha(branch: String): String? {
        val response = get("$API/repos/$owner/$repo/git/ref/heads/$branch") ?: return null
        return JSONObject(response).optJSONObject("object")?.optString("sha")?.takeIf { it.isNotBlank() }
    }

    /** Returns null on success, or a human-readable failure. */
    private fun createBranch(branch: String, fromSha: String): String? {
        val body = JSONObject()
            .put("ref", "refs/heads/$branch")
            .put("sha", fromSha)
        return if (post("$API/repos/$owner/$repo/git/refs", body) == null) {
            "Could not create branch $branch."
        } else {
            null
        }
    }

    private fun putFile(path: String, content: String, message: String, branch: String): String? {
        val body = JSONObject()
            .put("message", message)
            .put("content", Base64.encodeToString(content.toByteArray(), Base64.NO_WRAP))
            .put("branch", branch)
        // An existing file needs its blob sha, or the API rejects the write as a conflict.
        existingFileSha(path, branch)?.let { body.put("sha", it) }
        return if (put("$API/repos/$owner/$repo/contents/$path", body) == null) {
            "Could not write $path."
        } else {
            null
        }
    }

    private fun existingFileSha(path: String, branch: String): String? {
        val response = get("$API/repos/$owner/$repo/contents/$path?ref=$branch") ?: return null
        return JSONObject(response).optString("sha").takeIf { it.isNotBlank() }
    }

    private fun openPullRequest(
        head: String,
        base: String,
        title: String,
        description: String
    ): ContributionResult {
        val body = JSONObject()
            .put("title", title)
            .put("head", head)
            .put("base", base)
            .put("body", description.ifBlank { "Proposed by Junction." })
        val response = post("$API/repos/$owner/$repo/pulls", body)
            ?: return ContributionResult.Failed("Branch $head was pushed, but the pull request could not be opened.")
        val json = JSONObject(response)
        return ContributionResult.Opened(
            number = json.optInt("number"),
            url = json.optString("html_url"),
            branch = head
        )
    }

    private fun get(url: String): String? = execute(request(url).get().build())

    private fun post(url: String, body: JSONObject): String? =
        execute(request(url).post(body.toString().toRequestBody(JSON)).build())

    private fun put(url: String, body: JSONObject): String? =
        execute(request(url).put(body.toString().toRequestBody(JSON)).build())

    private fun request(url: String) = Request.Builder()
        .url(url)
        .header("Authorization", "Bearer $token")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")

    private fun execute(request: Request): String? =
        httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) null else response.body?.string()
        }

    /** Branch-name-safe fragment of the commit message. */
    private fun slug(message: String): String = message
        .lowercase()
        .replace(Regex("[^a-z0-9]+"), "-")
        .trim('-')
        .take(40)
        .ifBlank { "change" }

    companion object {
        const val DEFAULT_OWNER = "SplinchGit"
        const val DEFAULT_REPO = "Junction"
        const val DEFAULT_BASE = "main"

        /** Provider id its token is stored under in `KeyStorage`. */
        const val TOKEN_ID = "github"

        private const val API = "https://api.github.com"
        private val JSON = "application/json; charset=utf-8".toMediaType()
    }
}
