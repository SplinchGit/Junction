package com.splinch.junction.platform

import org.junit.Assert.assertEquals
import org.junit.Test

class ShizukuCapabilityTest {
    @Test
    fun `disabled owner preference always fails closed`() {
        assertEquals(
            ShizukuStatus.DISABLED,
            ShizukuCapability.resolveStatus(
                ownerEnabled = false,
                serviceRunning = true,
                permissionGranted = true
            )
        )
    }

    @Test
    fun `service and permission states resolve independently`() {
        assertEquals(
            ShizukuStatus.NOT_RUNNING,
            ShizukuCapability.resolveStatus(true, serviceRunning = false, permissionGranted = true)
        )
        assertEquals(
            ShizukuStatus.PERMISSION_REQUIRED,
            ShizukuCapability.resolveStatus(true, serviceRunning = true, permissionGranted = false)
        )
        assertEquals(
            ShizukuStatus.AVAILABLE,
            ShizukuCapability.resolveStatus(true, serviceRunning = true, permissionGranted = true)
        )
    }
}