package com.splinch.junction.data.sync.lan

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceCommandCancellationTest {
    @Test
    fun leavingTheScreenDoesNotTurnCancellationIntoACommandFailure() = runTest {
        var cancelled = false
        try {
            captureDeviceCommandResult<Unit> { throw CancellationException("screen closed") }
        } catch (_: CancellationException) {
            cancelled = true
        }
        assertTrue(cancelled)
    }

    @Test
    fun ordinaryHostFailureRemainsAReportableResult() = runTest {
        val result = captureDeviceCommandResult<Unit> { throw IllegalStateException("host offline") }
        assertTrue(result.isFailure)
        assertEquals("host offline", result.exceptionOrNull()?.message)
    }
}
