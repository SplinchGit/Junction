package com.splinch.junction.update

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

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

/** Downloads only releases with an accompanying checksum, then delegates consent to Android's installer. */
class UpdateInstaller(
    private val context: Context,
    private val httpClient: OkHttpClient = OkHttpClient()
) {
    suspend fun downloadAndRequestInstall(update: UpdateInfo): Result<Unit> = withContext(Dispatchers.IO) {
        val apkUrl = update.apkUrl?.takeIf { it.startsWith("https://") }
            ?: return@withContext Result.failure(IllegalArgumentException("This release has no verified APK asset."))
        val checksumUrl = update.sha256Url?.takeIf { it.startsWith("https://") }
            ?: return@withContext Result.failure(IllegalArgumentException("This release has no SHA-256 checksum asset."))
        try {
            val checksum = httpClient.newCall(Request.Builder().url(checksumUrl).build()).execute().use { response ->
                if (!response.isSuccessful) throw IllegalStateException("Could not download release checksum.")
                ApkIntegrity.expectedHash(response.body?.string().orEmpty())
                    ?: throw IllegalStateException("Release checksum was invalid.")
            }
            // Keyed by version code, not version name: the name is constant across builds,
            // so every download would otherwise reuse one cache path.
            val updateFile = File(context.cacheDir, "junction-update-${update.versionCode}.apk")
            httpClient.newCall(Request.Builder().url(apkUrl).build()).execute().use { response ->
                if (!response.isSuccessful) throw IllegalStateException("Could not download update APK.")
                response.body?.byteStream()?.use { input -> updateFile.outputStream().use(input::copyTo) }
                    ?: throw IllegalStateException("Update APK was empty.")
            }
            if (!ApkIntegrity.sha256(updateFile).equals(checksum, ignoreCase = true)) {
                updateFile.delete()
                throw SecurityException("Downloaded APK did not match the published SHA-256 checksum.")
            }
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

    private fun rollbackFile(): File = File(context.cacheDir, "junction-previous-version.apk")

    private fun backUpCurrentlyInstalledApk() {
        runCatching {
            val currentApkPath = context.packageManager.getApplicationInfo(context.packageName, 0).sourceDir
            File(currentApkPath).copyTo(rollbackFile(), overwrite = true)
        }
    }
}