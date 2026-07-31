package com.splinch.junction.update

import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.os.Build
import java.security.MessageDigest

/**
 * The certificate an APK is signed with -- the single thing that decides whether an update
 * installs *over* Junction or can only replace it.
 *
 * Android refuses to install a package whose signing certificate differs from the one
 * already installed, and the only way through is an uninstall. That wipes the app's data
 * directory and, worse, the Android Keystore entries behind `KeyStorage`, so every API key
 * has to be entered again. The system's own message for this is "App not installed",
 * which explains none of it.
 *
 * So Junction checks first and says so in plain words, and shows its own fingerprint in
 * Settings, because "which key is this build signed with" is otherwise something an owner
 * can only answer with `adb` and `keytool` on a PC.
 */
object SigningIdentity {

    /** SHA-256 of the certificate the installed Junction was signed with. */
    fun installed(context: Context): String? = fingerprintOf(signaturesOfInstalled(context))

    /** SHA-256 of the certificate an APK file on disk is signed with. */
    fun ofApk(context: Context, apkPath: String): String? = fingerprintOf(signaturesOfApk(context, apkPath))

    /**
     * Enough of a fingerprint to compare by eye without filling the screen. Collisions
     * across the two or three keys this project has ever used are not a concern; the
     * comparison that matters is done on the full value.
     */
    fun short(fingerprint: String?): String = fingerprint?.take(12) ?: "unknown"

    private fun signaturesOfInstalled(context: Context): Array<Signature>? = runCatching {
        val manager = context.packageManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            manager.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
                .signingInfo
                ?.apkContentsSigners
        } else {
            @Suppress("DEPRECATION")
            manager.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES).signatures
        }
    }.getOrNull()

    private fun signaturesOfApk(context: Context, apkPath: String): Array<Signature>? = runCatching {
        val manager = context.packageManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            manager.getPackageArchiveInfo(apkPath, PackageManager.GET_SIGNING_CERTIFICATES)
                ?.signingInfo
                ?.apkContentsSigners
        } else {
            @Suppress("DEPRECATION")
            manager.getPackageArchiveInfo(apkPath, PackageManager.GET_SIGNATURES)?.signatures
        }
    }.getOrNull()

    /**
     * The first signer only. Junction is signed by exactly one key, and a build that
     * somehow carried several would be a different question than the one being asked here.
     */
    private fun fingerprintOf(signatures: Array<Signature>?): String? {
        val signature = signatures?.firstOrNull() ?: return null
        val digest = MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())
        return digest.joinToString("") { "%02x".format(it) }
    }
}
