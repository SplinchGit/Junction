package com.splinch.junction.assistant

import android.app.AlertDialog
import androidx.activity.ComponentActivity
import kotlinx.coroutines.CompletableDeferred

object PermissionGate {
    suspend fun requireApproval(activity: ComponentActivity, action: Action): Boolean {
        val deferred = CompletableDeferred<Boolean>()
        activity.runOnUiThread {
            val builder = AlertDialog.Builder(activity)
                .setTitle("Confirm action")
                .setMessage(buildMessage(action))
                .setNegativeButton("Cancel") { _, _ -> deferred.complete(false) }
                .setPositiveButton("Confirm") { _, _ -> deferred.complete(true) }
                .setCancelable(false)

            // For HIGH risk actions we add an extra note
            if (action.risk == Risk.HIGH) {
                builder.setMessage(buildMessage(action) + "\n\nThis action is HIGH risk — device authentication may be required.")
            }

            builder.show()
        }
        return deferred.await()
    }

    private fun buildMessage(action: Action): String {
        return when (action.type) {
            ActionType.OPEN_APP -> "Allow app to be opened: ${action.target} ?"
            ActionType.DEEP_LINK -> "Open link: ${action.target} ?"
            ActionType.SEND_MESSAGE -> "Send message: ${action.payload?.optString("body")} ?"
            ActionType.REPLY_NOTIFICATION -> "Reply to notification?"
            ActionType.READ_NOTIFICATIONS -> "Allow reading recent notification metadata?"
            ActionType.AI_CHAT -> "Send this to AI chat?"
            else -> action.summary
        }
    }
}
