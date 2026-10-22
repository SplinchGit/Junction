package com.splinch.junction.data.sync.lan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Test

class PendingNethraRequestIdsTest {
    @Test fun `uncertain mutation keeps its id across client recreation without saving payload`() {
        val durable = mutableMapOf<String, String>()
        fun client() = PendingNethraRequestIds(
            load = { durable[it] },
            save = { key, id -> durable[key] = id },
            remove = { durable.remove(it) }
        )
        val payload = mapOf("goal" to "Private housing objective")
        val first = client().getOrCreate("nethra.create", payload)
        val retried = client().getOrCreate("nethra.create", payload)
        assertEquals(first.second, retried.second)
        assertFalse(durable.keys.any { it.contains("Private housing objective") })
        client().clear(first.first)
        assertNotEquals(first.second, client().getOrCreate("nethra.create", payload).second)
    }
}
