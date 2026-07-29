package com.splinch.junction.ui.components

import android.Manifest
import android.bluetooth.BluetoothA2dp
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bluetooth
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.Smartphone
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.splinch.junction.platform.AudioSide
import com.splinch.junction.platform.BluetoothAudioSwitcher

/**
 * Tiny headphone "thrower": a bluetooth icon that opens a two-entry picker —
 * PC or Phone — mirroring the AI model picker's tap-to-select pattern.
 * Selecting Phone pulls the paired headset's audio to this phone; selecting
 * PC releases it so the PC can take it back.
 */
@Composable
fun BluetoothThrower(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val switcher = remember { BluetoothAudioSwitcher(context) }
    val side by switcher.side.collectAsState()
    val deviceName by switcher.deviceName.collectAsState()
    var expanded by remember { mutableStateOf(false) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            switcher.start()
            expanded = true
        } else {
            Toast.makeText(context, "Bluetooth permission denied", Toast.LENGTH_SHORT).show()
        }
    }

    DisposableEffect(Unit) {
        switcher.start()
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                switcher.refresh()
            }
        }
        ContextCompat.registerReceiver(
            context,
            receiver,
            IntentFilter(BluetoothA2dp.ACTION_CONNECTION_STATE_CHANGED),
            ContextCompat.RECEIVER_EXPORTED
        )
        onDispose {
            runCatching { context.unregisterReceiver(receiver) }
            switcher.stop()
        }
    }

    Box(modifier = modifier) {
        IconButton(
            onClick = {
                if (switcher.hasPermission()) {
                    switcher.refresh()
                    expanded = true
                } else {
                    permissionLauncher.launch(Manifest.permission.BLUETOOTH_CONNECT)
                }
            },
            modifier = Modifier.size(36.dp)
        ) {
            Icon(
                imageVector = Icons.Default.Bluetooth,
                contentDescription = "Throw Bluetooth audio",
                tint = if (side == AudioSide.PHONE) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                }
            )
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            if (side == AudioSide.UNAVAILABLE) {
                DropdownMenuItem(
                    text = { Text("No paired headphones found") },
                    onClick = { expanded = false },
                    enabled = false
                )
            } else {
                deviceName?.let { name ->
                    DropdownMenuItem(
                        text = {
                            Text(
                                text = name,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        },
                        onClick = {},
                        enabled = false
                    )
                }
                DropdownMenuItem(
                    text = { Text("PC") },
                    leadingIcon = { Icon(Icons.Default.Computer, contentDescription = null) },
                    trailingIcon = if (side == AudioSide.PC) {
                        { Icon(Icons.Default.Check, contentDescription = null) }
                    } else null,
                    onClick = {
                        expanded = false
                        if (!switcher.throwToPc()) {
                            Toast.makeText(context, "Couldn't release — opening Bluetooth settings", Toast.LENGTH_SHORT).show()
                            switcher.openBluetoothSettings()
                        }
                    }
                )
                DropdownMenuItem(
                    text = { Text("Phone") },
                    leadingIcon = { Icon(Icons.Default.Smartphone, contentDescription = null) },
                    trailingIcon = if (side == AudioSide.PHONE) {
                        { Icon(Icons.Default.Check, contentDescription = null) }
                    } else null,
                    onClick = {
                        expanded = false
                        if (!switcher.throwToPhone()) {
                            Toast.makeText(context, "Couldn't connect — opening Bluetooth settings", Toast.LENGTH_SHORT).show()
                            switcher.openBluetoothSettings()
                        }
                    }
                )
            }
        }
    }
}
