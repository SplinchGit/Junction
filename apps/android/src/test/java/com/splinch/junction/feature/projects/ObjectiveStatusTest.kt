package com.splinch.junction.feature.projects

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ObjectiveStatusTest {
    private val now = 1_800_000_000_000L

    @Test
    fun cachedObjectiveStateKeepsItsTimestampAndProgressAcrossRestart() {
        val saved = ObjectiveSnapshotCodec.encode(now, listOf(mapOf("id" to "task-1", "mode" to "ONGOING", "progress" to mapOf("done" to 1, "total" to 3))))
        val restored = ObjectiveSnapshotCodec.decode(saved)
        assertEquals(now, restored.asOf)
        assertEquals("ONGOING", restored.objectives[0]["mode"])
        assertEquals(1, (restored.objectives[0]["progress"] as Map<*, *>)["done"])
    }

    @Test
    fun runningObjectiveIsGreenWhateverItsStoredStatus() {
        val status = ObjectiveStatus.of(mapOf("status" to "ACTIVE", "live" to true), now)
        assertEquals(ObjectiveLight.GREEN, status.light)
        assertEquals("Working on it now", status.label)
    }

    @Test
    fun inProgressStatesAreAmber() {
        assertEquals(ObjectiveLight.AMBER, ObjectiveStatus.of(mapOf("status" to "CREATED"), now).light)
        assertEquals("Needs your input", ObjectiveStatus.of(mapOf("status" to "WAITING_FOR_USER"), now).label)
        val sleeping = ObjectiveStatus.of(mapOf("status" to "SLEEPING", "nextWakeAt" to now + 600_000), now)
        assertEquals(ObjectiveLight.AMBER, sleeping.light)
        assertTrue(sleeping.label.startsWith("Next check"))
    }

    @Test
    fun aDailyBudgetPauseIsShownAsWaitingForReset() {
        val status = ObjectiveStatus.of(mapOf("status" to "SLEEPING", "nextWakeAt" to now + 600_000,
            "tracking" to mapOf("waitingFor" to mapOf("kind" to "budget"))), now)
        assertTrue(status.label.startsWith("Daily limit"))
    }

    @Test
    fun endedObjectivesAreRedAndPausedOrBlockedAreGrey() {
        for (status in listOf("COMPLETED", "CANCELLED", "FAILED")) {
            val result = ObjectiveStatus.of(mapOf("status" to status), now)
            assertEquals(ObjectiveLight.RED, result.light); assertTrue(result.ended)
        }
        assertEquals(ObjectiveLight.GREY, ObjectiveStatus.of(mapOf("status" to "PAUSED"), now).light)
        assertEquals(ObjectiveLight.GREY, ObjectiveStatus.of(mapOf("status" to "BLOCKED"), now).light)
    }

    @Test
    fun stepLineShowsWhereNethraIs() {
        assertEquals("Step 2 of 3: Summarise", ObjectiveStatus.stepLine(mapOf("step" to "Summarise", "progress" to mapOf("done" to 1, "total" to 3))))
        assertEquals("3 of 3 steps done", ObjectiveStatus.stepLine(mapOf("step" to null, "progress" to mapOf("done" to 3, "total" to 3))))
        assertEquals("3 of 3 steps this cycle", ObjectiveStatus.stepLine(mapOf("mode" to "ONGOING", "step" to null, "progress" to mapOf("done" to 3, "total" to 3))))
        assertNull(ObjectiveStatus.stepLine(mapOf("progress" to mapOf("done" to 0, "total" to 0))))
    }

    @Test
    fun headerShowsTheBrightestOpenLightAndCount() {
        val list = listOf(
            mapOf("status" to "SLEEPING", "nextWakeAt" to now + 1),
            mapOf("status" to "ACTIVE", "live" to true),
            mapOf("status" to "COMPLETED")
        )
        assertEquals(ObjectiveLight.GREEN to 2, ObjectiveStatus.overall(list, now))
        assertNull(ObjectiveStatus.overall(listOf(mapOf("status" to "COMPLETED")), now))
    }

    @Test
    fun conversationStripOnlyShowsAssignedObjectives() {
        val tasks = listOf(mapOf("id" to "one", "conversationId" to "chat-a"), mapOf("id" to "two", "conversationId" to "chat-b"), mapOf("id" to "three", "conversationId" to "chat-a"))
        assertEquals(listOf("one", "three"), ObjectiveStatus.forConversation(tasks, "chat-a").map { it["id"] })
        assertTrue(ObjectiveStatus.forConversation(tasks, "new-chat").isEmpty())
    }

    @Test
    fun performanceLinesKeepSampleCountsAndMissingMeasurementsHonest() {
        val empty = ObjectivePerformance.lines(mapOf("objective" to mapOf("sampleCount" to 0), "chat" to mapOf("sampleCount" to 0)))
        assertTrue(empty[0].contains("No measured samples"))
        assertTrue(empty[1].contains("No measured samples"))
        val measured = ObjectivePerformance.lines(mapOf(
            "objective" to mapOf("sampleCount" to 2, "medianInferenceMs" to 2500),
            "chat" to mapOf("sampleCount" to 3, "medianResponseMs" to 4000, "medianTokensPerSecond" to 18)
        ))
        assertTrue(measured[0].contains("2 task model calls"))
        assertTrue(measured[0].contains("2.5 s"))
        assertTrue(measured[1].contains("3 local chat replies"))
        assertTrue(measured[1].contains("18 tokens/s"))
    }
}
