package com.splinch.junction.feature.projects

import androidx.test.platform.app.InstrumentationRegistry
import androidx.room.Room
import com.splinch.junction.app.MainActivity
import com.splinch.junction.data.database.JunctionDatabase
import com.splinch.junction.feature.feed.model.*
import com.splinch.junction.feature.scheduler.NotificationHelper
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class TaskNotificationTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun ownerActionsHaveDistinctIntentTargetsAndSurviveLocalRestart() {
        val id = java.util.UUID.randomUUID().toString()
        val snooze = NotificationHelper.taskChoiceIntent(context, id, "event", "host", "SNOOZE")
        val dismiss = NotificationHelper.taskChoiceIntent(context, id, "event", "host", "DISMISS")
        assertNotEquals(snooze.data, dismiss.data)
        assertEquals(com.splinch.junction.feature.notification.NotificationTapReceiver::class.java.name, snooze.component?.className)
        assertFalse(snooze.getBooleanExtra(MainActivity.EXTRA_OPEN_VOICE, false))
        val prefix = "action-test-${java.util.UUID.randomUUID()}-"
        val isolated = object : android.content.ContextWrapper(context) {
            override fun getApplicationContext(): android.content.Context = this
            override fun getSharedPreferences(name: String, mode: Int): android.content.SharedPreferences = context.getSharedPreferences(prefix + name, mode)
        }
        try {
            val first = com.splinch.junction.data.sync.lan.DeviceCommandSync(isolated)
            assertTrue(first.queueNotificationAction(id, "event", "host", "SNOOZE"))
            val reopened = com.splinch.junction.data.sync.lan.DeviceCommandSync(isolated)
            assertFalse(reopened.queueNotificationAction(id, "event", "host", "DISMISS"))
            assertEquals("SNOOZE", reopened.pendingNotificationActions().single().getString("action"))
        } finally {
            isolated.getSharedPreferences("junction_device_commands", android.content.Context.MODE_PRIVATE).edit().clear().commit()
        }
    }

    @Test fun taskTargetsAreDistinctAndNeverRequestMicrophone() {
        val first = NotificationHelper.taskIntent(context, "task-1")
        val second = NotificationHelper.taskIntent(context, "task-2")
        assertNotEquals(first.data, second.data)
        assertEquals("task-1", first.getStringExtra(MainActivity.EXTRA_TASK_ID))
        assertFalse(first.getBooleanExtra(MainActivity.EXTRA_OPEN_VOICE, false))
        assertEquals(MainActivity::class.java.name, first.component?.className)
        val review = NotificationHelper.taskIntent(context, "task-1", "approval-1")
        assertNotEquals(first.data, review.data)
        assertNotEquals(review.data, NotificationHelper.taskIntent(context, "task-1", "approval-2").data)
        assertEquals("approval-1", review.getStringExtra(MainActivity.EXTRA_APPROVAL_ID))
        assertFalse(review.getBooleanExtra(MainActivity.EXTRA_OPEN_VOICE, false))
        val reply = NotificationHelper.taskIntent(context, "task-1", reply = true)
        assertNotEquals(first.data, reply.data)
        assertNotEquals(review.data, reply.data)
        assertTrue(reply.getBooleanExtra(MainActivity.EXTRA_REPLY_TO_TASK, false))
        assertFalse(reply.getBooleanExtra(MainActivity.EXTRA_OPEN_VOICE, false))
        val invitation = NotificationHelper.taskIntent(context, "task-1", reply = true, invitationQuestionId = "question-1", invitationCommandId = "delivery-1")
        assertNotEquals(reply.data, invitation.data)
        assertEquals("question-1", invitation.getStringExtra(MainActivity.EXTRA_INVITATION_QUESTION_ID))
        assertEquals("delivery-1", invitation.getStringExtra(MainActivity.EXTRA_INVITATION_COMMAND_ID))
        assertFalse(invitation.getBooleanExtra(MainActivity.EXTRA_OPEN_VOICE, false))
    }

    @Test fun duplicateDeliveryKeepsDismissedHistory() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(context, JunctionDatabase::class.java).build()
        try {
            val dao = db.feedDao()
            val item = FeedItemEntity(id = "notification-event", source = "Nethra", packageName = context.packageName,
                category = FeedCategory.PROJECTS, title = "Funding", body = "Needs input", timestamp = 1,
                priority = 8, status = FeedStatus.NEW, threadKey = "nethra-task:task-1", actionHint = "open_task")
            assertTrue(dao.insertNotificationOnce(item) != -1L)
            dao.archive(item.id, 2)
            dao.markNotificationSeen(item.id, 3)
            assertEquals(-1L, dao.insertNotificationOnce(item))
            assertEquals(FeedStatus.ARCHIVED, dao.getById(item.id)?.status)
            assertEquals(1, dao.countAll())
        } finally { db.close() }
    }
}
