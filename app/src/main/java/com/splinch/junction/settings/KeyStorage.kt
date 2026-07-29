package com.splinch.junction.settings

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Stores sensitive values (API keys) in EncryptedSharedPreferences.
 * Never persists API keys to DataStore or plain SharedPreferences.
 */
class KeyStorage(context: Context) {
    private val master = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "junction_keys",
        master,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    fun getApiKey(providerId: String): String {
        return prefs.getString(apiKeyPref(providerId), "").orEmpty()
    }

    fun setApiKey(providerId: String, key: String) {
        prefs.edit().putString(apiKeyPref(providerId), key).apply()
    }

    fun clearApiKey(providerId: String) {
        prefs.edit().remove(apiKeyPref(providerId)).apply()
    }

    private fun apiKeyPref(providerId: String) = "api_key_$providerId"
}
