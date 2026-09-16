package com.splinch.junction.data.sync.firebase

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PairedSyncRecordsTest {
    @Test fun longUnicodeMessageSurvivesOutOfOrderChunksAndRestart() {
        val text = "Large 😀 漢字\n".repeat(6000)
        val value = JSONObject().put("id","message").put("role","assistant").put("content",text).put("createdAt",1).put("provenance","JUNCTION")
        val records = PairedSyncRecords.messageRecords("conversation", value)
        assertTrue(records.size > 1)
        var parts = JSONObject()
        var completed: String? = null
        for (record in records.reversed()) {
            assertTrue(record.toString().toByteArray(Charsets.UTF_8).size < 35_000)
            completed = PairedSyncRecords.addPart(parts, record.getJSONObject("value"))
            parts = JSONObject(parts.toString()) // persisted state restored after a restart
        }
        assertEquals(text, completed)
    }
}
