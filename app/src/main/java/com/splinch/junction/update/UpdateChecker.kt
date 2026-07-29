package com.splinch.junction.update

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

data class UpdateInfo(
    val version: String,
    val url: String,
    val apkUrl: String? = null,
    val sha256Url: String? = null
)

class UpdateChecker(
    private val httpClient: OkHttpClient = OkHttpClient()
) {
    suspend fun checkForUpdate(currentVersion: String): UpdateInfo? {
        return withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("https://api.github.com/repos/SplinchGit/Junction/releases/latest")
                .get()
                .build()

            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext null
                val body = response.body?.string() ?: return@withContext null
                val json = JSONObject(body)
                val tag = json.optString("tag_name", "").trim()
                val url = json.optString("html_url", "").trim()
                if (tag.isBlank() || url.isBlank()) return@withContext null
                val latestVersion = tag.removePrefix("v")
                if (isNewer(latestVersion, currentVersion)) {
                    val assets = json.optJSONArray("assets")
                    var apkUrl: String? = null
                    var sha256Url: String? = null
                    for (index in 0 until (assets?.length() ?: 0)) {
                        val asset = assets?.optJSONObject(index) ?: continue
                        val name = asset.optString("name").lowercase()
                        val downloadUrl = asset.optString("browser_download_url").trim()
                        if (downloadUrl.isBlank()) continue
                        when {
                            name.endsWith(".apk") -> apkUrl = downloadUrl
                            name.endsWith(".sha256") || name.endsWith(".sha256sum") -> sha256Url = downloadUrl
                        }
                    }
                    return@withContext UpdateInfo(
                        version = latestVersion,
                        url = url,
                        apkUrl = apkUrl,
                        sha256Url = sha256Url
                    )
                }
            }
            null
        }
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
