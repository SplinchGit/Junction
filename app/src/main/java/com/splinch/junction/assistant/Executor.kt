package com.splinch.junction.assistant

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log

interface Executor {
    suspend fun execute(context: Context, action: Action): ActionResult
}

class OpenAppExecutor : Executor {
    override suspend fun execute(context: Context, action: Action): ActionResult {
        val pkgOrName = action.target ?: return ActionResult.Failure("No target specified")
        val pm = context.packageManager
        // If looks like a package name, try launch
        try {
            val intent = pm.getLaunchIntentForPackage(pkgOrName)
            if (intent != null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
                return ActionResult.Success("Launched $pkgOrName")
            }
        } catch (ex: Exception) {
            Log.w("OpenAppExecutor", "launch by package failed", ex)
        }

        // Otherwise try to find by label
        val apps = pm.getInstalledApplications(0)
        val match = apps.firstOrNull { info ->
            val label = pm.getApplicationLabel(info).toString()
            label.equals(pkgOrName, ignoreCase = true) || label.contains(pkgOrName, ignoreCase = true)
        }
        if (match != null) {
            val intent = pm.getLaunchIntentForPackage(match.packageName)
            if (intent != null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
                return ActionResult.Success("Launched ${match.packageName}")
            }
        }

        return ActionResult.Failure("App not found: $pkgOrName")
    }
}

class DeepLinkExecutor : Executor {
    override suspend fun execute(context: Context, action: Action): ActionResult {
        val target = action.target ?: return ActionResult.Failure("No URL provided")
        return try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(target)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            ActionResult.Success("Opened link")
        } catch (ex: ActivityNotFoundException) {
            ActionResult.Failure("No app can open the link")
        } catch (ex: Exception) {
            ActionResult.Failure(ex.message ?: "Failed to open link")
        }
    }
}

class NoopExecutor : Executor {
    override suspend fun execute(context: Context, action: Action): ActionResult {
        return ActionResult.Failure("No executor for action type: ${action.type}")
    }
}
