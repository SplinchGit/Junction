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
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.FactCheck
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
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
import com.splinch.junction.feature.chat.ui.JunctionDrawerContent
import com.splinch.junction.feature.calculator.CalculatorClient
import com.splinch.junction.feature.calculator.ui.CalculatorScreen
import com.splinch.junction.feature.music.ui.MusicEditorScreen
import com.splinch.junction.feature.audit.ui.AuditScreen
import com.splinch.junction.feature.onboarding.ui.OnboardingScreen
import com.splinch.junction.feature.settings.ui.SettingsScreen
import com.splinch.junction.ui.theme.JunctionTheme
import com.splinch.junction.feature.update.UpdateChecker
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
                val calculatorClient = container.calculatorClient
                val firebaseSyncEnabled by prefs.firebaseSyncEnabledFlow.collectAsState(initial = false)
                val voiceToken by voiceOpenRequests.collectAsState()
                val chatToken by chatOpenRequests.collectAsState()
                val sessionId by chatManager.sessionId.collectAsState()
                val speechModeEnabled by chatManager.speechModeEnabled.collectAsState()
                val agentToolsEnabled by chatManager.agentToolsEnabled.collectAsState()
                LaunchedEffect(Unit) {
                    runCatching {
                        chatManager.initialize()
                        prefs.markOpenedAndGetPrevious(System.currentTimeMillis())
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
                            container.sharedStateSyncManager.start()
                        }.onFailure { ex ->
                            Log.e(TAG, "Firebase sync initialization failed", ex)
                        }
                        // Owns RemoteCommandSyncManager's start/stop exclusively from here on,
                        // so it keeps listening after the Activity backgrounds or is swiped
                        // away -- see RemoteCommandForegroundService.
                        RemoteCommandForegroundService.start(context)
                    } else {
                        chatSyncManager.stop()
                        feedSyncManager.stop()
                        prefsSyncManager.stop()
                        auditSyncManager.stop()
                        container.sharedStateSyncManager.stop()
                        RemoteCommandForegroundService.stop(context)
                        authManager.stop()
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
                    calculatorClient = calculatorClient,
                    feedRepository = feedRepository,
                    prefs = prefs,
                    authManager = authManager,
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
    CHAT,
    AUDIT
}

private enum class JunctionWorkspace {
    CHAT,
    BUILD,
    MUSIC,
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
    calculatorClient: CalculatorClient,
    feedRepository: FeedRepository,
    prefs: UserPrefsRepository,
    authManager: AuthManager,
    voiceToken: Int,
    chatToken: Int,
    actionLogDao: com.splinch.junction.data.database.audit.ActionLogDao,
    modelUsageDao: com.splinch.junction.data.database.usage.ModelUsageDao,
    memoryFactDao: com.splinch.junction.data.database.memory.MemoryFactDao
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var selectedTab by remember { mutableStateOf(JunctionTab.CHAT) }
    var selectedWorkspace by remember { mutableStateOf(JunctionWorkspace.CHAT) }
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val sessionSummaries by chatManager.sessionSummaries.collectAsState(initial = emptyList())
    val currentSessionId by chatManager.sessionId.collectAsState()

    LaunchedEffect(chatToken) {
        if (chatToken > 0) {
            selectedTab = JunctionTab.CHAT
            selectedWorkspace = JunctionWorkspace.CHAT
        }
    }

    LaunchedEffect(voiceToken) {
        if (voiceToken > 0) {
            selectedTab = JunctionTab.CHAT
            selectedWorkspace = JunctionWorkspace.CHAT
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

    ModalNavigationDrawer(
        drawerState = drawerState,
        gesturesEnabled = selectedTab == JunctionTab.CHAT,
        drawerContent = {
            ModalDrawerSheet {
                JunctionDrawerContent(
                    sessions = sessionSummaries,
                    currentSessionId = currentSessionId,
                    onNewChat = {
                        scope.launch {
                            chatManager.startNewChat()
                            selectedWorkspace = JunctionWorkspace.CHAT
                            drawerState.close()
                        }
                    },
                    onSelect = { id ->
                        scope.launch {
                            chatManager.switchToSession(id)
                            selectedWorkspace = JunctionWorkspace.CHAT
                            drawerState.close()
                        }
                    },
                    onDelete = { id -> scope.launch { chatManager.deleteSession(id) } },
                    onOpenBuild = {
                        selectedWorkspace = JunctionWorkspace.BUILD
                        scope.launch { drawerState.close() }
                    },
                    onOpenMusic = {
                        selectedWorkspace = JunctionWorkspace.MUSIC
                        scope.launch { drawerState.close() }
                    }
                )
            }
        }
    ) {
        Scaffold(
            bottomBar = {
                NavigationBar {
                NavigationBarItem(
                    selected = selectedTab == JunctionTab.CHAT,
                    onClick = {
                        selectedTab = JunctionTab.CHAT
                        selectedWorkspace = JunctionWorkspace.CHAT
                    },
                    icon = { Icon(Icons.AutoMirrored.Filled.Chat, contentDescription = null) },
                    label = { Text("Chat") }
                )
                NavigationBarItem(
                    selected = selectedTab == JunctionTab.AUDIT,
                    onClick = { selectedTab = JunctionTab.AUDIT },
                    icon = { Icon(Icons.AutoMirrored.Filled.FactCheck, contentDescription = null) },
                    label = { Text("Audit") }
                )
                }
            }
        ) { padding ->
            when (selectedTab) {
                JunctionTab.CHAT -> when (selectedWorkspace) {
                    JunctionWorkspace.CHAT -> ChatScreen(
                        chatManager = chatManager,
                        onOpenNavigation = { scope.launch { drawerState.open() } },
                        onOpenSettings = { selectedWorkspace = JunctionWorkspace.SETTINGS },
                        modifier = Modifier.padding(padding)
                    )
                    JunctionWorkspace.BUILD -> WorkspaceScreen(
                        title = "Build",
                        onOpenNavigation = { scope.launch { drawerState.open() } },
                        onBackToChat = { selectedWorkspace = JunctionWorkspace.CHAT },
                        modifier = Modifier.padding(padding)
                    ) { contentModifier ->
                        CalculatorScreen(client = calculatorClient, modifier = contentModifier)
                    }
                    JunctionWorkspace.MUSIC -> WorkspaceScreen(
                        title = "Music",
                        onOpenNavigation = { scope.launch { drawerState.open() } },
                        onBackToChat = { selectedWorkspace = JunctionWorkspace.CHAT },
                        modifier = Modifier.padding(padding)
                    ) { contentModifier ->
                        MusicEditorScreen(modifier = contentModifier)
                    }
                    JunctionWorkspace.SETTINGS -> WorkspaceScreen(
                        title = "Settings",
                        onOpenNavigation = { scope.launch { drawerState.open() } },
                        onBackToChat = { selectedWorkspace = JunctionWorkspace.CHAT },
                        modifier = Modifier.padding(padding)
                    ) { contentModifier ->
                        SettingsScreen(
                            userPrefs = prefs,
                            feedRepository = feedRepository,
                            authManager = authManager,
                            chatManager = chatManager,
                            actionLogDao = actionLogDao,
                            memoryFactDao = memoryFactDao,
                            modifier = contentModifier
                        )
                    }
                }
                JunctionTab.AUDIT -> AuditScreen(
                    actionLogDao = actionLogDao,
                    modelUsageDao = modelUsageDao,
                    modifier = Modifier.padding(padding)
                )
            }
        }
    }
}

@Composable
private fun WorkspaceScreen(
    title: String,
    onOpenNavigation: () -> Unit,
    onBackToChat: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable (Modifier) -> Unit
) {
    Column(modifier = modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onOpenNavigation) {
                Icon(Icons.Default.Menu, contentDescription = "Open navigation")
            }
            Text(text = title, modifier = Modifier.weight(1f))
            TextButton(onClick = onBackToChat) { Text("Back to chat") }
        }
        content(Modifier.weight(1f).fillMaxWidth())
    }
}
