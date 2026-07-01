package com.splinch.junction.assistant

import org.json.JSONObject
import java.util.UUID

enum class ActionType { OPEN_APP, DEEP_LINK, SEND_MESSAGE, READ_NOTIFICATIONS, REPLY_NOTIFICATION, AI_CHAT, OTHER }

enum class Risk { LOW, MEDIUM, HIGH }

sealed class ActionResult(val success: Boolean, val message: String?) {
    class Success(message: String? = null) : ActionResult(true, message)
    class Failure(message: String?) : ActionResult(false, message)
}

data class Action(
    val id: String = UUID.randomUUID().toString(),
    val type: ActionType,
    val target: String? = null,
    val payload: JSONObject? = null,
    val risk: Risk = Risk.LOW,
    val summary: String
)
