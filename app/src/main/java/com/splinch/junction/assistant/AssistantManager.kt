package com.splinch.junction.assistant

import android.content.Context
import androidx.activity.ComponentActivity

class AssistantManager(
    private val planner: Planner = SimplePlanner(),
    private val openAppExecutor: OpenAppExecutor = OpenAppExecutor(),
    private val deepLinkExecutor: DeepLinkExecutor = DeepLinkExecutor(),
    private val noopExecutor: NoopExecutor = NoopExecutor()
) {
    suspend fun handleText(activity: ComponentActivity, context: Context, text: String): List<ActionResult> {
        val actions = planner.plan(text)
        val results = mutableListOf<ActionResult>()
        for (action in actions) {
            val approved = PermissionGate.requireApproval(activity, action)
            if (!approved) {
                results.add(ActionResult.Failure("User cancelled"))
                continue
            }
            val executor = when (action.type) {
                ActionType.OPEN_APP -> openAppExecutor
                ActionType.DEEP_LINK -> deepLinkExecutor
                else -> noopExecutor
            }
            val res = executor.execute(context, action)
            results.add(res)
        }
        return results
    }
}
