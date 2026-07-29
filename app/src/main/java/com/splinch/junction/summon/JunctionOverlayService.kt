package com.splinch.junction.summon

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.ImageView
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.splinch.junction.MainActivity
import com.splinch.junction.R
import kotlin.math.abs

/**
 * §Phase 2.C summon mechanism: a small persistent floating bubble (draggable,
 * survives across apps) that opens Junction chat on tap and voice mode on
 * long-press. This is the mechanism actually available to a normal app on
 * stock Android — there is no public API to hook an arbitrary hardware
 * "side key" system-wide, so the bubble is the primary summon surface.
 * (A best-effort, opt-in volume-down long-press summon is also available via
 * [com.splinch.junction.accessibility.JunctionAccessibilityService] for
 * devices where the accessibility service is already enabled.)
 *
 * Entirely inert unless the owner both grants the "draw over other apps"
 * permission and enables the bubble in Settings.
 */
class JunctionOverlayService : Service() {

    private var windowManager: WindowManager? = null
    private var bubbleView: View? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startForegroundNotification()
        showBubble()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        removeBubble()
        super.onDestroy()
    }

    private fun startForegroundNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Junction quick access",
                NotificationManager.IMPORTANCE_MIN
            )
            manager?.createNotificationChannel(channel)
        }
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_junction)
            .setContentTitle("Junction quick access")
            .setContentText("Tap the floating bubble to open chat, hold for voice.")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun showBubble() {
        if (!Settings.canDrawOverlays(this)) {
            stopSelf()
            return
        }
        val wm = getSystemService(WINDOW_SERVICE) as WindowManager
        windowManager = wm

        val bubble = ImageView(this).apply {
            setImageResource(R.drawable.ic_junction)
            setBackgroundColor(0x00000000)
        }

        val overlayType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val params = WindowManager.LayoutParams(
            BUBBLE_SIZE_PX,
            BUBBLE_SIZE_PX,
            overlayType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 0
            y = 300
        }

        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        var downAt = 0L
        var dragged = false

        bubble.setOnTouchListener { view, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.rawX
                    downY = event.rawY
                    startX = params.x
                    startY = params.y
                    downAt = System.currentTimeMillis()
                    dragged = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downX
                    val dy = event.rawY - downY
                    if (abs(dx) > DRAG_THRESHOLD_PX || abs(dy) > DRAG_THRESHOLD_PX) {
                        dragged = true
                        params.x = startX + dx.toInt()
                        params.y = startY + dy.toInt()
                        runCatching { wm.updateViewLayout(view, params) }
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!dragged) {
                        val heldMs = System.currentTimeMillis() - downAt
                        if (heldMs >= LONG_PRESS_MS) {
                            launchJunction(openVoice = true)
                        } else {
                            launchJunction(openVoice = false)
                        }
                    }
                    true
                }
                else -> false
            }
        }

        bubbleView = bubble
        wm.addView(bubble, params)
    }

    private fun removeBubble() {
        val wm = windowManager ?: return
        bubbleView?.let { runCatching { wm.removeView(it) } }
        bubbleView = null
        windowManager = null
    }

    private fun launchJunction(openVoice: Boolean) {
        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (openVoice) {
                putExtra(MainActivity.EXTRA_OPEN_VOICE, true)
            } else {
                putExtra(MainActivity.EXTRA_OPEN_CHAT, true)
            }
        }
        startActivity(intent)
    }

    companion object {
        private const val CHANNEL_ID = "junction_overlay"
        private const val NOTIFICATION_ID = 2001
        private const val BUBBLE_SIZE_PX = 140
        private const val DRAG_THRESHOLD_PX = 16
        private const val LONG_PRESS_MS = 500L

        fun start(context: Context) {
            if (!Settings.canDrawOverlays(context)) return
            val intent = Intent(context, JunctionOverlayService::class.java)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, JunctionOverlayService::class.java))
        }
    }
}
