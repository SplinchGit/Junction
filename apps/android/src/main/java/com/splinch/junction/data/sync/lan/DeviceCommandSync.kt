package com.splinch.junction.data.sync.lan

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.splinch.junction.R
import com.splinch.junction.app.MainActivity
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject

/**
 * Pulls signed PC commands over whichever transport NethraClient reaches (LAN
 * first, then the encrypted relay), verifies them, runs READ-tier work, holds
 * CONFIRM-tier work for an owner tap, and reports results until acknowledged.
 */
class DeviceCommandSync(context: Context) {
    private val context = context.applicationContext
    private val prefs = this.context.getSharedPreferences("junction_device_commands", Context.MODE_PRIVATE)
    private val identity = LanIdentityStore(this.context)
    private val client = NethraClient(this.context)

    data class Consent(val id: String, val versionCode: Int, val sha256: String, val sizeBytes: Long, val requestedBy: String, val expiresAt: Long)

    suspend fun runOnce(now: Long = System.currentTimeMillis()): Int = LOCK.withLock {
        val pairing = identity.loadPairing() ?: return 0 // Without a pinned PC key nothing can be verified.
        prune(now)
        flush()
        val deviceId = identity.deviceId()
        @Suppress("UNCHECKED_CAST")
        val envelopes = client.request("nethra.device.pull", mapOf("deviceId" to deviceId))["commands"] as? List<Map<String, Any?>> ?: emptyList()
        var handled = 0
        for (envelope in envelopes) {
            when (val outcome = DeviceCommandVerifier.verify(envelope, pairing.certificateSha256, pairing.instanceId, deviceId, now) { seen().has(it) }) {
                is DeviceCommandVerifier.Outcome.Accepted -> {
                    val command = outcome.command
                    markSeen(command.id, command.expiresAt)
                    if (command.tier == "CONFIRM") holdForOwner(command)
                    else {
                        val result = runCatching { DeviceCommandRunner(context, client).execute(command) }
                        queueResult(command.id, if (result.isSuccess) "SUCCEEDED" else "FAILED", result.getOrElse { JSONObject().put("error", it.message.orEmpty().take(300)) }, command.expiresAt)
                    }
                    handled++
                }
                // A redelivery after a lost acknowledgement: re-send the cached result, never re-run.
                is DeviceCommandVerifier.Outcome.Refused -> if (outcome.id != null && outcome.reason != "command already handled") {
                    markSeen(outcome.id, now + 24 * 3_600_000L)
                    queueResult(outcome.id, "REJECTED", JSONObject().put("reason", outcome.reason), now + 24 * 3_600_000L)
                } else if (outcome.id != null) results().optJSONObject(outcome.id)?.let { saveResults(results().put(outcome.id, it.put("reported", false))) }
            }
        }
        flush()
        handled
    }

    fun pendingConsents(now: Long = System.currentTimeMillis()): List<Consent> {
        val held = consents()
        return held.keys().asSequence().map { held.getJSONObject(it) }.filter { it.getLong("expiresAt") > now }.map {
            Consent(it.getString("id"), it.getInt("versionCode"), it.getString("sha256"), it.getLong("sizeBytes"), it.optString("requestedBy"), it.getLong("expiresAt"))
        }.toList()
    }

    suspend fun decide(id: String, approved: Boolean) = LOCK.withLock {
        val held = consents()
        val consent = held.optJSONObject(id) ?: error("This request is no longer pending")
        held.remove(id); check(prefs.edit().putString(CONSENTS, held.toString()).commit()) { "Could not save the decision" }
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_BASE + Math.floorMod(id.hashCode(), 1000))
        val result = JSONObject().put("approved", approved).put("versionCode", consent.getInt("versionCode")).put("sha256", consent.getString("sha256"))
        queueResult(id, if (approved) "SUCCEEDED" else "REJECTED", result, consent.getLong("expiresAt"))
        runCatching { flush() }
    }

    private fun holdForOwner(command: DeviceCommandVerifier.Command) {
        val args = command.args
        val consent = JSONObject().put("id", command.id).put("versionCode", args.getInt("versionCode")).put("sha256", args.getString("sha256"))
            .put("sizeBytes", args.getLong("sizeBytes")).put("requestedBy", command.requestedBy).put("expiresAt", command.expiresAt)
        check(prefs.edit().putString(CONSENTS, consents().put(command.id, consent).toString()).commit()) { "Could not hold the install request" }
        notifyOwner(command.id, args.getInt("versionCode"), command.requestedBy)
    }

    private fun notifyOwner(id: String, versionCode: Int, requestedBy: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(NotificationChannel(CHANNEL, "PC device requests", NotificationManager.IMPORTANCE_HIGH))
        }
        val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_junction)
            .setContentTitle("Install Junction build $versionCode?")
            .setContentText("Requested by $requestedBy on your PC. Open Projects to approve or reject.")
            .setContentIntent(open).setAutoCancel(true).setPriority(NotificationCompat.PRIORITY_HIGH).build()
        runCatching { NotificationManagerCompat.from(context).notify(NOTIFICATION_BASE + Math.floorMod(id.hashCode(), 1000), notification) }
    }

    private suspend fun flush() {
        val all = results()
        for (id in all.keys().asSequence().toList()) {
            val entry = all.getJSONObject(id)
            if (entry.optBoolean("reported")) continue
            val reported = runCatching {
                client.request("nethra.device.result", mapOf("deviceId" to identity.deviceId(), "id" to id, "state" to entry.getString("state"), "result" to entry.getJSONObject("result")))
            }.isSuccess
            if (reported) saveResults(results().also { it.optJSONObject(id)?.put("reported", true) })
        }
    }

    private fun queueResult(id: String, state: String, result: JSONObject, keepUntil: Long) =
        saveResults(results().put(id, JSONObject().put("state", state).put("result", result).put("reported", false).put("keepUntil", keepUntil)))

    private fun markSeen(id: String, expiresAt: Long) = check(prefs.edit().putString(SEEN, seen().put(id, expiresAt).toString()).commit()) { "Could not record the command" }

    private fun prune(now: Long) {
        val seen = seen(); seen.keys().asSequence().toList().filter { seen.getLong(it) < now - RETAIN_MS }.forEach { seen.remove(it) }
        val results = results(); results.keys().asSequence().toList().filter { results.getJSONObject(it).let { r -> r.optBoolean("reported") && r.getLong("keepUntil") < now } }.forEach { results.remove(it) }
        val held = consents(); held.keys().asSequence().toList().filter { held.getJSONObject(it).getLong("expiresAt") <= now }.forEach { held.remove(it) }
        prefs.edit().putString(SEEN, seen.toString()).putString(RESULTS, results.toString()).putString(CONSENTS, held.toString()).commit()
    }

    private fun seen() = JSONObject(prefs.getString(SEEN, "{}")!!)
    private fun results() = JSONObject(prefs.getString(RESULTS, "{}")!!)
    private fun consents() = JSONObject(prefs.getString(CONSENTS, "{}")!!)
    private fun saveResults(value: JSONObject) = check(prefs.edit().putString(RESULTS, value.toString()).commit()) { "Could not save the command result" }

    companion object {
        private val LOCK = Mutex()
        private const val SEEN = "seen_v1"
        private const val RESULTS = "results_v1"
        private const val CONSENTS = "consents_v1"
        private const val CHANNEL = "junction_device_requests"
        private const val NOTIFICATION_BASE = 4000
        // Seen ids outlive any command lifetime (24 h max), so a replay is always recognised.
        private const val RETAIN_MS = 48 * 3_600_000L
    }
}
