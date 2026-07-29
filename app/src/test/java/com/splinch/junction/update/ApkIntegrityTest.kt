package com.splinch.junction.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ApkIntegrityTest {
    @Test
    fun extractsAValidChecksumFromStandardReleaseText() {
        assertEquals(
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            ApkIntegrity.expectedHash("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  junction.apk")
        )
    }

    @Test
    fun rejectsMissingOrMalformedChecksums() {
        assertNull(ApkIntegrity.expectedHash("checksum unavailable"))
        assertNull(ApkIntegrity.expectedHash("abcd"))
    }
}