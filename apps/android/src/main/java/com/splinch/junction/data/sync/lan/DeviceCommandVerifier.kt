package com.splinch.junction.data.sync.lan

import org.json.JSONObject
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.PublicKey
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

/**
 * Accepts a PC device command only when it is signed by the exact TLS key this
 * phone pinned at pairing, addressed to this phone by the paired PC instance,
 * unexpired, and never seen before. Fails closed on anything else.
 */
object DeviceCommandVerifier {
    val KINDS = mapOf("STATUS" to "READ", "SMOKE_TEST" to "READ", "COLLECT_LOGS" to "READ", "CONFIRM_INSTALL" to "CONFIRM")
    private const val MAX_BODY = 8_000
    private const val MAX_LIFETIME_MS = 24 * 3_600_000L
    private const val CLOCK_SKEW_MS = 5 * 60_000L

    data class Command(
        val id: String,
        val kind: String,
        val tier: String,
        val requestedBy: String,
        val args: JSONObject,
        val createdAt: Long,
        val expiresAt: Long
    )

    sealed class Outcome {
        data class Accepted(val command: Command) : Outcome()
        data class Refused(val id: String?, val reason: String) : Outcome()
    }

    fun verify(
        envelope: Map<String, Any?>,
        pinnedSha256: String,
        expectedInstanceId: String,
        deviceId: String,
        now: Long,
        seen: (String) -> Boolean
    ): Outcome {
        val body = envelope["body"] as? String ?: return Outcome.Refused(null, "missing body")
        val signature = envelope["signature"] as? String ?: return Outcome.Refused(null, "missing signature")
        val spkiText = envelope["spki"] as? String ?: return Outcome.Refused(null, "missing key")
        if (body.length > MAX_BODY || signature.length > 2_000 || spkiText.length > 2_000) return Outcome.Refused(null, "oversized command")
        val spki = runCatching { Base64.getDecoder().decode(spkiText) }.getOrNull() ?: return Outcome.Refused(null, "invalid key encoding")
        val pin = runCatching { pinnedSha256.chunked(2).map { it.toInt(16).toByte() }.toByteArray() }.getOrNull()
        if (pin == null || pin.size != 32 || !MessageDigest.isEqual(MessageDigest.getInstance("SHA-256").digest(spki), pin)) {
            return Outcome.Refused(null, "key does not match the paired PC")
        }
        val key = publicKey(spki) ?: return Outcome.Refused(null, "unsupported key")
        val valid = runCatching {
            Signature.getInstance(if (key.algorithm == "EC") "SHA256withECDSA" else "SHA256withRSA").run {
                initVerify(key); update(body.toByteArray(Charsets.UTF_8)); verify(Base64.getDecoder().decode(signature))
            }
        }.getOrDefault(false)
        if (!valid) return Outcome.Refused(null, "invalid signature")
        // Only signed bytes are parsed, so every field below is PC-authenticated.
        val json = runCatching { JSONObject(body) }.getOrNull() ?: return Outcome.Refused(null, "invalid command body")
        val id = json.optString("id").takeIf { it.matches(Regex("[0-9a-fA-F-]{36}")) } ?: return Outcome.Refused(null, "invalid command id")
        val kind = json.optString("kind")
        val createdAt = json.optLong("createdAt", -1)
        val expiresAt = json.optLong("expiresAt", -1)
        return when {
            json.optInt("v") != 1 -> Outcome.Refused(id, "unsupported command version")
            json.optString("instanceId") != expectedInstanceId -> Outcome.Refused(id, "command is from a different PC")
            json.optString("deviceId") != deviceId -> Outcome.Refused(id, "command is for a different device")
            KINDS[kind] == null -> Outcome.Refused(id, "unsupported command")
            KINDS[kind] != json.optString("tier") -> Outcome.Refused(id, "command tier mismatch")
            createdAt < 0 || createdAt > now + CLOCK_SKEW_MS -> Outcome.Refused(id, "command is from the future")
            expiresAt <= now -> Outcome.Refused(id, "command expired")
            expiresAt - createdAt > MAX_LIFETIME_MS -> Outcome.Refused(id, "command lifetime too long")
            seen(id) -> Outcome.Refused(id, "command already handled")
            else -> Outcome.Accepted(Command(id, kind, KINDS.getValue(kind), json.optString("requestedBy"), json.optJSONObject("args") ?: JSONObject(), createdAt, expiresAt))
        }
    }

    private fun publicKey(spki: ByteArray): PublicKey? = listOf("RSA", "EC").firstNotNullOfOrNull { algorithm ->
        runCatching { KeyFactory.getInstance(algorithm).generatePublic(X509EncodedKeySpec(spki)) }.getOrNull()
    }
}
