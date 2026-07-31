package com.splinch.junction.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.splinch.junction.BuildConfig
import com.splinch.junction.update.InstallPermissionMissing
import com.splinch.junction.update.SignatureMismatch
import com.splinch.junction.update.SigningIdentity
import com.splinch.junction.update.UpdateCheck
import com.splinch.junction.update.UpdateChecker
import com.splinch.junction.update.UpdateInfo
import com.splinch.junction.update.UpdateInstaller
import com.splinch.junction.update.UpdateStage
import kotlinx.coroutines.launch

/** Where the check has got to, so the button can say something other than nothing. */
private sealed interface CheckState {
    data object Idle : CheckState
    data object Checking : CheckState
    data class UpToDate(val publishedVersionCode: Int) : CheckState
    data class Available(val update: UpdateInfo) : CheckState
    data class Failed(val message: String) : CheckState
}

/**
 * Version, build number, signing key, and a button that checks for a new build and
 * installs it.
 *
 * Updating used to depend on noticing a banner on the Feed screen that hid itself after
 * six seconds, so an owner who missed it had no way to ask. Reinstalling by hand looks
 * like the only option from there, and reinstalling looks like it means uninstalling
 * first -- which it does not, as long as the signing keys match. Hence all four facts in
 * one place, with the key on show: it is the one that decides whether an update can land
 * over the top, and otherwise takes `adb` and `keytool` on a PC to find out.
 */
@Composable
fun UpdateSettingsSection(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val installer = remember { UpdateInstaller(context) }
    val signingKey = remember { SigningIdentity.short(SigningIdentity.installed(context)) }

    var state by remember { mutableStateOf<CheckState>(CheckState.Idle) }
    var stage by remember { mutableStateOf<UpdateStage?>(null) }
    var mismatch by remember { mutableStateOf<SignatureMismatch?>(null) }
    var needsPermission by remember { mutableStateOf(false) }

    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = "About & updates",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold
        )
        Text(
            text = "Version ${BuildConfig.VERSION_NAME} · build ${BuildConfig.JUNCTION_VERSION_CODE}",
            style = MaterialTheme.typography.bodyMedium
        )
        Text(
            text = "Signing key $signingKey — an update has to carry this same key to install " +
                "over the top. A different one can only be installed by uninstalling first, " +
                "which erases your API keys.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 2.dp)
        )

        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            OutlinedButton(
                enabled = state != CheckState.Checking && stage == null,
                onClick = {
                    mismatch = null
                    state = CheckState.Checking
                    scope.launch {
                        // Deliberately the three-way check: telling an owner they are up
                        // to date because the network was down is how someone sits on an
                        // old build convinced it is the current one.
                        state = when (val result = UpdateChecker().check(BuildConfig.JUNCTION_VERSION_CODE)) {
                            is UpdateCheck.Available -> CheckState.Available(result.update)
                            is UpdateCheck.UpToDate -> CheckState.UpToDate(result.publishedVersionCode)
                            is UpdateCheck.Failed -> CheckState.Failed(result.reason)
                        }
                    }
                }
            ) {
                Text(if (state == CheckState.Checking) "Checking…" else "Check for updates")
            }

            val available = state as? CheckState.Available
            if (available != null && stage == null) {
                Button(
                    onClick = {
                        if (!installer.canInstallPackages()) {
                            needsPermission = true
                            installer.requestInstallPermission()
                            return@Button
                        }
                        needsPermission = false
                        scope.launch {
                            stage = UpdateStage.Downloading(null)
                            installer.downloadAndRequestInstall(available.update) { stage = it }
                                .onFailure { error ->
                                    mismatch = error as? SignatureMismatch
                                    needsPermission = error is InstallPermissionMissing
                                    state = CheckState.Failed(error.message ?: "Could not install the update.")
                                }
                            stage = null
                        }
                    }
                ) {
                    Text("Install build ${available.update.versionCode}")
                }
            }
        }

        StatusLine(state = state, stage = stage, needsPermission = needsPermission)

        if (stage != null) {
            val downloading = stage as? UpdateStage.Downloading
            val percent = downloading?.percent
            if (percent == null) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth().padding(top = 6.dp))
            } else {
                LinearProgressIndicator(
                    progress = { percent / 100f },
                    modifier = Modifier.fillMaxWidth().padding(top = 6.dp)
                )
            }
        }

        mismatch?.let { problem ->
            Text(
                text = "The published build is signed with key ${problem.updateKey.take(12)}, " +
                    "but this one carries ${problem.installedKey.take(12)}. Android will not " +
                    "install one over the other. Installing it means uninstalling Junction " +
                    "first: chat history and memory can be restored from a backup, but the " +
                    "API keys cannot, because they are held in the Android Keystore and go " +
                    "with the app.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(top = 6.dp)
            )
        }

        if (needsPermission) {
            TextButton(
                onClick = { installer.requestInstallPermission() },
                modifier = Modifier.padding(top = 2.dp)
            ) {
                Text("Allow Junction to install updates")
            }
        }
    }
}

@Composable
private fun StatusLine(state: CheckState, stage: UpdateStage?, needsPermission: Boolean) {
    val message = when {
        stage is UpdateStage.Downloading ->
            stage.percent?.let { "Downloading… $it%" } ?: "Downloading…"

        stage == UpdateStage.Verifying -> "Checking the download against its published checksum…"
        stage == UpdateStage.Installing -> "Ready — confirm the install when Android asks."
        needsPermission -> "Android needs your go-ahead before Junction can install its own updates."
        state is CheckState.Available ->
            "Build ${state.update.versionCode} is available. Installing keeps your keys, " +
                "history and memory."

        state is CheckState.UpToDate ->
            "Up to date — build ${state.publishedVersionCode} is the latest published."

        state is CheckState.Failed -> state.message
        else -> null
    } ?: return

    Text(
        text = message,
        style = MaterialTheme.typography.bodySmall,
        color = if (state is CheckState.Failed) {
            MaterialTheme.colorScheme.error
        } else {
            MaterialTheme.colorScheme.onSurfaceVariant
        },
        modifier = Modifier.padding(top = 6.dp)
    )
}
