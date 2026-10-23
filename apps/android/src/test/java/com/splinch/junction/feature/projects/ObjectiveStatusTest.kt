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
}
