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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject

internal suspend fun <T> captureDeviceCommandResult(block: suspend () -> T): Result<T> =
    try { Result.success(block()) }
    catch (cancelled: CancellationException) { throw cancelled }
    catch (failure: Exception) { Result.failure(failure) }

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
        val actionFailure = flushNotificationActions(pairing.instanceId)
        flush()
        flushNotificationOutcomes(pairing.instanceId, now)
        val deviceId = identity.deviceId()
        @Suppress("UNCHECKED_CAST")
        val envelopes = client.request("nethra.device.pull", mapOf("deviceId" to deviceId))["commands"] as? List<Map<String, Any?>> ?: emptyList()
        var handled = 0
        for (envelope in envelopes) {
            when (val outcome = DeviceCommandVerifier.verify(envelope, pairing.certificateSha256, pairing.instanceId, deviceId, now) { seen().has(it) }) {
                is DeviceCommandVerifier.Outcome.Accepted -> {
                    val command = outcome.command
                    if (command.tier == "CONFIRM") {
                        holdForOwner(command)
                        markSeen(command.id, command.expiresAt)
                    }
                    else {
                        val result = captureDeviceCommandResult { DeviceCommandRunner(context, client).execute(command) }
                        queueResult(command.id, if (result.isSuccess) "SUCCEEDED" else "FAILED", result.getOrElse { JSONObject().put("error", it.message.orEmpty().take(300)) }, command.expiresAt)
                        markSeen(command.id, command.expiresAt)
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
        if (actionFailure != null) throw actionFailure
        handled
    }

    fun recordNotificationPosted(id: String, instanceId: String) = synchronized(ACTION_LOCK) {
        val entries = notificationOutcomes()
        if (!entries.has(id)) {
            entries.put(id, JSONObject().put("instanceId", instanceId).put("postedAt", System.currentTimeMillis()))
            saveNotificationOutcomes(entries)
        }
    }

    fun recordNotificationOpened(id: String, instanceId: String) =
        recordNotificationOutcome(id, instanceId, "OPENED")

    fun recordNotificationReplied(id: String, instanceId: String) =
        recordNotificationOutcome(id, instanceId, "REPLIED")

    private fun recordNotificationOutcome(id: String, instanceId: String, outcome: String) = synchronized(ACTION_LOCK) {
        val entries = notificationOutcomes()
        val entry = entries.optJSONObject(id) ?: return@synchronized
        if (entry.optString("instanceId") != instanceId || entry.has(outcome)) return@synchronized
        entry.put(outcome, false)
        saveNotificationOutcomes(entries)
    }

    private suspend fun flushNotificationOutcomes(instanceId: String, now: Long) {
        val pending = synchronized(ACTION_LOCK) {
            val entries = notificationOutcomes()
            val choices = notificationActions()
            entries.keys().asSequence().toList().forEach { id ->
                val entry = entries.getJSONObject(id)
                val age = now - entry.getLong("postedAt")
                if (entry.optString("instanceId") != instanceId || age > 14 * 24 * 3_600_000L) entries.remove(id)
                else if (age >= 24 * 3_600_000L && !choices.has(id) && OUTCOMES.none(entry::has)) entry.put("IGNORED", false)
            }
            saveNotificationOutcomes(entries)
            entries.keys().asSequence().flatMap { id ->
                val entry = entries.getJSONObject(id)
                OUTCOMES.asSequence().filter { entry.has(it) && !entry.optBoolean(it) }.map { id to it }
            }.take(20).toList()
        }
        for ((id, outcome) in pending) {
            val response = captureDeviceCommandResult {
                client.request("nethra.device.result", mapOf("deviceId" to identity.deviceId(), "id" to id,
                    "state" to "SUCCEEDED", "result" to mapOf("notificationOutcome" to outcome)))
            }.getOrNull() ?: continue
            if (!(response["notificationOutcomes"] is Map<*, *> || response["state"] == "CANCELLED")) continue
            synchronized(ACTION_LOCK) {
                val entries = notificationOutcomes()
                entries.optJSONObject(id)?.put(outcome, true)
                saveNotificationOutcomes(entries)
            }
        }
    }

    private fun notificationOutcomes() = JSONObject(prefs.getString("notification_outcomes_v1", "{}")!!)
    private fun saveNotificationOutcomes(value: JSONObject) {
        check(prefs.edit().putString("notification_outcomes_v1", value.toString()).commit())
    }

    /** The receiver only commits a choice; it never waits for the network mutex or starts audio. */
    fun queueNotificationAction(id: String, eventId: String, instanceId: String, action: String): Boolean = synchronized(ACTION_LOCK) {
        require(id.matches(Regex("[0-9a-fA-F-]{36}")) && eventId.length in 1..160 && instanceId.length in 1..160)
        require(action in setOf("SNOOZE", "DISMISS"))
        val all = notificationActions()
        if (all.has(id)) return@synchronized false // One owner choice per displayed delivery.
        val now = System.currentTimeMillis()
        all.put(id, JSONObject().put("id", id).put("eventId", eventId).put("instanceId", instanceId)
            .put("action", action).put("createdAt", now).put("keepUntil", now + RETAIN_MS).put("reported", false))
        saveNotificationActions(all)
        if (action == "DISMISS") recordNotificationOutcome(id, instanceId, "DISMISSED")
        true
    }

    internal fun pendingNotificationActions(): List<JSONObject> = synchronized(ACTION_LOCK) {
        val all = notificationActions()
        all.keys().asSequence().map { all.getJSONObject(it) }.filter { !it.optBoolean("reported") }.toList()
    }

    private suspend fun flushNotificationActions(instanceId: String): Exception? {
        var failure: Exception? = null
        for (entry in pendingNotificationActions().take(20)) {
            val id = entry.getString("id")
            if (entry.getString("instanceId") != instanceId) {
                updateNotificationAction(id) { it.put("reported", true).put("lastError", "Pairing changed; choice was not sent to another host") }
                android.util.Log.w("DeviceCommandSync", "Notification choice belongs to a previous host: $id")
                continue
            }
            try {
                com.splinch.junction.data.database.JunctionDatabase.getInstance(context).feedDao()
                    .markNotificationSeen(entry.getString("eventId"), entry.getLong("createdAt"))
                val response = client.request("nethra.device.result", mapOf("deviceId" to identity.deviceId(), "id" to id, "state" to "SUCCEEDED",
                    "result" to mapOf("notificationAction" to entry.getString("action"))))
                check(response["ownerAction"] is Map<*, *> || response["state"] == "CANCELLED") { "Host did not acknowledge the notification choice" }
                updateNotificationAction(id) { it.put("reported", true).put("acknowledgedAt", System.currentTimeMillis()).remove("lastError") }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                updateNotificationAction(id) { it.put("lastError", error.message.orEmpty().take(300)).put("lastAttemptAt", System.currentTimeMillis()) }
                android.util.Log.w("DeviceCommandSync", "Notification choice $id remains pending", error)
                failure = error
            }
        }
        return failure
    }

    private fun updateNotificationAction(id: String, update: (JSONObject) -> Unit) = synchronized(ACTION_LOCK) {
        val all = notificationActions()
        all.optJSONObject(id)?.let(update)
        saveNotificationActions(all)
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
        captureDeviceCommandResult { flush() }
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
            val reported = captureDeviceCommandResult {
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
        synchronized(ACTION_LOCK) {
            val all = notificationActions()
            all.keys().asSequence().toList().filter { all.getJSONObject(it).let { action -> action.optBoolean("reported") && action.getLong("keepUntil") < now } }.forEach { all.remove(it) }
            saveNotificationActions(all)
        }
    }

    private fun seen() = JSONObject(prefs.getString(SEEN, "{}")!!)
    private fun results() = JSONObject(prefs.getString(RESULTS, "{}")!!)
    private fun consents() = JSONObject(prefs.getString(CONSENTS, "{}")!!)
    private fun notificationActions() = JSONObject(prefs.getString(NOTIFICATION_ACTIONS, "{}")!!)
    private fun saveNotificationActions(value: JSONObject) = check(prefs.edit().putString(NOTIFICATION_ACTIONS, value.toString()).commit()) { "Could not save the notification choice" }
    private fun saveResults(value: JSONObject) = check(prefs.edit().putString(RESULTS, value.toString()).commit()) { "Could not save the command result" }

    companion object {
        private val LOCK = Mutex()
        private val ACTION_LOCK = Any()
        private val OUTCOMES = listOf("OPENED", "REPLIED", "DISMISSED", "IGNORED")
        private const val SEEN = "seen_v1"
        private const val RESULTS = "results_v1"
        private const val CONSENTS = "consents_v1"
        private const val NOTIFICATION_ACTIONS = "notification_actions_v1"
        private const val CHANNEL = "junction_device_requests"
        private const val NOTIFICATION_BASE = 4000
        // Seen ids outlive any command lifetime (24 h max), so a replay is always recognised.
        private const val RETAIN_MS = 48 * 3_600_000L
    }
}
