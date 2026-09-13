package com.splinch.junction.data.sync.firebase

import android.content.Context
import android.util.Base64
import com.google.firebase.auth.FirebaseAuth
import com.splinch.junction.data.secret.KeyStorage
import kotlinx.coroutines.tasks.await
import org.json.JSONObject
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * A paired Local Junction Brain is deliberately not a provider account. The PC and
 * phone receive independent anonymous Firebase transport identities, while this
 * record (including the E2E key) is held only in OS-backed secret storage.
 */
data class LocalBrainPairing(val brainId: String, val clientUid: String, val key: String)

object LocalBrainPairingStore {
    private const val SECRET_NAME = "local_brain_pairing_v1"

    fun load(context: Context): LocalBrainPairing? = runCatching {
        val raw = KeyStorage(context.applicationContext).getSecret(SECRET_NAME)
        if (raw.isBlank()) null else JSONObject(raw).let {
            LocalBrainPairing(it.getString("brainId"), it.getString("clientUid"), it.getString("key"))
        }
    }.getOrNull()

    fun save(context: Context, pairing: LocalBrainPairing) {
        KeyStorage(context.applicationContext).setSecret(SECRET_NAME, JSONObject().apply {
            put("brainId", pairing.brainId); put("clientUid", pairing.clientUid); put("key", pairing.key)
        }.toString())
    }
    fun clear(context: Context) = KeyStorage(context.applicationContext).clearSecret(SECRET_NAME)

    /** Format is intentionally a code, never a URL. It carries a 256-bit pairing secret. */
    fun parseCode(value: String): Triple<String, String, String>? = runCatching {
        val parts = value.trim().replace(" ", "").split('.')
        require(parts.size == 4 && parts[0] == "JBP1")
        require(parts[1].length >= 32 && parts[2].length >= 32 && Base64.decode(parts[3], Base64.URL_SAFE or Base64.NO_WRAP).size == 32)
        Triple(parts[1], parts[2], parts[3])
    }.getOrNull()

    suspend fun ensureAnonymous(context: Context): String {
        check(FirebaseProvider.initialize(context)) { "Firebase is not configured in this build." }
        val auth = FirebaseProvider.authOrNull() ?: error("Firebase authentication is unavailable.")
        return (auth.currentUser ?: auth.signInAnonymously().await().user ?: error("Could not create Junction device identity.")).uid
    }

    fun encrypt(keyText: String, aad: String, plaintext: String): Pair<String, String> {
        val nonce = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.ENCRYPT_MODE, SecretKeySpec(Base64.decode(keyText, Base64.URL_SAFE or Base64.NO_WRAP), "AES"), GCMParameterSpec(128, nonce))
            updateAAD(aad.toByteArray(Charsets.UTF_8))
        }
        return Base64.encodeToString(cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8)), Base64.URL_SAFE or Base64.NO_WRAP) to Base64.encodeToString(nonce, Base64.URL_SAFE or Base64.NO_WRAP)
    }

    fun decrypt(keyText: String, aad: String, ciphertext: String, nonce: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, SecretKeySpec(Base64.decode(keyText, Base64.URL_SAFE or Base64.NO_WRAP), "AES"), GCMParameterSpec(128, Base64.decode(nonce, Base64.URL_SAFE or Base64.NO_WRAP)))
            updateAAD(aad.toByteArray(Charsets.UTF_8))
        }
        return String(cipher.doFinal(Base64.decode(ciphertext, Base64.URL_SAFE or Base64.NO_WRAP)), Charsets.UTF_8)
    }
}
