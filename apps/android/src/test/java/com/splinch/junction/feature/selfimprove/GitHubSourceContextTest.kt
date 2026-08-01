package com.splinch.junction.feature.selfimprove

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GitHubSourceContextTest {
    @Test
    fun `reference cache is bounded and consumed once`() {
        val cache = GitHubSourceContext()
        cache.rememberIndex(RepositorySourceIndex("apps/android", (1..500).map { "apps/android/src/File$it.kt" }))
        cache.rememberFile(RepositorySourceFile("apps/android/src/Large.kt", "x".repeat(30_000)))

        val snapshot = cache.consumeForPrompt()

        assertNotNull(snapshot)
        assertTrue(snapshot!!.length <= 36_000)
        assertTrue(snapshot.contains("apps/android/src/Large.kt"))
        assertEquals(24_000, snapshot.substringAfter("--- apps/android/src/Large.kt @ main ---\n").substringBeforeLast('\n').length)
        assertNull(cache.consumeForPrompt())
    }
}
