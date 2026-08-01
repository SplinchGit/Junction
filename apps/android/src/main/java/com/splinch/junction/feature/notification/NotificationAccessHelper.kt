package com.splinch.junction.feature.notification

import android.content.Context
import androidx.core.app.NotificationManagerCompat

object NotificationAccessHelper {
    fun isNotificationListenerEnabled(context: Context): Boolean {
        val enabledPackages = NotificationManagerCompat.getEnabledListenerPackages(context)
        return enabledPackages.contains(context.packageName)
    }
}
