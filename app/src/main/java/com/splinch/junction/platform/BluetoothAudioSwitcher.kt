package com.splinch.junction.platform

import android.Manifest
import android.bluetooth.BluetoothA2dp
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Where the headphones' audio currently lives, from the phone's point of view. */
enum class AudioSide {
    PHONE, // phone holds an active A2DP link
    PC, // phone is not connected — the PC (or nothing) has them
    UNAVAILABLE // no adapter, no permission, or no paired audio device
}

/**
 * One-tap "thrower" for a paired Bluetooth headset between this phone and
 * anything else (the owner's PC). Android can only drive its own side of the
 * link, so: "throw to phone" = actively connect A2DP here; "throw to PC" =
 * drop our link so the other host can (re)claim it. With multipoint headsets
 * this feels like a real handoff; with single-point ones the other side
 * reconnects the moment we let go.
 *
 * connect()/disconnect() on [BluetoothA2dp] are hidden API, so they're called
 * reflectively (the long-standing approach used by BT widget apps). If the
 * platform blocks the call we fall back to opening Bluetooth settings.
 */
class BluetoothAudioSwitcher(private val context: Context) {

    private val _side = MutableStateFlow(AudioSide.UNAVAILABLE)
    val side: StateFlow<AudioSide> = _side.asStateFlow()

    private val _deviceName = MutableStateFlow<String?>(null)
    val deviceName: StateFlow<String?> = _deviceName.asStateFlow()

    private var a2dp: BluetoothA2dp? = null

    private val adapter: BluetoothAdapter?
        get() = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    fun hasPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.BLUETOOTH_CONNECT
        ) == PackageManager.PERMISSION_GRANTED
    }

    /** Binds the A2DP profile proxy and starts reporting state. Safe to call repeatedly. */
    fun start() {
        if (!hasPermission()) {
            _side.value = AudioSide.UNAVAILABLE
            return
        }
        val bt = adapter ?: run {
            _side.value = AudioSide.UNAVAILABLE
            return
        }
        if (a2dp != null) {
            refresh()
            return
        }
        bt.getProfileProxy(
            context,
            object : BluetoothProfile.ServiceListener {
                override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
                    a2dp = proxy as? BluetoothA2dp
                    refresh()
                }

                override fun onServiceDisconnected(profile: Int) {
                    a2dp = null
                    _side.value = AudioSide.UNAVAILABLE
                }
            },
            BluetoothProfile.A2DP
        )
    }

    fun stop() {
        val proxy = a2dp ?: return
        runCatching { adapter?.closeProfileProxy(BluetoothProfile.A2DP, proxy) }
        a2dp = null
    }

    /** Re-derives which side currently has the headphones. */
    fun refresh() {
        if (!hasPermission()) {
            _side.value = AudioSide.UNAVAILABLE
            return
        }
        val proxy = a2dp
        val connected = runCatching { proxy?.connectedDevices.orEmpty() }.getOrDefault(emptyList())
        val target = findHeadphones(connected)
        _deviceName.value = target?.let { runCatching { it.name }.getOrNull() }
        _side.value = when {
            target == null -> AudioSide.UNAVAILABLE
            connected.any { it.address == target.address } -> AudioSide.PHONE
            else -> AudioSide.PC
        }
    }

    /** Throw the headphones to the phone: connect our A2DP link. */
    fun throwToPhone(): Boolean = driveLink(connect = true)

    /** Throw the headphones to the PC: release our A2DP link so the PC can take them. */
    fun throwToPc(): Boolean = driveLink(connect = false)

    /** Fallback when reflection is blocked: land the owner one tap away in BT settings. */
    fun openBluetoothSettings() {
        runCatching {
            context.startActivity(
                Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
    }

    private fun driveLink(connect: Boolean): Boolean {
        if (!hasPermission()) return false
        val proxy = a2dp ?: return false
        val connected = runCatching { proxy.connectedDevices.orEmpty() }.getOrDefault(emptyList())
        val target = findHeadphones(connected) ?: return false
        val method = if (connect) "connect" else "disconnect"
        return runCatching {
            BluetoothA2dp::class.java
                .getMethod(method, BluetoothDevice::class.java)
                .invoke(proxy, target) as? Boolean ?: false
        }.onFailure {
            Log.w(TAG, "A2DP $method via reflection failed", it)
        }.getOrDefault(false)
    }

    /**
     * The headphones = the connected A2DP device if there is one, else the
     * bonded device that looks like an audio sink. Owner has one headset, so
     * "first plausible match" is the whole selection story.
     */
    private fun findHeadphones(connected: List<BluetoothDevice>): BluetoothDevice? {
        connected.firstOrNull()?.let { return it }
        val bonded = runCatching { adapter?.bondedDevices.orEmpty() }.getOrDefault(emptySet())
        return bonded.firstOrNull { device ->
            val major = runCatching { device.bluetoothClass?.majorDeviceClass }.getOrNull()
            major == android.bluetooth.BluetoothClass.Device.Major.AUDIO_VIDEO
        }
    }

    private companion object {
        const val TAG = "BluetoothAudioSwitcher"
    }
}
