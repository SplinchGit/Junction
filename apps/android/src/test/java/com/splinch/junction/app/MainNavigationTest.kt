package com.splinch.junction.app

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Test

class MainNavigationTest {
    @Test
    fun `bottom navigation does not expose Work`() {
        val source = File("src/main/java/com/splinch/junction/app/MainActivity.kt").readText()
        assertFalse(source.contains("Text(\"Work\")"))
        assertFalse(source.contains("JunctionTab.PROJECTS"))
    }
}
