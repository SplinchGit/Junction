package com.splinch.junction.update

import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

data class UpdateInfo(
    val version: String,
    val url: String
)

class UpdateChecker(
    private val httpClient: OkHttpClient = OkHttpClient()
) {
    suspend fun checkForUpdate(currentVersion: String): UpdateInfo? {
        val request = Request.Builder()
            .url("https://api.github.com/repos/SplinchGit/Junction/releases/latest")
            .get()
            .build()

        httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return null
            val body = response.body?.string() ?: return null
            val json = JSONObject(body)
            val tag = json.optString("tag_name", "").trim()
            val url = json.optString("html_url", "").trim()
            if (tag.isBlank() || url.isBlank()) return null
            val latestVersion = tag.removePrefix("v")
            if (isNewer(latestVersion, currentVersion)) {
                return UpdateInfo(version = latestVersion, url = url)
            }
        }
        return null
    }

    private fun isNewer(remote: String, local: String): Boolean {
        val remoteParts = remote.split(".").mapNotNull { it.toIntOrNull() }
        val localParts = local.split(".").mapNotNull { it.toIntOrNull() }
        val max = maxOf(remoteParts.size, localParts.size)
        for (i in 0 until max) {
            val r = remoteParts.getOrElse(i) { 0 }
            val l = localParts.getOrElse(i) { 0 }
            if (r != l) return r > l
        }
        return false
    }
}
