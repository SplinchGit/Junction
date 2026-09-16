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
    private val keyAlias = "junction.lan.ed25519.v1"

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
        val signature = Signature.getInstance("Ed25519")
        signature.initSign(key as java.security.PrivateKey)
        signature.update(message)
        return Base64.encodeToString(signature.sign(), Base64.NO_WRAP)
    }

    fun savePairing(pairing: LanProtocol.PairingCode) {
        ensureKey()
        keys.setSecret(PAIRING_SECRET, JSONObject().apply {
            put("instanceId", pairing.instanceId); put("host", pairing.host); put("port", pairing.port)
            put("certificateSha256", pairing.certificateSha256)
            put("expiresAtMillis", pairing.expiresAtMillis)
        }.toString())
    }

    fun loadPairing(): LanProtocol.PairingCode? = runCatching {
        val json = keys.getSecret(PAIRING_SECRET).takeIf { it.isNotBlank() }?.let(::JSONObject) ?: return null
        LanProtocol.PairingCode(json.getString("instanceId"), json.getString("host"), json.getInt("port"), json.getString("certificateSha256"), "", json.getLong("expiresAtMillis"))
    }.getOrNull()

    fun clearPairing() = keys.clearSecret(PAIRING_SECRET)

    private fun ensureKey() {
        val store = keyStore()
        if (!store.containsAlias(keyAlias)) {
            KeyPairGenerator.getInstance("Ed25519", "AndroidKeyStore").apply { initialize(android.security.keystore.KeyGenParameterSpec.Builder(keyAlias, android.security.keystore.KeyProperties.PURPOSE_SIGN).build()) }.generateKeyPair()
        }
    }

    private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private companion object {
        const val PAIRING_SECRET = "lan_pairing_v1"
        const val DEVICE_ID_SECRET = "lan_device_id_v1"
        val DEVICE_ID_PATTERN = Regex("[0-9a-fA-F-]{36}")
    }
}
