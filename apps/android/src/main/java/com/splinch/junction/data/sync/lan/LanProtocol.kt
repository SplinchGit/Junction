package com.splinch.junction.data.sync.lan

import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets

/** Versioned, bounded wire representation shared by discovery, auth, and streaming. */
object LanProtocol {
    const val VERSION = 1
    const val SERVICE_TYPE = "_junction._tcp."
    const val MAX_FRAME_BYTES = 64 * 1024
    const val MAX_REQUEST_ID = 160
    private const val MAX_TYPE = 64
    private const val MAX_PAIRING_BYTES = 4096

    data class Envelope(
        val type: String,
        val requestId: String? = null,
        val payload: Map<String, Any?> = emptyMap(),
        val protocolVersion: Int = VERSION
    )

    data class PairingCode(
        val instanceId: String,
        val host: String,
        val port: Int,
        val certificateSha256: String,
        val token: String,
        val expiresAtMillis: Long
    ) {
        fun encode(): String {
            val json = JSONObject().apply {
                put("instanceId", instanceId); put("host", host); put("port", port)
                put("certificateSha256", certificateSha256); put("token", token)
                put("expiresAtMillis", expiresAtMillis)
            }
            return "JLP1." + java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(json.toString().toByteArray(StandardCharsets.UTF_8))
        }
    }

    fun encode(envelope: Envelope): String {
        require(envelope.protocolVersion == VERSION)
        require(envelope.type.length in 1..MAX_TYPE)
        require(envelope.requestId == null || envelope.requestId.matches(REQUEST_ID_PATTERN))
        val json = JSONObject().apply {
            put("protocolVersion", VERSION); put("type", envelope.type)
            envelope.requestId?.let { put("requestId", it) }
            put("payload", JSONObject(envelope.payload))
        }
        return json.toString().also { require(it.toByteArray(StandardCharsets.UTF_8).size <= MAX_FRAME_BYTES) }
    }

    fun decode(raw: String): Envelope? = runCatching {
        require(raw.toByteArray(StandardCharsets.UTF_8).size <= MAX_FRAME_BYTES)
        val json = JSONObject(raw)
        require(json.optInt("protocolVersion", -1) == VERSION)
        val type = json.optString("type", "")
        require(type.isNotBlank() && type.length <= MAX_TYPE)
        val requestId = if (json.has("requestId")) json.optString("requestId", "") else null
        require(requestId == null || requestId.matches(REQUEST_ID_PATTERN))
        val payload = if (json.has("payload")) json.optJSONObject("payload")?.toMap().orEmpty() else emptyMap()
        Envelope(type, requestId, payload)
    }.getOrNull()

    fun parsePairingCode(raw: String, nowMillis: Long = System.currentTimeMillis()): PairingCode? = runCatching {
        require(raw.toByteArray(StandardCharsets.UTF_8).size <= MAX_PAIRING_BYTES)
        require(raw.isNotEmpty() && raw == raw.trim() && raw.startsWith("JLP1."))
        val encoded = raw.removePrefix("JLP1.")
        require(encoded.isNotEmpty() && encoded.matches(Regex("[A-Za-z0-9_-]+")))
        val json = JSONObject(String(java.util.Base64.getUrlDecoder().decode(encoded), StandardCharsets.UTF_8))
        val fields = json.keys().asSequence().toSet()
        require(fields == setOf("instanceId", "host", "port", "certificateSha256", "token", "expiresAtMillis"))
        val cert = json.getString("certificateSha256").lowercase()
        require(cert.matches(Regex("[0-9a-f]{64}")))
        val result = PairingCode(json.getString("instanceId"), json.getString("host"), json.getInt("port"), cert, json.getString("token"), json.getLong("expiresAtMillis"))
        require(result.instanceId.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        require(result.host.matches(Regex("[A-Za-z0-9_.:-]{1,253}")))
        require(result.token.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        require(result.port in 1..65535 && result.expiresAtMillis > nowMillis)
        result
    }.getOrNull()

    fun authMessage(nonce: String, instanceId: String, deviceId: String): ByteArray =
        "junction-lan-v1\n$nonce\n$instanceId\n$deviceId".toByteArray(StandardCharsets.UTF_8)

    fun persistentTrust(code: PairingCode): PairingCode = code.copy(token = "", expiresAtMillis = Long.MAX_VALUE)

    private fun JSONObject.toMap(): Map<String, Any?> = keys().asSequence().associateWith { key ->
        when (val value = get(key)) {
            is JSONObject -> value.toMap()
            is JSONArray -> value.toList()
            JSONObject.NULL -> null
            else -> value
        }
    }

    private fun JSONArray.toList(): List<Any?> = (0 until length()).map { index ->
        when (val value = get(index)) {
            is JSONObject -> value.toMap()
            is JSONArray -> value.toList()
            JSONObject.NULL -> null
            else -> value
        }
    }

    private val REQUEST_ID_PATTERN = Regex("[A-Za-z0-9_-]{1,$MAX_REQUEST_ID}")
}

enum class LanConnectionMode(val stored: String) {
    WIFI("wifi"), FIREBASE("firebase");

    companion object {
        fun fromStored(value: String?): LanConnectionMode = when (value) {
            "firebase", "remote" -> FIREBASE
            else -> WIFI
        }
    }
}
