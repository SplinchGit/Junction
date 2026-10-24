package com.splinch.junction.feature.settings.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.splinch.junction.assistant.runtime.ChatManager
import com.splinch.junction.data.preference.AppearancePrefs
import com.splinch.junction.data.preference.UserPrefsRepository
import com.splinch.junction.data.preference.VoicePrefs
import kotlinx.coroutines.launch

@Composable
fun AppearanceSettings(prefs: UserPrefsRepository) {
    val value by prefs.appearanceFlow.collectAsState(initial = AppearancePrefs())
    val scope = rememberCoroutineScope()
    fun save(next: AppearancePrefs) { scope.launch { prefs.setAppearance(next) } }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Appearance", style = MaterialTheme.typography.titleMedium)
        SettingChoice("Mode", value.mode, listOf("system" to "System", "light" to "Light", "dark" to "Dark")) { save(value.copy(mode = it)) }
        SettingChoice("Palette", value.palette, listOf("junction" to "Junction", "sakura" to "Sakura", "moss" to "Moss")) { save(value.copy(palette = it)) }
        SettingChoice("Artwork", value.artwork, listOf("none" to "None", "sakura-mountain" to "Sakura Mountain")) { save(value.copy(artwork = it)) }
        if (value.artwork != "none") {
            Text("Background intensity: ${value.backgroundIntensity}%")
            Slider(value = value.backgroundIntensity.toFloat(), onValueChange = { save(value.copy(backgroundIntensity = it.toInt())) }, valueRange = 0f..100f)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Falling petals", modifier = Modifier.weight(1f))
                Switch(checked = value.petals, onCheckedChange = { save(value.copy(petals = it)) })
            }
            if (value.petals) {
                Text("Petal intensity: ${value.petalIntensity}%")
                Slider(value = value.petalIntensity.toFloat(), onValueChange = { save(value.copy(petalIntensity = it.toInt())) }, valueRange = 0f..100f)
            }
        }
        SettingChoice("Motion", value.motion, listOf("system" to "Follow system", "reduced" to "Reduced", "full" to "Enabled")) { save(value.copy(motion = it)) }
        Text("Animation pauses when the app is hidden or power saving is enabled.", style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
fun VoiceIdentitySettings(prefs: UserPrefsRepository, chat: ChatManager) {
    val value by prefs.voicePrefsFlow.collectAsState(initial = VoicePrefs())
    val identity by chat.ttsIdentity.collectAsState()
    val call by chat.voiceCallStatus.collectAsState()
    val scope = rememberCoroutineScope()
    var result by remember { mutableStateOf("") }
    var candidate by remember(value.azureVoice) { mutableStateOf(value.azureVoice) }
    val voices = chat.installedDeviceVoices()
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Speech voice", style = MaterialTheme.typography.titleMedium)
        Text(identity?.let { "Last speech: ${it.describe()}" } ?: "No speech has played yet. The actual engine and voice will appear here after a reply.")
        Text("Your existing voice remains the default. Azure synthesis sends reply text to Azure and may incur charges; if it fails, the phone's TTS engine is used.", style = MaterialTheme.typography.bodySmall)
        SettingChoice("Azure audio", value.azureQuality, listOf("standard" to "Original · 24 kHz / 48 kbps", "high" to "Higher bitrate · 48 kHz / 96 kbps", "studio" to "High fidelity · 48 kHz / 192 kbps")) {
            scope.launch { chat.setVoicePrefs(value.copy(azureQuality = it)) }
        }
        Text("Higher bitrate keeps the same voice; it does not restore detail missing from the synthesis.", style = MaterialTheme.typography.bodySmall)
        OutlinedButton(enabled = !call.isLive, onClick = {
            result = if (chat.previewVoice(value, cloud = true)) "Playing Azure sample (network synthesis)." else "Add an Azure key and end any active call before previewing."
        }) { Text("Preview current Azure voice") }
        Text("British voice previews", style = MaterialTheme.typography.titleSmall)
        Text("Try a relaxed British voice and choose by ear. These are stock voices, not an imitation of a named person. HD voices may cost more and availability depends on your Azure region.", style = MaterialTheme.typography.bodySmall)
        SettingChoice("Preview candidate", candidate, listOf(
            VoicePrefs.AZURE_DEFAULT_VOICE to "Ollie · original",
            VoicePrefs.AZURE_HD_VOICE to "Ollie HD · same persona",
            "en-GB-SoniaNeural" to "Sonia · British female",
            "en-GB-LibbyNeural" to "Libby · British female",
            "en-GB-Sonia:DragonHDLatestNeural" to "Sonia HD · British female",
            "en-GB-Ada:DragonHDLatestNeural" to "Ada HD · British female"
        )) { candidate = it }
        OutlinedButton(enabled = !call.isLive, onClick = {
            result = if (chat.previewVoice(value.copy(azureVoice = candidate, azureQuality = "studio"), cloud = true))
                "Preview requested at 48 kHz / 192 kbps. Your saved voice has not changed." else "Add an Azure key and end the active call before previewing."
        }) { Text("Preview candidate") }
        Button(enabled = !call.isLive, onClick = {
            scope.launch { chat.setVoicePrefs(value.copy(azureVoice = candidate, azureQuality = "studio")) }
            result = "Voice saved with high-fidelity audio. The original Ollie voice remains available above."
        }) { Text("Use selected voice") }
        SettingChoice("Phone fallback voice", value.deviceVoice,
            listOf("" to "Engine default", VoicePrefs.DEVICE_BEST_OFFLINE to "Best installed offline voice") +
                voices.filter { it.installed }.map { it.name to "${it.name} · ${it.locale.toLanguageTag()}${if (it.networkRequired) " · network" else " · offline"}" }) {
            scope.launch { chat.setVoicePrefs(value.copy(deviceVoice = it)) }
        }
        OutlinedButton(enabled = !call.isLive, onClick = {
            result = if (chat.previewVoice(value, cloud = false)) "Playing phone voice sample." else "End the active call before previewing."
        }) { Text("Preview phone voice") }
        if (result.isNotBlank()) Text(result, style = MaterialTheme.typography.bodySmall)
        Text("Spoken approvals apply only to supported actions in an active local call after the proposal is read. Say ‘confirm’; a bare ‘yes’ does not approve. Email sending, notification replies and higher-risk actions still need the screen.", style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun SettingChoice(label: String, selected: String, options: List<Pair<String, String>>, change: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { expanded = true }) { Text("$label: ${options.firstOrNull { it.first == selected }?.second ?: selected}") }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { (key, title) -> DropdownMenuItem(text = { Text(title) }, onClick = { expanded = false; change(key) }) }
        }
    }
}
