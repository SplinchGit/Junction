package com.splinch.junction.app

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class MainNavigationTest {
    @Test
    fun `tasks have their own bottom tab, audit moves to the drawer, and chat keeps the task sheet`() {
        val activity = File("src/main/java/com/splinch/junction/app/MainActivity.kt").readText()
        val chat = File("src/main/java/com/splinch/junction/feature/chat/ui/ChatScreen.kt").readText()
        assertTrue(activity.contains("label = { Text(\"Tasks\") }"))
        assertTrue(!activity.contains("label = { Text(\"Audit\") }"))
        assertTrue(activity.contains("JunctionWorkspace.AUDIT -> WorkspaceScreen("))
        assertTrue(activity.contains("JunctionTab.TASKS ->"))
        assertTrue(chat.contains("onOpenAudit"))
        // The in-chat task sheet stays for the linked chat's quick view.
        assertTrue(chat.contains("ModalBottomSheet"))
        assertTrue(chat.contains("NethraPanel("))
    }
}
