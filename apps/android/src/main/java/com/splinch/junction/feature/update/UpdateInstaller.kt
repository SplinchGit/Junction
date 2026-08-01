package com.splinch.junction.feature.update

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Android won't let Junction install anything until "install unknown apps" is granted for
 * it. Its own failure type so the UI can offer the toggle instead of a dead error string.
 */
class InstallPermissionMissing(message: String) : Exception(message)

/**
 * The published build is signed with a different key than the installed one, so Android
 * will not install it over the top at any price.
 *
 * Caught before the install intent rather than after, because the system's own answer is
 * "App not installed" with no reason given -- and the real cost (an uninstall, which takes
 * the API keys with it) is something the owner should be told before they start, not
 * discovered afterwards.
 */
class SignatureMismatch(
    val installedKey: String,
    val updateKey: String
) : Exception(
    "This build is signed with a different key (${updateKey.take(12)}) than the installed " +
        "one (${installedKey.take(12)}), so Android can't install it over the top."
)

object ApkIntegrity {
    fun sha256(file: File): String = file.inputStream().use { input ->
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        while (true) {
            val count = input.read(buffer)
            if (count <= 0) break
            digest.update(buffer, 0, count)
        }
        digest.digest().joinToString("") { "%02x".format(it) }
    }

    fun expectedHash(checksumFile: String): String? = Regex("(?i)\\b[a-f0-9]{64}\\b")
        .find(checksumFile)
        ?.value
        ?.lowercase()
}

/**
 * How far along an update is. Without this the banner sat there looking inert for however
 * long a twenty-megabyte download takes, which reads as a dead button and gets tapped
 * again -- starting the whole thing over.
 */
sealed interface UpdateStage {
    /** [percent] is null when the server didn't say how big the file is. */
    data class Downloading(val percent: Int?) : UpdateStage

    /** Checking the download against the published checksum. */
    data object Verifying : UpdateStage

    /** Handed to Android's package installer; the system dialog is up. */
    data object Installing : UpdateStage
}

/** Downloads only releases with an accompanying checksum, then delegates consent to Android's installer. */
class UpdateInstaller(
    private val context: Context,
    private val httpClient: OkHttpClient = OkHttpClient()
) {
    /**
     * Whether Android will let Junction hand an APK to the package installer at all.
     *
     * Without this permission the install intent opens a dead end, and the owner is left
     * looking at a settings screen with no idea why -- after waiting through the whole
     * download. Checked before a byte is fetched.
     */
    fun canInstallPackages(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
            runCatching { context.packageManager.canRequestPackageInstalls() }.getOrDefault(false)

    /** Sends the owner straight to the toggle for [canInstallPackages], not a settings index. */
    fun requestInstallPermission(): Result<Unit> = runCatching {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
        } else {
            Intent(Settings.ACTION_SECURITY_SETTINGS)
        }
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    suspend fun downloadAndRequestInstall(
        update: UpdateInfo,
        onStage: (UpdateStage) -> Unit = {}
    ): Result<Unit> = withContext(Dispatchers.IO) {
        val apkUrl = update.apkUrl?.takeIf { it.startsWith("https://") }
            ?: return@withContext Result.failure(IllegalArgumentException("This release has no verified APK asset."))
        val checksumUrl = update.sha256Url?.takeIf { it.startsWith("https://") }
            ?: return@withContext Result.failure(IllegalArgumentException("This release has no SHA-256 checksum asset."))
        if (!canInstallPackages()) {
            return@withContext Result.failure(
                InstallPermissionMissing("Junction needs permission to install app updates.")
            )
        }
        try {
            val checksum = httpClient.newCall(Request.Builder().url(checksumUrl).build()).execute().use { response ->
                if (!response.isSuccessful) throw IllegalStateException("Could not download release checksum.")
                ApkIntegrity.expectedHash(response.body?.string().orEmpty())
                    ?: throw IllegalStateException("Release checksum was invalid.")
            }
            // Keyed by version code, not version name: the name is constant across builds,
            // so every download would otherwise reuse one cache path.
            val updateFile = File(context.cacheDir, "junction-update-${update.versionCode}.apk")
            // A download that already matches the published checksum is the update. Fetching
            // it again because the install dialog was dismissed, or the screen turned off
            // mid-way, is a second wait for bytes already sitting in the cache.
            val alreadyHaveIt = updateFile.exists() &&
                ApkIntegrity.sha256(updateFile).equals(checksum, ignoreCase = true)
            if (!alreadyHaveIt) {
                onStage(UpdateStage.Downloading(null))
                httpClient.newCall(Request.Builder().url(apkUrl).build()).execute().use { response ->
                    if (!response.isSuccessful) throw IllegalStateException("Could not download update APK.")
                    val body = response.body ?: throw IllegalStateException("Update APK was empty.")
                    body.byteStream().use { input -> copyReportingProgress(input, updateFile, body.contentLength(), onStage) }
                }
                onStage(UpdateStage.Verifying)
                if (!ApkIntegrity.sha256(updateFile).equals(checksum, ignoreCase = true)) {
                    updateFile.delete()
                    throw SecurityException("Downloaded APK did not match the published SHA-256 checksum.")
                }
            }
            // Verified bytes, but the wrong key still can't be installed over this app.
            // Checking here turns Android's blank "App not installed" into something the
            // owner can act on -- and stops a pointless trip through the system dialog.
            val installedKey = SigningIdentity.installed(context)
            val updateKey = SigningIdentity.ofApk(context, updateFile.absolutePath)
            if (installedKey != null && updateKey != null && !installedKey.equals(updateKey, ignoreCase = true)) {
                throw SignatureMismatch(installedKey, updateKey)
            }
            onStage(UpdateStage.Installing)
            // §4.2 rollback retention: back up the APK currently installed
            // (not the one we're about to install) before requesting the new
            // one, so a one-tap revert stays possible after this update lands.
            backUpCurrentlyInstalledApk()
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", updateFile)
            val intent = Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            Result.success(Unit)
        } catch (error: Exception) {
            Result.failure(error)
        }
    }

    /** True if a previous-version APK backup exists and a revert is possible. */
    fun hasPreviousVersionBackup(): Boolean = rollbackFile().exists()

    /** Re-installs the previous version's backed-up APK through the same consented installer flow. */
    suspend fun revertToPreviousVersion(): Result<Unit> = withContext(Dispatchers.IO) {
        val backup = rollbackFile()
        if (!backup.exists()) return@withContext Result.failure(IllegalStateException("No previous version is backed up."))
        try {
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", backup)
            val intent = Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            Result.success(Unit)
        } catch (error: Exception) {
            Result.failure(error)
        }
    }

    /**
     * Streams to [target], reporting whole percentage points only. Reporting every 8KB
     * buffer would post thousands of recompositions for a progress bar that can only show
     * a hundred distinct states.
     */
    private fun copyReportingProgress(
        input: java.io.InputStream,
        target: File,
        totalBytes: Long,
        onStage: (UpdateStage) -> Unit
    ) {
        var copied = 0L
        var lastPercent = -1
        target.outputStream().use { output ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                output.write(buffer, 0, read)
                copied += read
                if (totalBytes <= 0) continue
                val percent = ((copied * 100) / totalBytes).toInt().coerceIn(0, 100)
                if (percent == lastPercent) continue
                lastPercent = percent
                onStage(UpdateStage.Downloading(percent))
            }
        }
        if (copied == 0L) throw IllegalStateException("Update APK was empty.")
    }

    private fun rollbackFile(): File = File(context.cacheDir, "junction-previous-version.apk")

    private fun backUpCurrentlyInstalledApk() {
        runCatching {
            val currentApkPath = context.packageManager.getApplicationInfo(context.packageName, 0).sourceDir
            File(currentApkPath).copyTo(rollbackFile(), overwrite = true)
        }
    }
}