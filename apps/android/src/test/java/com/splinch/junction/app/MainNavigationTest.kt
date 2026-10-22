package com.splinch.junction.app

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class MainNavigationTest {
    @Test
    fun `objectives remain reachable from chat without occupying bottom navigation`() {
        val activity = File("src/main/java/com/splinch/junction/app/MainActivity.kt").readText()
        val chat = File("src/main/java/com/splinch/junction/feature/chat/ui/ChatScreen.kt").readText()
        assertTrue(activity.contains("selectedTab = JunctionTab.NETHRA"))
        assertTrue(activity.contains("JunctionTab.NETHRA -> ProjectsScreen("))
        assertTrue(chat.contains("Nethra objectives"))
        assertTrue(chat.contains("onOpenObjectives()"))
        assertTrue(!activity.contains("label = { Text(\"Nethra\") }"))
    }
}
