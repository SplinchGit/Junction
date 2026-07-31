package com.splinch.junction.settings

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * Stores sensitive values (API keys) in EncryptedSharedPreferences.
 * Never persists API keys to DataStore or plain SharedPreferences.
 *
 * Opening the encrypted store is failure-prone in ways that have nothing to do with the
 * caller: the hardware-backed master key can be invalidated by a lock-screen change, a
 * device restore can carry the encrypted file across without the key that opens it, and
 * some OEM backup implementations copy the prefs file while dropping the keystore entry.
 * When that happens `EncryptedSharedPreferences.create` throws.
 *
 * That used to happen in a field initialiser, so the throw escaped the constructor and
 * took down whatever was building [KeyStorage] -- in practice a crash on launch that no
 * amount of restarting fixed, because the bad state was on disk. The only user-visible
 * remedy was clearing app data, which also destroys chat history and durable memory.
 *
 * So opening is now lazy and recovers: an unreadable store is discarded and rebuilt. That
 * loses the stored keys -- they are encrypted under a key that no longer exists, so
 * nothing can recover them -- but the owner re-enters a key instead of losing the app. If
 * even the rebuild fails, an in-memory store keeps Junction usable for the session rather
 * than crash-looping.
 */
class KeyStorage(private val context: Context) {

    /** Minimal surface this class actually needs, so the fallback is not a SharedPreferences clone. */
    private interface Backing {
        fun read(key: String): String
        fun write(key: String, value: String)
        fun delete(key: String)
    }

    private class Encrypted(private val prefs: SharedPreferences) : Backing {
        override fun read(key: String) = prefs.getString(key, "").orEmpty()
        override fun write(key: String, value: String) = prefs.edit().putString(key, value).apply()
        override fun delete(key: String) = prefs.edit().remove(key).apply()
    }

    /**
     * Last resort. Deliberately never touches disk: a plain-text prefs file holding API
     * keys is exactly what this class exists to prevent, so keys are held for the process
     * lifetime and no longer.
     */
    private class Ephemeral : Backing {
        private val values = ConcurrentHashMap<String, String>()
        override fun read(key: String) = values[key].orEmpty()
        override fun write(key: String, value: String) {
            values[key] = value
        }

        override fun delete(key: String) {
            values.remove(key)
        }
    }

    @Volatile
    private var cached: Backing? = null

    /** True when keys are being held in memory only, because the encrypted store is unusable. */
    @Volatile
    var isEphemeral: Boolean = false
        private set

    private fun backing(): Backing {
        cached?.let { return it }
        synchronized(this) {
            cached?.let { return it }
            val resolved = open() ?: rebuild() ?: ephemeral()
            cached = resolved
            return resolved
        }
    }

    private fun open(): Backing? = runCatching {
        val master = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        Encrypted(
            EncryptedSharedPreferences.create(
                context,
                PREFS_NAME,
                master,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        )
    }.onFailure { Log.w(TAG, "Encrypted key store could not be opened", it) }.getOrNull()

    /** Deletes the unreadable store and builds a fresh one. */
    private fun rebuild(): Backing? {
        runCatching {
            context.deleteSharedPreferences(PREFS_NAME)
            // deleteSharedPreferences does not always remove the backing file, and a
            // leftover file fails the same way on the next open.
            File(File(context.applicationInfo.dataDir, "shared_prefs"), "$PREFS_NAME.xml")
                .takeIf { it.exists() }
                ?.delete()
        }.onFailure { Log.w(TAG, "Could not clear the damaged key store", it) }

        return open()?.also {
            Log.w(TAG, "Rebuilt the key store; stored API keys must be re-entered")
        }
    }

    private fun ephemeral(): Backing {
        Log.e(TAG, "Falling back to an in-memory key store; keys will not survive restart")
        isEphemeral = true
        return Ephemeral()
    }

    fun getApiKey(providerId: String): String =
        runCatching { backing().read(apiKeyPref(providerId)) }
            .onFailure { Log.w(TAG, "Could not read API key for $providerId", it) }
            .getOrDefault("")

    fun setApiKey(providerId: String, key: String) {
        runCatching { backing().write(apiKeyPref(providerId), key) }
            .onFailure { Log.w(TAG, "Could not store API key for $providerId", it) }
    }

    fun clearApiKey(providerId: String) {
        runCatching { backing().delete(apiKeyPref(providerId)) }
            .onFailure { Log.w(TAG, "Could not clear API key for $providerId", it) }
    }

    /** Whether a key is stored, without the caller having to hold the secret to ask. */
    fun hasApiKey(providerId: String): Boolean = getApiKey(providerId).isNotBlank()

    private fun apiKeyPref(providerId: String) = "api_key_$providerId"

    private companion object {
        const val TAG = "KeyStorage"
        const val PREFS_NAME = "junction_keys"
    }
}
