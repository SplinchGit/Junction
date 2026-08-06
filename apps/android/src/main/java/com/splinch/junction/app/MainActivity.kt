package com.splinch.junction.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.FactCheck
import androidx.compose.material.icons.filled.DynamicFeed
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.lifecycleScope
import com.splinch.junction.BuildConfig
import com.splinch.junction.assistant.runtime.ChatManager
import com.splinch.junction.feature.feed.FeedRepository
import com.splinch.junction.feature.notification.NotificationAccessHelper
import com.splinch.junction.data.secret.KeyStorage
import com.splinch.junction.data.preference.UserPrefsRepository
import com.splinch.junction.feature.onboarding.resolveOnboardingCompleted
import com.splinch.junction.data.sync.firebase.AuthManager
import com.splinch.junction.data.sync.firebase.RemoteCommandForegroundService
import com.splinch.junction.feature.chat.ui.ChatScreen
import com.splinch.junction.feature.feed.ui.FeedScreen
import com.splinch.junction.feature.audit.ui.AuditScreen
import com.splinch.junction.feature.onboarding.ui.OnboardingScreen
import com.splinch.junction.feature.settings.ui.SettingsScreen
import com.splinch.junction.ui.theme.JunctionTheme
import com.splinch.junction.feature.update.UpdateChecker
import com.splinch.junction.feature.update.UpdateInfo
import com.splinch.junction.feature.update.UpdateInstaller
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val voiceOpenRequests = MutableStateFlow(0)
    private val chatOpenRequests = MutableStateFlow(0)

    /** Bumped on every resume, so the update check can run when Junction comes forward. */
    private val foregroundTicks = MutableStateFlow(0)
    /** Prevents repeatedly reopening the installer if the owner dismisses it. */
    private var autoInstallAttemptedVersion = 0

    override fun onResume() {
        super.onResume()
        foregroundTicks.value = foregroundTicks.value + 1
    }
    private val prefsRepository by lazy { (application as JunctionApplication).container.prefs }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestNotificationPermissionIfNeeded()
        handleIntent(intent)

        setContent {
            JunctionTheme {
                val context = LocalContext.current
                val lifecycle = (context as? ComponentActivity)?.lifecycle
                val scope = rememberCoroutineScope()
                // Application-scoped: see AppContainer for why ChatManager and the sync
                // managers can no longer live in this Composable's remember{} the way they
                // used to. MainActivity and RemoteCommandForegroundService share this same
                // instance.
                val container = remember { (context.applicationContext as JunctionApplication).container }
                val database = container.database
                val prefs = container.prefs
                val authManager = container.authManager
                val chatSyncManager = container.chatSyncManager
                val feedSyncManager = container.feedSyncManager
                val prefsSyncManager = container.prefsSyncManager
                val auditSyncManager = container.auditSyncManager
                val feedRepository = container.feedRepository
                val updateState = container.updateState
                val chatManager = container.chatManager
                val firebaseSyncEnabled by prefs.firebaseSyncEnabledFlow.collectAsState(initial = false)
                val voiceToken by voiceOpenRequests.collectAsState()
                val chatToken by chatOpenRequests.collectAsState()
                val sessionId by chatManager.sessionId.collectAsState()
                val speechModeEnabled by chatManager.speechModeEnabled.collectAsState()
                val agentToolsEnabled by chatManager.agentToolsEnabled.collectAsState()
                var lastOpenedAt by remember { mutableLongStateOf(0L) }

                LaunchedEffect(Unit) {
                    runCatching {
                        chatManager.initialize()
                        lastOpenedAt = prefs.markOpenedAndGetPrevious(System.currentTimeMillis())
                        prefs.setNotificationListenerEnabled(
                            NotificationAccessHelper.isNotificationListenerEnabled(context)
                        )
                    }.onFailure { ex ->
                        Log.e(TAG, "Startup initialization failed", ex)
                    }
                }

                // Every time Junction comes to the foreground, not only on a cold start.
                // A build published while the app sat in the background was invisible until
                // it was force-closed and reopened -- and then only if four hours had gone
                // by. Now switching away and back is enough, and the check is one small
                // JSON GET behind a short cooldown.
                val foregroundTick by foregroundTicks.collectAsState()
                LaunchedEffect(foregroundTick) {
                    runCatching {
                        val lastChecked = prefs.lastUpdateCheckAtFlow.first()
                        val now = System.currentTimeMillis()
                        if (now - lastChecked <= UPDATE_CHECK_INTERVAL_MS) return@runCatching
                        prefs.updateLastUpdateCheckAt(now)
                        val update = UpdateChecker().checkForUpdate(BuildConfig.JUNCTION_VERSION_CODE)
                        updateState.value = update
                        // Trusted updates are automatic once Junction has permission to
                        // request package installs. The installer still owns the final
                        // Android consent dialog; checksum, signing-key, and rollback
                        // checks remain inside UpdateInstaller before that dialog opens.
                        if (update != null &&
                            update.versionCode > autoInstallAttemptedVersion &&
                            UpdateInstaller(context).canInstallPackages()
                        ) {
                            autoInstallAttemptedVersion = update.versionCode
                            UpdateInstaller(context).downloadAndRequestInstall(update)
                                .onFailure { error -> Log.w(TAG, "Automatic update could not start", error) }
                        }
                    }.onFailure { ex ->
                        Log.w(TAG, "Update check failed", ex)
                    }
                }

                LaunchedEffect(firebaseSyncEnabled) {
                    if (firebaseSyncEnabled) {
                        runCatching {
                            authManager.start()
                            chatSyncManager.start()
                            feedSyncManager.start()
                            prefsSyncManager.start()
                            auditSyncManager.start()
                        }.onFailure { ex ->
                            Log.e(TAG, "Firebase sync initialization failed", ex)
                        }
                        // Owns RemoteCommandSyncManager's start/stop exclusively from here on,
                        // so it keeps listening after the Activity backgrounds or is swiped
                        // away -- see RemoteCommandForegroundService.
                        RemoteCommandForegroundService.start(context)
                    } else {
                        authManager.stop()
                        auditSyncManager.stop()
                        RemoteCommandForegroundService.stop(context)
                    }
                }

                LaunchedEffect(sessionId) {
                    if (sessionId.isNotBlank() && firebaseSyncEnabled) {
                        chatSyncManager.setActiveConversation(sessionId)
                    }
                }

                LaunchedEffect(sessionId, speechModeEnabled, agentToolsEnabled) {
                    if (sessionId.isNotBlank() && firebaseSyncEnabled) {
                        chatSyncManager.updateConversationMetadata(
                            conversationId = sessionId,
                            speechModeEnabled = speechModeEnabled,
                            agentToolsEnabled = agentToolsEnabled
                        )
                    }
                }

                DisposableEffect(lifecycle) {
                    val observer = LifecycleEventObserver { _, event ->
                        if (event == Lifecycle.Event.ON_RESUME) {
                            val enabled = NotificationAccessHelper.isNotificationListenerEnabled(context)
                            scope.launch {
                                prefs.setNotificationListenerEnabled(enabled)
                            }
                        }
                    }
                    lifecycle?.addObserver(observer)
                    onDispose { lifecycle?.removeObserver(observer) }
                }

                JunctionApp(
                    chatManager = chatManager,
                    feedRepository = feedRepository,
                    prefs = prefs,
                    authManager = authManager,
                    updateState = updateState,
                    lastOpenedAt = lastOpenedAt,
                    voiceToken = voiceToken,
                    chatToken = chatToken,
                    actionLogDao = database.actionLogDao(),
                    modelUsageDao = database.modelUsageDao(),
                    memoryFactDao = database.memoryFactDao()
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        val data = intent?.data
        if (data != null && data.scheme == "junction" && data.host == "oauth-callback") {
            val provider = data.getQueryParameter("provider")
            val status = data.getQueryParameter("status")
            if (!provider.isNullOrBlank() && status == "connected") {
                lifecycleScope.launch {
                    prefsRepository.setIntegrationConnected(provider, true)
                }
                Toast.makeText(
                    applicationContext,
                    "Connected: ${provider.replaceFirstChar { it.uppercase() }}",
                    Toast.LENGTH_SHORT
                ).show()
            }
        }
        if (intent?.getBooleanExtra(EXTRA_OPEN_VOICE, false) == true) {
            voiceOpenRequests.value = voiceOpenRequests.value + 1
        } else if (intent?.getBooleanExtra(EXTRA_OPEN_CHAT, false) == true) {
            chatOpenRequests.value = chatOpenRequests.value + 1
        }
    }

    companion object {
        const val EXTRA_OPEN_CHAT = "extra_open_chat"
        const val EXTRA_OPEN_VOICE = "extra_open_voice"
        private const val TAG = "MainActivity"

        /**
         * How stale an update check may be before startup runs another. `main` can land
         * several builds in a day, so a 24h gap meant routinely running days-old code.
         * The check is a single small JSON GET, so this is cheap to do often.
         */
        /**
         * Cooldown between update checks. Short, because the check is a few hundred bytes
         * of JSON and the whole point is that a build pushed minutes ago is offered
         * without the owner having to think about it. It was four hours, which meant a
         * fresh build could sit unnoticed for most of a day.
         */
        private const val UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000L
    }
}

private enum class JunctionTab {
    FEED,
    CHAT,
    AUDIT,
    SETTINGS
}

private fun ComponentActivity.requestNotificationPermissionIfNeeded() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        val permission = Manifest.permission.POST_NOTIFICATIONS
        val granted = ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            ActivityCompat.requestPermissions(this, arrayOf(permission), 2001)
        }
    }
}

@Composable
private fun JunctionApp(
    chatManager: ChatManager,
    feedRepository: FeedRepository,
    prefs: UserPrefsRepository,
    authManager: AuthManager,
    updateState: MutableStateFlow<UpdateInfo?>,
    lastOpenedAt: Long,
    voiceToken: Int,
    chatToken: Int,
    actionLogDao: com.splinch.junction.data.database.audit.ActionLogDao,
    modelUsageDao: com.splinch.junction.data.database.usage.ModelUsageDao,
    memoryFactDao: com.splinch.junction.data.database.memory.MemoryFactDao
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var selectedTab by remember { mutableStateOf(JunctionTab.FEED) }
    val feedItems by feedRepository.feedFlow.collectAsState(initial = emptyList())

    LaunchedEffect(chatToken) {
        if (chatToken > 0) selectedTab = JunctionTab.CHAT
    }

    LaunchedEffect(voiceToken) {
        if (voiceToken > 0) {
            selectedTab = JunctionTab.CHAT
            chatManager.setSpeechMode(true)
            chatManager.setMicEnabled(true)
        }
    }

    val keyStorage = remember { KeyStorage(context) }
    var migrationChecked by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        resolveOnboardingCompleted(prefs, keyStorage)
        migrationChecked = true
    }

    if (!migrationChecked) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }

    val onboardingCompleted by prefs.onboardingCompletedFlow.collectAsState(initial = true)
    if (!onboardingCompleted) {
        OnboardingScreen(userPrefs = prefs, onFinished = {})
        return
    }

    Scaffold(
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = selectedTab == JunctionTab.FEED,
                    onClick = { selectedTab = JunctionTab.FEED },
                    icon = { Icon(Icons.Default.DynamicFeed, contentDescription = null) },
                    label = { Text("Feed") }
                )
                NavigationBarItem(
                    selected = selectedTab == JunctionTab.CHAT,
                    onClick = { selectedTab = JunctionTab.CHAT },
                    icon = { Icon(Icons.AutoMirrored.Filled.Chat, contentDescription = null) },
                    label = { Text("Chat") }
                )
                NavigationBarItem(
                    selected = selectedTab == JunctionTab.AUDIT,
                    onClick = { selectedTab = JunctionTab.AUDIT },
                    icon = { Icon(Icons.AutoMirrored.Filled.FactCheck, contentDescription = null) },
                    label = { Text("Audit") }
                )
                NavigationBarItem(
                    selected = selectedTab == JunctionTab.SETTINGS,
                    onClick = { selectedTab = JunctionTab.SETTINGS },
                    icon = { Icon(Icons.Default.Settings, contentDescription = null) },
                    label = { Text("Settings") }
                )
            }
        }
    ) { padding ->
        when (selectedTab) {
            JunctionTab.FEED -> FeedScreen(
                items = feedItems,
                lastOpenedAt = lastOpenedAt,
                feedRepository = feedRepository,
                updateInfo = updateState.collectAsState().value,
                onAskChat = { item, voice ->
                    selectedTab = JunctionTab.CHAT
                    scope.launch {
                        chatManager.reviewFeedItem(item)
                        if (voice) {
                            chatManager.setSpeechMode(true)
                            chatManager.setMicEnabled(true)
                        } else {
                            chatManager.setSpeechMode(false)
                            chatManager.setMicEnabled(false)
                        }
                    }
                },
                modifier = Modifier.padding(padding)
            )
            JunctionTab.CHAT -> ChatScreen(
                chatManager = chatManager,
                modifier = Modifier.padding(padding)
            )
            JunctionTab.AUDIT -> AuditScreen(
                actionLogDao = actionLogDao,
                modelUsageDao = modelUsageDao,
                modifier = Modifier.padding(padding)
            )
            JunctionTab.SETTINGS -> SettingsScreen(
                userPrefs = prefs,
                feedRepository = feedRepository,
                authManager = authManager,
                chatManager = chatManager,
                actionLogDao = actionLogDao,
                memoryFactDao = memoryFactDao,
                modifier = Modifier.padding(padding)
            )
        }
    }
}
