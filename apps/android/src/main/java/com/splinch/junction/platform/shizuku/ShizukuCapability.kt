package com.splinch.junction.platform.shizuku

import android.content.pm.PackageManager
import rikka.shizuku.Shizuku

enum class ShizukuStatus {
    DISABLED,
    NOT_RUNNING,
    PERMISSION_REQUIRED,
    AVAILABLE
}

object ShizukuCapability {
    private const val REQUEST_CODE = 4_261

    fun status(ownerEnabled: Boolean): ShizukuStatus {
        val serviceRunning = runCatching { Shizuku.pingBinder() }.getOrDefault(false)
        val permissionGranted = serviceRunning && runCatching {
            Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED
        }.getOrDefault(false)
        return resolveStatus(ownerEnabled, serviceRunning, permissionGranted)
    }

    fun requestPermission(ownerEnabled: Boolean): Boolean {
        if (!ownerEnabled || status(ownerEnabled) != ShizukuStatus.PERMISSION_REQUIRED) return false
        return runCatching {
            Shizuku.requestPermission(REQUEST_CODE)
            true
        }.getOrDefault(false)
    }

    internal fun resolveStatus(
        ownerEnabled: Boolean,
        serviceRunning: Boolean,
        permissionGranted: Boolean
    ): ShizukuStatus = when {
        !ownerEnabled -> ShizukuStatus.DISABLED
        !serviceRunning -> ShizukuStatus.NOT_RUNNING
        !permissionGranted -> ShizukuStatus.PERMISSION_REQUIRED
        else -> ShizukuStatus.AVAILABLE
    }
}