package com.splinch.junction.feature.selfimprove

import java.util.Base64

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

/** A complete replacement for one repository-relative text file. */
data class SourceChange(val path: String, val content: String)

data class RepositorySourceIndex(val prefix: String, val paths: List<String>, val repository: String = "${GitHubContributor.DEFAULT_OWNER}/${GitHubContributor.DEFAULT_REPO}")
data class RepositorySourceFile(val path: String, val content: String, val repository: String = "${GitHubContributor.DEFAULT_OWNER}/${GitHubContributor.DEFAULT_REPO}")

sealed interface ContributionResult {
    data class Opened(val number: Int, val url: String, val branch: String) : ContributionResult
    data class Failed(val reason: String) : ContributionResult
}

enum class PullRequestCheckState { PASSED, PENDING, FAILED, UNAVAILABLE }

data class PullRequestStatus(
    val number: Int,
    val url: String,
    val branch: String,
    val state: String,
    val merged: Boolean,
    val mergeable: Boolean?,
    val checks: PullRequestCheckState,
    val isJunctionProposal: Boolean,
    val detail: String
) {
    val canMerge: Boolean get() = isJunctionProposal && state == "open" && !merged && mergeable == true && checks == PullRequestCheckState.PASSED
}

sealed interface MergeResult {
    data class Merged(val message: String) : MergeResult
    data class NotReady(val reason: String) : MergeResult
    data class Failed(val reason: String) : MergeResult
}

/**
 * Direct GitHub access for an owner-selected repository.
 *
 * The repository is supplied as an explicit owner/name scope and validated before any request. A
 * fine-grained token may have access to more than one repository, but every source change is
 * still created on a new branch and reviewed through a pull request; this class cannot write to main.
 */
class GitHubContributor(
    private val token: String,
    private val httpClient: OkHttpClient = OkHttpClient(),
    private val apiBase: String = API,
    val repositoryFullName: String = "$DEFAULT_OWNER/$DEFAULT_REPO"
) {
    init { require(isSafeRepository(repositoryFullName)) { "Repository must use the owner/name form and may not contain path traversal." } }

    suspend fun proposeChange(
        changes: List<SourceChange>,
        commitMessage: String,
        description: String,
        baseBranch: String = DEFAULT_BASE
    ): ContributionResult = withContext(Dispatchers.IO) {
        validationFailure(changes, commitMessage, baseBranch)?.let { return@withContext ContributionResult.Failed(it) }

        runCatching {
            val baseSha = refSha(baseBranch)
                ?: return@runCatching ContributionResult.Failed("Could not read $baseBranch to branch from.")
            val baseTree = commitTreeSha(baseSha)
                ?: return@runCatching ContributionResult.Failed("Could not read the base commit tree.")
            val treeSha = createTree(baseTree, changes)
                ?: return@runCatching ContributionResult.Failed("Could not prepare the proposed source changes.")
            val commitSha = createCommit(commitMessage, treeSha, baseSha)
                ?: return@runCatching ContributionResult.Failed("Could not create the proposed commit.")
            val branch = "junction/${slug(commitMessage)}-${System.currentTimeMillis() / 1000}"
            createBranch(branch, commitSha)
                ?.let { return@runCatching ContributionResult.Failed(it) }
            openPullRequest(branch, baseBranch, commitMessage, description)
        }.getOrElse { ContributionResult.Failed(it.message ?: "GitHub request failed.") }
    }

    /** Lists source paths from main so the model can select only the files relevant to a change. */
    suspend fun listSource(prefix: String = ""): Result<RepositorySourceIndex> = withContext(Dispatchers.IO) {
        if (token.isBlank()) return@withContext Result.failure(IllegalStateException("No GitHub token is stored."))
        val safePrefix = prefix.trim().trim('/')
        if (!isSafeReadPath(safePrefix, allowEmpty = true)) {
            return@withContext Result.failure(IllegalArgumentException("Source prefix must be a safe repository-relative path."))
        }
        runCatching {
            val body = get("${repoUrl()}/git/trees/$DEFAULT_BASE?recursive=1")
                ?: error("GitHub could not list the selected repository's source tree.")
            val tree = JSONObject(body).optJSONArray("tree") ?: error("GitHub returned no source tree.")
            val paths = buildList {
                for (index in 0 until tree.length()) {
                    val entry = tree.optJSONObject(index) ?: continue
                    if (entry.optString("type") != "blob") continue
                    val path = entry.optString("path")
                    if (path.isNotBlank() && (safePrefix.isBlank() || path.startsWith("$safePrefix/")) && isSafeReadPath(path)) add(path)
                    if (size >= MAX_SOURCE_INDEX_PATHS) break
                }
            }
            RepositorySourceIndex(safePrefix, paths, repositoryFullName)
        }
    }

    /** Reads one tracked text file from main. It never exposes signing or local secret material. */
    suspend fun readSource(path: String): Result<RepositorySourceFile> = withContext(Dispatchers.IO) {
        if (token.isBlank()) return@withContext Result.failure(IllegalStateException("No GitHub token is stored."))
        val safePath = path.trim()
        if (!isSafeReadPath(safePath)) {
            return@withContext Result.failure(IllegalArgumentException("That source path is not available to Junction."))
        }
        runCatching {
            val body = get("${repoUrl()}/contents/$safePath?ref=$DEFAULT_BASE")
                ?: error("GitHub could not read $safePath from $DEFAULT_BASE.")
            val json = JSONObject(body)
            if (json.optString("encoding") != "base64") error("$safePath is not a text file GitHub can return.")
            val encoded = json.optString("content").replace(Regex("\\s"), "")
            val content = Base64.getDecoder().decode(encoded).toString(Charsets.UTF_8)
            if (content.length > MAX_SOURCE_READ_CHARS) error("$safePath is too large; list a narrower folder or split the file before reading it.")
            RepositorySourceFile(safePath, content, repositoryFullName)
        }
    }

    private fun isSafeReadPath(path: String, allowEmpty: Boolean = false): Boolean {
        if (path.isBlank()) return allowEmpty
        if (path.startsWith("/") || path.contains('\\') || path.split('/').any { it.isBlank() || it == ".." }) return false
        return path != "local.properties" && !path.endsWith(".keystore") && !path.endsWith("google-services.json")
    }
    /** Checks the stored token without changing a repository. */
    suspend fun verifyToken(): Result<String> = withContext(Dispatchers.IO) {
        if (token.isBlank()) return@withContext Result.failure(IllegalStateException("No GitHub token is stored."))
        runCatching {
            val account = get("$apiBase/user") ?: error("GitHub rejected the token or could not be reached.")
            val login = JSONObject(account).optString("login").takeIf { it.isNotBlank() }
                ?: error("GitHub returned no account name.")
            if (get(repoUrl()) == null) error("This token cannot access $repositoryFullName.")
            login
        }
    }

    suspend fun pullRequestStatus(number: Int): Result<PullRequestStatus> = withContext(Dispatchers.IO) {
        if (number <= 0) return@withContext Result.failure(IllegalArgumentException("A pull request number is required."))
        if (token.isBlank()) return@withContext Result.failure(IllegalStateException("No GitHub token is stored."))
        runCatching {
            val pr = get("${repoUrl()}/pulls/$number") ?: error("GitHub could not read pull request #$number.")
            parsePullRequestStatus(JSONObject(pr))
        }
    }

    /** Merges only an open Junction branch whose GitHub checks have passed. */
    suspend fun mergePullRequest(number: Int): MergeResult = withContext(Dispatchers.IO) {
        pullRequestStatus(number).fold(
            onFailure = { MergeResult.Failed(it.message ?: "Could not inspect the pull request.") },
            onSuccess = { status ->
                if (!status.canMerge) return@fold MergeResult.NotReady(status.detail)
                val body = JSONObject().put("merge_method", "squash")
                val response = put("${repoUrl()}/pulls/$number/merge", body)
                    ?: return@fold MergeResult.Failed("GitHub did not merge pull request #$number.")
                val json = JSONObject(response)
                if (json.optBoolean("merged")) MergeResult.Merged(json.optString("message", "Pull request merged."))
                else MergeResult.NotReady(json.optString("message", "GitHub says this pull request cannot be merged yet."))
            }
        )
    }

    private fun validationFailure(changes: List<SourceChange>, message: String, baseBranch: String): String? {
        if (token.isBlank()) return "No GitHub token is stored. Add one in Settings before proposing code changes."
        if (!isSafeRepository(repositoryFullName)) return "Repository must use the owner/name form and may not contain path traversal."
        if (changes.isEmpty()) return "At least one source file is required."
        if (changes.size > MAX_CHANGES) return "A proposal can change at most $MAX_CHANGES files."
        if (message.isBlank()) return "A commit message is required."
        if (baseBranch != DEFAULT_BASE) return "Proposals may only target $DEFAULT_BASE."
        if (changes.groupBy { it.path }.any { it.value.size > 1 }) return "Each proposed file may appear only once."
        return changes.firstNotNullOfOrNull { change -> unsafePathReason(change) }
    }

    private fun unsafePathReason(change: SourceChange): String? = when {
        change.path.isBlank() -> "Each change needs a file path."
        change.content.isEmpty() -> "Empty file contents are not supported; Junction does not delete files."
        change.path.startsWith("/") || change.path.contains("\\") || change.path.split('/').any { it == ".." || it.isBlank() } ->
            "Paths must be safe, repository-relative POSIX paths."
        change.path.startsWith(".github/") || change.path == "local.properties" ||
            change.path.endsWith(".keystore") || change.path.endsWith("google-services.json") ->
            "Junction cannot change workflows, signing material, or secret configuration."
        change.content.length > MAX_FILE_CHARS -> "${change.path} is too large for a mobile proposal."
        else -> null
    }

    private fun refSha(branch: String): String? =
        get("${repoUrl()}/git/ref/heads/$branch")?.let { JSONObject(it).optJSONObject("object")?.optString("sha")?.takeIf { sha -> sha.isNotBlank() } }

    private fun commitTreeSha(commitSha: String): String? =
        get("${repoUrl()}/git/commits/$commitSha")?.let { JSONObject(it).optJSONObject("tree")?.optString("sha")?.takeIf { sha -> sha.isNotBlank() } }

    private fun createTree(baseTreeSha: String, changes: List<SourceChange>): String? {
        val tree = JSONArray()
        changes.forEach { change ->
            tree.put(JSONObject().put("path", change.path).put("mode", "100644").put("type", "blob").put("content", change.content))
        }
        val response = post("${repoUrl()}/git/trees", JSONObject().put("base_tree", baseTreeSha).put("tree", tree)) ?: return null
        return JSONObject(response).optString("sha").takeIf { it.isNotBlank() }
    }

    private fun createCommit(message: String, treeSha: String, parentSha: String): String? {
        val response = post(
            "${repoUrl()}/git/commits",
            JSONObject().put("message", message).put("tree", treeSha).put("parents", JSONArray().put(parentSha))
        ) ?: return null
        return JSONObject(response).optString("sha").takeIf { it.isNotBlank() }
    }

    private fun createBranch(branch: String, fromSha: String): String? {
        val response = post("${repoUrl()}/git/refs", JSONObject().put("ref", "refs/heads/$branch").put("sha", fromSha))
        return if (response == null) "Could not create branch $branch." else null
    }

    private fun openPullRequest(head: String, base: String, title: String, description: String): ContributionResult {
        val response = post(
            "${repoUrl()}/pulls",
            JSONObject().put("title", title).put("head", head).put("base", base)
                .put("body", description.ifBlank { "Proposed by Junction." })
        ) ?: return ContributionResult.Failed("Branch $head was created, but the pull request could not be opened.")
        val json = JSONObject(response)
        return ContributionResult.Opened(json.optInt("number"), json.optString("html_url"), head)
    }

    private fun parsePullRequestStatus(pr: JSONObject): PullRequestStatus {
        val number = pr.optInt("number")
        val head = pr.optJSONObject("head") ?: error("GitHub returned a malformed pull request.")
        val sha = head.optString("sha").takeIf { it.isNotBlank() } ?: error("GitHub returned no pull request head.")
        val checks = checkState(sha)
        val state = pr.optString("state")
        val merged = pr.optBoolean("merged")
        val base = pr.optJSONObject("base")?.optString("ref").orEmpty()
        val isJunctionProposal = head.optString("ref").startsWith("junction/") && base == DEFAULT_BASE
        val mergeable = if (pr.isNull("mergeable")) null else pr.optBoolean("mergeable")
        val detail = when {
            !isJunctionProposal -> "Pull request #$number is not a Junction-managed branch targeting $DEFAULT_BASE."
            merged -> "Pull request #$number has already been merged."
            state != "open" -> "Pull request #$number is $state."
            mergeable != true -> "GitHub has not marked pull request #$number mergeable yet."
            checks == PullRequestCheckState.PENDING -> "Checks are still running for pull request #$number."
            checks == PullRequestCheckState.FAILED -> "One or more checks failed for pull request #$number."
            checks == PullRequestCheckState.UNAVAILABLE -> "GitHub has not reported required checks for pull request #$number."
            else -> "Pull request #$number is ready to merge."
        }
        return PullRequestStatus(number, pr.optString("html_url"), head.optString("ref"), state, merged, mergeable, checks, isJunctionProposal, detail)
    }

    private fun checkState(headSha: String): PullRequestCheckState {
        val response = get("${repoUrl()}/commits/$headSha/check-runs") ?: return PullRequestCheckState.UNAVAILABLE
        val runs = JSONObject(response).optJSONArray("check_runs") ?: return PullRequestCheckState.UNAVAILABLE
        if (runs.length() == 0) return PullRequestCheckState.UNAVAILABLE
        var pending = false
        for (index in 0 until runs.length()) {
            val run = runs.optJSONObject(index) ?: continue
            if (run.optString("status") != "completed") pending = true
            else if (run.optString("conclusion") !in SUCCESSFUL_CONCLUSIONS) return PullRequestCheckState.FAILED
        }
        return if (pending) PullRequestCheckState.PENDING else PullRequestCheckState.PASSED
    }

    private fun repoUrl() = "$apiBase/repos/$repositoryFullName"
    private fun get(url: String): String? = execute(request(url).get().build())
    private fun post(url: String, body: JSONObject): String? = execute(request(url).post(body.toString().toRequestBody(JSON)).build())
    private fun put(url: String, body: JSONObject): String? = execute(request(url).put(body.toString().toRequestBody(JSON)).build())
    private fun request(url: String) = Request.Builder().url(url)
        .header("Authorization", "Bearer $token")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
    private fun execute(request: Request): String? = httpClient.newCall(request).execute().use { response ->
        if (response.isSuccessful) response.body?.string() else null
    }
    private fun slug(message: String): String = message.lowercase().replace(Regex("[^a-z0-9]+"), "-")
        .trim('-').take(40).ifBlank { "change" }

    companion object {
        const val DEFAULT_OWNER = "SplinchGit"
        const val DEFAULT_REPO = "Junction"
        const val DEFAULT_BASE = "main"
        const val TOKEN_ID = "github"
        private const val API = "https://api.github.com"
        private const val MAX_CHANGES = 30
        private const val MAX_SOURCE_INDEX_PATHS = 500
        private const val MAX_SOURCE_READ_CHARS = 48_000
        private const val MAX_FILE_CHARS = 250_000
        private val SUCCESSFUL_CONCLUSIONS = setOf("success", "neutral", "skipped")
        private val JSON = "application/json; charset=utf-8".toMediaType()
        fun isSafeRepository(value: String): Boolean =
            value.matches(Regex("[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}")) &&
                !value.contains("..")
    }
}