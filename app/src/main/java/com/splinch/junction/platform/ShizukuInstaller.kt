package com.splinch.junction.platform

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import com.splinch.junction.MainActivity
import java.io.File

sealed class ShizukuInstallResult {
    data class Started(val sessionId: Int) : ShizukuInstallResult()
    data class Failed(val reason: String, val diagnostic: String) : ShizukuInstallResult()
}

/**
 * §4.1 Shizuku-gated install. Verified against the real `dev.rikka.shizuku:api`
 * artifact in this project (v13.1.5): `Shizuku.newProcess(...)` is `private`
 * in this version and not callable, and a genuinely *silent* (no system
 * dialog) commit requires driving the platform's hidden `IPackageInstaller`
 * AIDL interface directly through `ShizukuBinderWrapper` — that needs the
 * platform's `.aidl` contracts vendored into this module and, critically, a
 * real device to validate the transaction against, which isn't available in
 * this environment. Fabricating that binding from memory risks a silent
 * wrong-method-call rather than a compile error, which is worse than not
 * shipping it.
 *
 * What this class does instead, and does correctly: the standard *public*
 * `PackageInstaller` session flow (`SessionParams(MODE_FULL_INSTALL)` →
 * `createSession` → `openWrite` → `commit`), gated behind [ShizukuCapability]
 * being AVAILABLE, tier DESTRUCTIVE. `commit()` here still surfaces Android's
 * own install-confirmation UI — the same as [com.splinch.junction.update.UpdateInstaller] —
 * until the shell-identity AIDL bridge above is added and verified on a real
 * device. That gap is called out explicitly rather than silently claimed.
 */
class ShizukuInstaller(private val context: Context) {
    fun install(apk: File, ownerEnabled: Boolean): ShizukuInstallResult {
        val status = ShizukuCapability.status(ownerEnabled)
        if (status != ShizukuStatus.AVAILABLE) {
            return ShizukuInstallResult.Failed(
                reason = "Shizuku not available ($status)",
                diagnostic = diagnosticFor(status)
            )
        }
        if (!apk.exists() || apk.length() == 0L) {
            return ShizukuInstallResult.Failed("APK not found", "Expected a downloaded, verified APK at ${apk.absolutePath}.")
        }

        return runCatching {
            val installer = context.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
            val sessionId = installer.createSession(params)
            val session = installer.openSession(sessionId)
            session.use { s ->
                apk.inputStream().use { input ->
                    s.openWrite("junction_update", 0, apk.length()).use { output ->
                        input.copyTo(output)
                        s.fsync(output)
                    }
                }
                // See class doc: without the shell-identity AIDL bridge, this
                // commit still surfaces the system install-confirmation UI.
                val statusReceiver = PendingIntent.getActivity(
                    context,
                    sessionId,
                    Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                s.commit(statusReceiver.intentSender)
            }
            ShizukuInstallResult.Started(sessionId)
        }.getOrElse { error ->
            ShizukuInstallResult.Failed("Install session failed", error.message ?: "Unknown error")
        }
    }

    private fun diagnosticFor(status: ShizukuStatus): String = when (status) {
        ShizukuStatus.DISABLED -> "Enable Shizuku access in Settings > Privileged access first."
        ShizukuStatus.NOT_RUNNING ->
            "Shizuku isn't running. On non-rooted devices it must be restarted after every reboot " +
                "(Settings > Developer options > Wireless debugging, then start Shizuku via ADB/wireless pairing)."
        ShizukuStatus.PERMISSION_REQUIRED ->
            "Shizuku is running but hasn't granted Junction permission yet. Approve the Shizuku permission prompt."
        ShizukuStatus.AVAILABLE -> "" // unreachable here
    } + oemNote()

    private fun oemNote(): String = if (Build.MANUFACTURER.contains("xiaomi", ignoreCase = true) ||
        Build.MANUFACTURER.contains("redmi", ignoreCase = true)
    ) {
        " Note: MIUI/HyperOS devices often additionally require enabling \"USB debugging (Security settings)\" " +
            "and disabling MIUI optimization in Developer options, or Shizuku may fail silently."
    } else {
        ""
    }
}
