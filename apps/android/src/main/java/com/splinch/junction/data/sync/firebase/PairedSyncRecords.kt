package com.splinch.junction.data.sync.firebase

import org.json.JSONObject

internal object PairedSyncRecords {
    fun messageRecords(conversationId: String, value: JSONObject): List<JSONObject> {
        val content = value.getString("content")
        if (content.length <= 4000) return listOf(JSONObject().put("kind", "message").put("conversationId", conversationId).put("value", value))
        val chunks = mutableListOf<String>()
        var start = 0
        while (start < content.length) {
            var end = minOf(start + 4000, content.length)
            if (end < content.length && Character.isHighSurrogate(content[end - 1])) end--
            chunks.add(content.substring(start, end)); start = end
        }
        return chunks.mapIndexed { index, chunk ->
            JSONObject().put("kind", "message_part").put("conversationId", conversationId)
                .put("value", JSONObject(value.toString()).put("content", chunk).put("index", index).put("count", chunks.size))
        }
    }

    fun addPart(parts: JSONObject, value: JSONObject): String? {
        val count = value.getInt("count"); val index = value.getInt("index")
        require(count in 1..1000 && index in 0 until count && value.getString("content").length <= 4000)
        parts.put(index.toString(), value.getString("content"))
        if ((0 until count).any { !parts.has(it.toString()) }) return null
        return (0 until count).joinToString("") { parts.getString(it.toString()) }
    }
}
