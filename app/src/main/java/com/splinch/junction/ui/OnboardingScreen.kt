package com.splinch.junction.ui

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.splinch.junction.chat.provider.ProviderCatalog
import com.splinch.junction.chat.provider.ProviderCatalogEntry
import com.splinch.junction.settings.KeyStorage
import com.splinch.junction.settings.ProviderConfig
import com.splinch.junction.settings.UserPrefsRepository
import com.splinch.junction.ui.components.JunctionTextField
import com.splinch.junction.ui.theme.BrandBlue
import com.splinch.junction.ui.theme.BrandViolet
import kotlinx.coroutines.launch

private enum class OnboardingStep { WELCOME, PROVIDER_PICKER, API_KEY, FINISH }

@Composable
fun OnboardingScreen(
    userPrefs: UserPrefsRepository,
    onFinished: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val keyStorage = remember { KeyStorage(context) }

    var step by remember { mutableStateOf(OnboardingStep.WELCOME) }
    var selectedProviderId by remember { mutableStateOf("anthropic") }
    var apiKeyInput by remember { mutableStateOf("") }
    var baseUrlInput by remember { mutableStateOf("") }

    fun completeOnboarding() {
        scope.launch {
            userPrefs.setOnboardingCompleted(true)
            onFinished()
        }
    }

    fun saveProviderAndContinue() {
        scope.launch {
            userPrefs.setProviderConfig(
                ProviderConfig(providerId = selectedProviderId, baseUrl = baseUrlInput.trim())
            )
            if (apiKeyInput.isNotBlank()) {
                keyStorage.setApiKey(selectedProviderId, apiKeyInput.trim())
            }
            step = OnboardingStep.FINISH
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp, vertical = 32.dp)
    ) {
        OnboardingProgressDots(step = step, modifier = Modifier.align(Alignment.CenterHorizontally))
        Spacer(Modifier.height(24.dp))

        Box(modifier = Modifier.weight(1f)) {
            when (step) {
                OnboardingStep.WELCOME -> WelcomeStep(
                    onGetStarted = { step = OnboardingStep.PROVIDER_PICKER },
                    onSkip = { completeOnboarding() }
                )
                OnboardingStep.PROVIDER_PICKER -> ProviderPickerStep(
                    selectedId = selectedProviderId,
                    onSelect = { selectedProviderId = it },
                    onNext = { step = OnboardingStep.API_KEY },
                    onBack = { step = OnboardingStep.WELCOME }
                )
                OnboardingStep.API_KEY -> ApiKeyStep(
                    entry = ProviderCatalog.byId(selectedProviderId) ?: ProviderCatalog.entries.first(),
                    apiKeyInput = apiKeyInput,
                    onApiKeyChange = { apiKeyInput = it },
                    baseUrlInput = baseUrlInput,
                    onBaseUrlChange = { baseUrlInput = it },
                    onSaveAndContinue = { saveProviderAndContinue() },
                    onSkip = { completeOnboarding() },
                    onBack = { step = OnboardingStep.PROVIDER_PICKER }
                )
                OnboardingStep.FINISH -> FinishStep(onDone = { completeOnboarding() })
            }
        }
    }
}

@Composable
private fun OnboardingProgressDots(step: OnboardingStep, modifier: Modifier = Modifier) {
    Row(modifier = modifier, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OnboardingStep.entries.forEach { s ->
            val active = s.ordinal <= step.ordinal
            Box(
                modifier = Modifier
                    .size(if (s == step) 10.dp else 8.dp)
                    .clip(CircleShape)
                    .background(
                        if (active) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.surfaceVariant
                    )
            )
        }
    }
}

@Composable
private fun WelcomeStep(onGetStarted: () -> Unit, onSkip: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(120.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(Brush.linearGradient(listOf(BrandBlue, BrandViolet))),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "Junction",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
                color = Color.White
            )
        }
        Spacer(Modifier.height(24.dp))
        Text(text = "Let's set up your AI", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))
        Text(
            text = "Junction needs an AI provider to power chat. Bring your own API key from " +
                "Anthropic, OpenAI, DeepSeek, or any OpenAI-compatible endpoint — takes about a minute.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(Modifier.height(32.dp))
        Button(onClick = onGetStarted, modifier = Modifier.fillMaxWidth()) {
            Text("Get started")
        }
        Spacer(Modifier.height(8.dp))
        TextButton(onClick = onSkip, modifier = Modifier.fillMaxWidth()) {
            Text("Skip for now")
        }
    }
}

@Composable
private fun ProviderPickerStep(
    selectedId: String,
    onSelect: (String) -> Unit,
    onNext: () -> Unit,
    onBack: () -> Unit
) {
    Column(modifier = Modifier.fillMaxSize()) {
        Text(text = "Choose your AI provider", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(4.dp))
        Text(
            text = "You can change this any time in Settings.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(Modifier.height(16.dp))
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            ProviderCatalog.entries.forEach { entry ->
                ProviderCard(entry = entry, selected = entry.id == selectedId, onClick = { onSelect(entry.id) })
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            TextButton(onClick = onBack) { Text("Back") }
            Button(onClick = onNext) { Text("Continue") }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ProviderCard(entry: ProviderCatalogEntry, selected: Boolean, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .border(
                width = if (selected) 2.dp else 1.dp,
                color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant,
                shape = MaterialTheme.shapes.medium
            ),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(
            containerColor = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface
        )
    ) {
        Row(
            modifier = Modifier
                .padding(16.dp)
                .fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            RadioButton(selected = selected, onClick = onClick)
            Spacer(Modifier.width(8.dp))
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(text = entry.displayName, style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.width(8.dp))
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(MaterialTheme.colorScheme.secondaryContainer)
                            .padding(horizontal = 8.dp, vertical = 2.dp)
                    ) {
                        Text(
                            text = entry.recommendationTag,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSecondaryContainer
                        )
                    }
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    text = entry.recommendationDetail,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun ApiKeyStep(
    entry: ProviderCatalogEntry,
    apiKeyInput: String,
    onApiKeyChange: (String) -> Unit,
    baseUrlInput: String,
    onBaseUrlChange: (String) -> Unit,
    onSaveAndContinue: () -> Unit,
    onSkip: () -> Unit,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    Column(modifier = Modifier.fillMaxSize()) {
        Text(text = "Get your ${entry.displayName} API key", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))
        Text(
            text = "Junction uses ${entry.defaultWorkhorseModel} by default. Your key stays on this " +
                "device, encrypted, and is sent only to ${entry.displayName}'s API.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(Modifier.height(16.dp))
        if (entry.apiKeyUrl != null) {
            OutlinedButton(
                onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, entry.apiKeyUrl.toUri())) },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Open ${entry.displayName} to create a key")
            }
            Spacer(Modifier.height(16.dp))
        }
        JunctionTextField(
            value = apiKeyInput,
            onValueChange = onApiKeyChange,
            label = "API key",
            isPassword = true
        )
        if (entry.requiresBaseUrl) {
            Spacer(Modifier.height(12.dp))
            JunctionTextField(
                value = baseUrlInput,
                onValueChange = onBaseUrlChange,
                label = "Base URL",
                placeholder = "https://api.example.com/v1"
            )
        }
        Spacer(Modifier.weight(1f))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            TextButton(onClick = onBack) { Text("Back") }
            Button(onClick = onSaveAndContinue, enabled = apiKeyInput.isNotBlank()) {
                Text("Save & continue")
            }
        }
        TextButton(onClick = onSkip, modifier = Modifier.fillMaxWidth()) {
            Text("Skip for now")
        }
    }
}

@Composable
private fun FinishStep(onDone: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center
    ) {
        Text(text = "You're all set!", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))
        Text(
            text = "You can change AI providers at any time here! Just open Settings > AI Provider.",
            style = MaterialTheme.typography.bodyLarge
        )
        Spacer(Modifier.height(32.dp))
        Button(onClick = onDone, modifier = Modifier.fillMaxWidth()) {
            Text("Done")
        }
    }
}
