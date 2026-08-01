package com.splinch.junction.feature.settings.ui.component

import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.splinch.junction.feature.selfimprove.GitHubContributor
import com.splinch.junction.feature.selfimprove.GitHubPullRequestStore
import com.splinch.junction.feature.selfimprove.MergeResult
import com.splinch.junction.feature.selfimprove.TrackedPullRequest
import com.splinch.junction.data.secret.KeyStorage
import com.splinch.junction.ui.component.JunctionTextField
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Setup and owner controls for Junction's fixed-repository GitHub contribution path.
 * The optional OAuth integration is intentionally not used here: a fine-grained token can be
 * scoped to this repository and held in Android's encrypted key storage.
 */
@Composable
fun GitHubSettingsSection() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val keyStorage = remember { KeyStorage(context) }
    val pullRequests = remember { GitHubPullRequestStore(context) }
    var token by remember { mutableStateOf(keyStorage.getApiKey(GitHubContributor.TOKEN_ID)) }
    var verification by remember { mutableStateOf<String?>(null) }
    var tracked by remember { mutableStateOf(pullRequests.load()) }
    var changeStatus by remember { mutableStateOf<String?>(null) }
    var canMerge by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxWidth()) {
        Text(text = "GitHub self-improvement", style = MaterialTheme.typography.titleMedium)
        Text(
            text = "Junction can create reviewed pull requests only for SplinchGit/Junction. " +
                "It never writes directly to main. Grant only Metadata read, Contents read/write, Pull requests read/write, and Checks read.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(Modifier.height(8.dp))
        JunctionTextField(
            value = token,
            onValueChange = { token = it; verification = null },
            label = "GitHub fine-grained token",
            placeholder = "github_pat_...",
            isPassword = true
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = {
                scope.launch {
                    withContext(Dispatchers.IO) { keyStorage.setApiKey(GitHubContributor.TOKEN_ID, token.trim()) }
                    verification = null
                    Toast.makeText(context, if (token.isBlank()) "GitHub token cleared" else "GitHub token saved", Toast.LENGTH_SHORT).show()
                }
            }) { Text("Save token") }
            OutlinedButton(enabled = token.isNotBlank() && !busy, onClick = {
                busy = true
                verification = "Checking token and Junction access…"
                scope.launch {
                    verification = withContext(Dispatchers.IO) {
                        GitHubContributor(token.trim()).verifyToken().fold(
                            onSuccess = { "Connected as @$it with Junction repository access." },
                            onFailure = { "Could not verify token: ${it.message ?: "unknown error"}" }
                        )
                    }
                    busy = false
                }
            }) { Text("Test token") }
            OutlinedButton(onClick = {
                runCatching {
                    context.startActivity(Intent(Intent.ACTION_VIEW, "https://github.com/settings/personal-access-tokens/new".toUri()))
                }.onFailure { Toast.makeText(context, "Couldn't open a browser", Toast.LENGTH_SHORT).show() }
            }) { Text("Create token") }
        }
        TextButton(onClick = {
            runCatching {
                context.startActivity(Intent(Intent.ACTION_VIEW, "https://github.com/SplinchGit/Junction".toUri()))
            }.onFailure { Toast.makeText(context, "Couldn't open a browser", Toast.LENGTH_SHORT).show() }
        }) { Text("Open Junction repository") }
        verification?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        Spacer(Modifier.height(16.dp))
        PullRequestControls(
            tracked = tracked,
            status = changeStatus,
            canMerge = canMerge,
            busy = busy,
            onRefresh = { pullRequest ->
                busy = true
                scope.launch {
                    val result = withContext(Dispatchers.IO) { GitHubContributor(token.trim()).pullRequestStatus(pullRequest.number) }
                    result.fold(
                        onSuccess = { current ->
                            canMerge = current.canMerge
                            changeStatus = current.detail
                        },
                        onFailure = {
                            canMerge = false
                            changeStatus = "Could not check PR #${pullRequest.number}: ${it.message ?: "unknown error"}"
                        }
                    )
                    busy = false
                }
            },
            onOpen = { pullRequest ->
                if (pullRequest.url.isNotBlank()) {
                    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, pullRequest.url.toUri())) }
                }
            },
            onMerge = { pullRequest ->
                busy = true
                scope.launch {
                    when (val result = withContext(Dispatchers.IO) { GitHubContributor(token.trim()).mergePullRequest(pullRequest.number) }) {
                        is MergeResult.Merged -> {
                            canMerge = false
                            changeStatus = "Merged PR #${pullRequest.number}. GitHub Actions will publish the next update when its build finishes."
                        }
                        is MergeResult.NotReady -> {
                            canMerge = false
                            changeStatus = result.reason
                        }
                        is MergeResult.Failed -> changeStatus = result.reason
                    }
                    busy = false
                }
            },
            onClear = {
                pullRequests.clear()
                tracked = null
                changeStatus = null
                canMerge = false
            }
        )
    }
}

@Composable
private fun PullRequestControls(
    tracked: TrackedPullRequest?,
    status: String?,
    canMerge: Boolean,
    busy: Boolean,
    onRefresh: (TrackedPullRequest) -> Unit,
    onOpen: (TrackedPullRequest) -> Unit,
    onMerge: (TrackedPullRequest) -> Unit,
    onClear: () -> Unit
) {
    Text(text = "Current proposed change", style = MaterialTheme.typography.titleSmall)
    if (tracked == null) {
        Text(
            text = "No Junction pull request is being tracked. Ask Junction in chat to draft a plan; approve the displayed plan to create a PR.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        return
    }
    Text(
        text = "PR #${tracked.number}${tracked.branch.takeIf { it.isNotBlank() }?.let { " · $it" }.orEmpty()}",
        style = MaterialTheme.typography.bodyMedium
    )
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        OutlinedButton(enabled = !busy, onClick = { onRefresh(tracked) }) { Text("Check status") }
        OutlinedButton(enabled = tracked.url.isNotBlank(), onClick = { onOpen(tracked) }) { Text("Open PR") }
        if (canMerge) {
            Button(enabled = !busy, onClick = { onMerge(tracked) }) { Text("Merge PR") }
        }
        OutlinedButton(enabled = !busy, onClick = onClear) { Text("Clear") }
    }
    status?.let {
        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
