package com.splinch.junction.data.sync.lan

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import com.splinch.junction.BuildConfig
import com.splinch.junction.data.sync.firebase.LocalBrainPairingStore
import org.json.JSONArray
import org.json.JSONObject

/** Executes READ-tier device commands. None of them changes state on the phone. */
class DeviceCommandRunner(context: Context, private val client: NethraClient) {
    private val context = context.applicationContext

    suspend fun execute(command: DeviceCommandVerifier.Command): JSONObject = when (command.kind) {
        "STATUS" -> status()
        "SMOKE_TEST" -> smokeTest()
        "COLLECT_LOGS" -> logs(command.args.optInt("lines", 200).coerceIn(1, 500))
        else -> error("Command ${command.kind} is not executed automatically")
    }

    fun status(): JSONObject {
        val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        return JSONObject()
            .put("versionCode", BuildConfig.JUNCTION_VERSION_CODE)
            .put("versionName", BuildConfig.VERSION_NAME)
            .put("sdk", Build.VERSION.SDK_INT)
            .put("model", Build.MODEL)
            .put("batteryPercent", if (level >= 0 && scale > 0) level * 100 / scale else JSONObject.NULL)
            .put("charging", battery?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0)?.let { it != 0 } ?: false)
            .put("network", JSONArray(transports()))
            .put("lanPaired", LanIdentityStore(context).loadPairing() != null)
            .put("relayPaired", LocalBrainPairingStore.load(context) != null)
            .put("freeStorageBytes", context.filesDir.usableSpace)
    }

    private fun transports(): List<String> {
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return emptyList()
        val capabilities = manager.getNetworkCapabilities(manager.activeNetwork) ?: return emptyList()
        return listOf(NetworkCapabilities.TRANSPORT_WIFI to "wifi", NetworkCapabilities.TRANSPORT_CELLULAR to "cellular", NetworkCapabilities.TRANSPORT_VPN to "vpn", NetworkCapabilities.TRANSPORT_ETHERNET to "ethernet")
            .filter { capabilities.hasTransport(it.first) }.map { it.second }
    }

    private suspend fun smokeTest(): JSONObject {
        val checks = JSONArray()
        fun check(name: String, ok: Boolean, detail: String = "") { checks.put(JSONObject().put("name", name).put("ok", ok).put("detail", detail.take(300))) }
        check("lan_pin", LanIdentityStore(context).loadPairing() != null)
        check("relay_pairing", LocalBrainPairingStore.load(context) != null)
        check("notifications", NotificationManagerCompat.from(context).areNotificationsEnabled())
        check("database", context.getDatabasePath("junction.db").exists())
        // A diagnostic check must not load the PC model.
        captureDeviceCommandResult { client.request("nethra.status", mapOf("warm" to false)) }.fold(
            { check("host_round_trip", it["agent"] == "Nethra", "model=${it["model"]}, scheduler=${it["schedulerRunning"]}") },
            { check("host_round_trip", false, it.message.orEmpty()) }
        )
        val passed = (0 until checks.length()).all { checks.getJSONObject(it).getBoolean("ok") }
        return JSONObject().put("passed", passed).put("versionCode", BuildConfig.JUNCTION_VERSION_CODE).put("checks", checks)
    }

    /** Only this app's own process log, which Android permits without READ_LOGS. */
    private fun logs(lines: Int): JSONObject {
        val process = ProcessBuilder("logcat", "-d", "-t", lines.toString(), "--pid", android.os.Process.myPid().toString()).redirectErrorStream(true).start()
        val text = process.inputStream.bufferedReader().use { it.readText() }
        process.waitFor()
        return JSONObject().put("lines", lines).put("log", redact(text).takeLast(MAX_LOG_CHARS))
    }

    companion object {
        const val MAX_LOG_CHARS = 12_000
        private val PATTERNS = listOf(
            Regex("(?i)bearer\\s+[A-Za-z0-9._~+/=-]+") to "Bearer [redacted]",
            Regex("ya29\\.[A-Za-z0-9._-]+") to "[redacted-token]",
            Regex("AIza[0-9A-Za-z_-]{20,}") to "[redacted-key]",
            Regex("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}") to "[email]",
            Regex("(?i)(password|passwd|secret|token|api[_-]?key)\\s*[=:]\\s*\\S+") to "$1=[redacted]",
            Regex("[A-Za-z0-9+/_-]{32,}={0,2}") to "[redacted]"
        )
        fun redact(text: String): String = PATTERNS.fold(text) { acc, (pattern, replacement) -> pattern.replace(acc, replacement) }
    }
}
