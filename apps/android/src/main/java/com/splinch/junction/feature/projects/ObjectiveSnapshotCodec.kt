package com.splinch.junction.feature.projects

import org.json.JSONArray
import org.json.JSONObject

data class ObjectiveSnapshot(val asOf: Long, val objectives: List<Map<String, Any?>>)

/** Private, bounded cache for showing the last verified PC state while offline. */
object ObjectiveSnapshotCodec {
    private fun value(input: Any?): Any? = when (input) {
        is JSONObject -> input.keys().asSequence().associateWith { key -> value(input.get(key)) }
        is JSONArray -> (0 until input.length()).map { value(input.get(it)) }
        JSONObject.NULL -> null
        else -> input
    }
    fun encode(asOf: Long, objectives: List<Map<*, *>>): String = JSONObject()
        .put("asOf", asOf)
        .put("objectives", JSONArray(objectives.take(100).map { JSONObject(it) }))
        .toString()

    fun decode(text: String): ObjectiveSnapshot {
        val body = JSONObject(text)
        val asOf = body.getLong("asOf")
        require(asOf > 0)
        val items = body.getJSONArray("objectives")
        require(items.length() <= 100)
        return ObjectiveSnapshot(asOf, (0 until items.length()).map { value(items.getJSONObject(it)) as Map<String, Any?> })
    }
}
