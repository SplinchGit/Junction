package com.splinch.junction.data.sync.lan

import android.content.Context
import android.util.Base64
import com.splinch.junction.data.secret.KeyStorage
import org.json.JSONObject
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature

/** Android identity. The private key is generated and used inside Android Keystore only. */
class LanIdentityStore(context: Context) {
    private val appContext = context.applicationContext
    private val keys = KeyStorage(appContext)
    private val keyAlias by lazy { if (keyStore().containsAlias("junction.lan.ed25519.v1")) "junction.lan.ed25519.v1" else "junction.lan.p256.v1" }

    /** Stable per-installation identifier held in the encrypted secret store. */
    fun deviceId(): String {
        val existing = keys.getSecret(DEVICE_ID_SECRET)
        if (existing.matches(DEVICE_ID_PATTERN)) return existing
        return java.util.UUID.randomUUID().toString().also { keys.setSecret(DEVICE_ID_SECRET, it) }
    }

    fun publicKeyBase64(): String {
        ensureKey()
        return Base64.encodeToString(keyStore().getCertificate(keyAlias).publicKey.encoded, Base64.NO_WRAP)
    }

    fun sign(message: ByteArray): String {
        ensureKey()
        val key = keyStore().getKey(keyAlias, null)
        val signature = Signature.getInstance(if (keyAlias.endsWith("p256.v1")) "SHA256withECDSA" else "Ed25519")
        signature.initSign(key as java.security.PrivateKey)
        signature.update(message)
        return Base64.encodeToString(signature.sign(), Base64.NO_WRAP)
    }

    fun savePairing(pairing: LanProtocol.PairingCode) {
        ensureKey()
        val trusted = LanProtocol.persistentTrust(pairing)
        keys.setSecret(PAIRING_SECRET, JSONObject().apply {
            put("instanceId", trusted.instanceId); put("host", trusted.host); put("port", trusted.port)
            put("certificateSha256", trusted.certificateSha256)
            put("expiresAtMillis", trusted.expiresAtMillis)
        }.toString())
    }

    fun loadPairing(): LanProtocol.PairingCode? = runCatching {
        val json = keys.getSecret(PAIRING_SECRET).takeIf { it.isNotBlank() }?.let(::JSONObject) ?: return null
        LanProtocol.PairingCode(json.getString("instanceId"), json.getString("host"), json.getInt("port"), json.getString("certificateSha256"), "", Long.MAX_VALUE)
    }.getOrNull()

    fun clearPairing() = keys.clearSecret(PAIRING_SECRET)

    private fun ensureKey() {
        val store = keyStore()
        if (!store.containsAlias(keyAlias)) {
            KeyPairGenerator.getInstance("EC", "AndroidKeyStore").apply {
                initialize(android.security.keystore.KeyGenParameterSpec.Builder(keyAlias, android.security.keystore.KeyProperties.PURPOSE_SIGN)
                    .setAlgorithmParameterSpec(java.security.spec.ECGenParameterSpec("secp256r1"))
                    .setDigests(android.security.keystore.KeyProperties.DIGEST_SHA256).build())
            }.generateKeyPair()
        }
    }

    private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private companion object {
        const val PAIRING_SECRET = "lan_pairing_v1"
        const val DEVICE_ID_SECRET = "lan_device_id_v1"
        val DEVICE_ID_PATTERN = Regex("[0-9a-fA-F-]{36}")
    }
}
