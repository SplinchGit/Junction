package com.splinch.junction.chat.tools

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PostConditionVerifierTest {
    @Test
    fun `foreground package match requires an exact nonblank package name`() {
        assertTrue(PostConditionVerifier.packageMatchesExpected("com.example.calendar", "com.example.calendar"))
        assertFalse(PostConditionVerifier.packageMatchesExpected("com.example.calendar", "com.example.mail"))
        assertFalse(PostConditionVerifier.packageMatchesExpected("", "com.example.calendar"))
        assertFalse(PostConditionVerifier.packageMatchesExpected("com.example.calendar", null))
    }
}