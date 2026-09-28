package com.splinch.junction.data.sync.lan

import com.splinch.junction.data.database.audit.WorldAuditDao
import com.splinch.junction.data.database.audit.WorldAuditEntity
import com.splinch.junction.data.secret.KeyStorage
import java.time.Instant
import java.util.UUID

/** Fixed authenticated LAN requests for Junction World; no generic RPC surface. */
class JunctionWorldClient(private val identity: LanIdentityStore, private val auditDao: WorldAuditDao, private val keys: KeyStorage) {
    data class MessageReceipt(val id: String, val conversationId: String, val status: String)

    suspend fun refresh(): Result<Map<String, Any?>> = runCatching {
        require(LanConnectionMode.fromStored(keys.getSecret("lan_mode_v1")) == LanConnectionMode.WIFI) { "Connect the phone and Junction PC to the same Wi-Fi network." }
        val pairing = identity.loadPairing() ?: error("Pair this phone with Junction on the PC first.")
        val transport = LanTransport(identity)
        try {
            transport.connect(LanEndpoint(pairing.host, pairing.port, pairing.instanceId, pairing.certificateSha256)).getOrThrow()
            val status = transport.request("world.status")
            check(status.type == "world.status.result") { "The PC did not return Junction World status." }
            val cursor = auditDao.latestSequence() ?: 0L
            val response = transport.request("world.audit", mapOf("sinceSequence" to cursor))
            check(response.type == "world.audit.result") { "The PC did not return Junction World events." }
            val parsed = (response.payload["events"] as? List<*>)?.mapNotNull(::parseEvent).orEmpty()
            auditDao.insertAll(parsed)
            status.payload
        } finally { transport.close() }
    }

    suspend fun setControls(paused: Boolean, heartbeatMinutes: Int): Result<Map<String, Any?>> = runCatching {
        require(LanConnectionMode.fromStored(keys.getSecret("lan_mode_v1")) == LanConnectionMode.WIFI) { "Connect the phone and Junction PC to the same Wi-Fi network." }
        require(heartbeatMinutes in 10..120)
        val pairing = identity.loadPairing() ?: error("Pair this phone with Junction on the PC first.")
        val transport = LanTransport(identity)
        try {
            transport.connect(LanEndpoint(pairing.host, pairing.port, pairing.instanceId, pairing.certificateSha256)).getOrThrow()
            val response = transport.request("world.control", mapOf("paused" to paused, "heartbeatMinutes" to heartbeatMinutes))
            check(response.type == "world.control.result") { "Junction PC rejected the control change." }
            response.payload
        } finally { transport.close() }
    }

    suspend fun sendMessage(content: String): Result<MessageReceipt> = runCatching {
        val message = content.trim()
        require(message.isNotEmpty() && message.length <= MAX_MESSAGE_CHARS) { "Messages must contain 1 to $MAX_MESSAGE_CHARS characters." }
        require(LanConnectionMode.fromStored(keys.getSecret("lan_mode_v1")) == LanConnectionMode.WIFI) { "Connect the phone and Junction PC to the same Wi-Fi network." }
        val pairing = identity.loadPairing() ?: error("Pair this phone with Junction on the PC first.")
        val messageId = UUID.randomUUID().toString()
        val transport = LanTransport(identity)
        try {
            transport.connect(LanEndpoint(pairing.host, pairing.port, pairing.instanceId, pairing.certificateSha256)).getOrThrow()
            val response = transport.request("world.message", mapOf(
                "content" to message,
                "messageId" to messageId,
                "conversationId" to WORLD_CONVERSATION_ID
            ))
            check(response.type == "world.message.result") { "Junction World could not queue the message." }
            val id = response.payload["id"] as? String ?: error("Invalid Junction World message receipt.")
            val conversationId = response.payload["conversationId"] as? String ?: error("Invalid Junction World conversation receipt.")
            val status = response.payload["status"] as? String ?: error("Invalid Junction World message status.")
            require(id == messageId && conversationId == WORLD_CONVERSATION_ID && status in setOf("QUEUED", "DELIVERED"))
            MessageReceipt(id, conversationId, status)
        } finally { transport.close() }
    }

    private fun parseEvent(raw: Any?): WorldAuditEntity? = runCatching {
        val item = raw as? Map<*, *> ?: error("Invalid event")
        val id = item["id"] as? String ?: error("Invalid event ID")
        require(runCatching { UUID.fromString(id) }.isSuccess)
        val sequence = (item["sequence"] as? Number)?.toLong() ?: error("Invalid event sequence")
        require(sequence > 0)
        val timestampText = item["occurredAt"] as? String ?: error("Invalid timestamp")
        val timestamp = Instant.parse(timestampText).toEpochMilli()
        require(timestamp in Instant.parse("2000-01-01T00:00:00Z").toEpochMilli()..(System.currentTimeMillis() + 5 * 60_000))
        val category = item["category"] as? String ?: error("Invalid category")
        require(category in CATEGORIES)
        val summary = item["summary"] as? String ?: error("Invalid summary")
        require(summary.isNotBlank() && summary.length <= 280)
        val details = item["details"] as? String
        require(details == null || details.length <= 4000)
        val goalId = item["goalId"] as? String
        val actionId = item["actionId"] as? String
        require(goalId == null || runCatching { UUID.fromString(goalId) }.isSuccess)
        require(actionId == null || runCatching { UUID.fromString(actionId) }.isSuccess)
        val actionStatus = item["actionStatus"] as? String
        require(actionStatus == null || actionStatus in STATUSES)
        val communicationId = item["communicationId"] as? String
        val conversationId = item["conversationId"] as? String
        val communicationDirection = item["communicationDirection"] as? String
        if (category == "COMMUNICATION") {
            require(communicationId != null && runCatching { UUID.fromString(communicationId) }.isSuccess)
            require(conversationId != null && runCatching { UUID.fromString(conversationId) }.isSuccess)
            require(communicationDirection in COMMUNICATION_DIRECTIONS)
        } else require(communicationId == null && conversationId == null && communicationDirection == null)
        val duration = (item["durationMs"] as? Number)?.toLong()
        require(duration == null || duration in 0..900_000)
        val resources = item["resources"] as? Map<*, *>
        val workspace = resources?.get("workspaceFreeBytes")?.let { (it as? Number)?.toLong() ?: error("Invalid workspace size") }
        val memory = resources?.get("memoryUsedBytes")?.let { (it as? Number)?.toLong() ?: error("Invalid memory size") }
        val cpu = resources?.get("cpuPercent")?.let { (it as? Number)?.toDouble() ?: error("Invalid CPU value") }
        require(workspace == null || workspace >= 0)
        require(memory == null || memory >= 0)
        require(cpu == null || cpu in 0.0..100.0)
        WorldAuditEntity(id, sequence, timestamp, category, summary, details, goalId, actionId, actionStatus, communicationId, conversationId, communicationDirection, duration, workspace, memory, cpu)
    }.getOrNull()

    companion object {
        private val CATEGORIES = setOf("WAKE", "SLEEP", "GOAL_CREATED", "GOAL_UPDATED", "GOAL_ABANDONED", "GOAL_COMPLETED", "REFLECTION", "INTENTION", "ACTION", "RESULT", "RESEARCH", "PROJECT_FILE", "COMMUNICATION", "ERROR", "SECURITY_DENIAL", "RESOURCE_WARNING", "SYSTEM")
        private val STATUSES = setOf("INTENDED", "ATTEMPTED", "SUCCEEDED", "FAILED", "BLOCKED")
        private val COMMUNICATION_DIRECTIONS = setOf("OWNER_TO_AGENT", "AGENT_TO_OWNER")
        private const val MAX_MESSAGE_CHARS = 2_800
        const val WORLD_CONVERSATION_ID = "550e8400-e29b-41d4-a716-446655440000"
    }
}
