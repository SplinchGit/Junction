package com.splinch.junction.data.sync.lan

import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

/** Persists only a digest of the request and its id, so uncertain mutations stay idempotent. */
internal class PendingNethraRequestIds(
    private val load: (String) -> String?,
    private val save: (String, String) -> Unit,
    private val remove: (String) -> Unit,
    private val newId: () -> String = { UUID.randomUUID().toString() }
) {
    @Synchronized
    fun getOrCreate(type: String, payload: Map<String, Any?>): Pair<String, String> {
        val binding = "nethra-request-${sha256(type + "\n" + canonical(payload))}"
        load(binding)?.let { return binding to it }
        val id = newId()
        save(binding, id)
        return binding to id
    }

    @Synchronized
    fun clear(binding: String) = remove(binding)

    private fun canonical(value: Any?): String = when (value) {
        null -> "null"
        is String -> JSONObject.quote(value)
        is Number, is Boolean -> value.toString()
        is Map<*, *> -> value.entries
            .map { (key, item) -> (key as? String ?: error("Nethra payload keys must be strings")) to item }
            .sortedBy { it.first }
            .joinToString(prefix = "{", postfix = "}", separator = ",") { (key, item) -> "${JSONObject.quote(key)}:${canonical(item)}" }
        is Iterable<*> -> value.joinToString(prefix = "[", postfix = "]", separator = ",") { canonical(it) }
        else -> JSONObject().put("value", value).get("value").toString()
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
}
