package com.splinch.junction

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.lifecycleScope
import com.splinch.junction.chat.ChatManager
import com.splinch.junction.chat.RoomConversationStore
import com.splinch.junction.chat.SyncingConversationStore
import com.splinch.junction.data.JunctionDatabase
import com.splinch.junction.feed.FeedRepository
import com.splinch.junction.follow.FollowRepository
import com.splinch.junction.notifications.NotificationAccessHelper
import com.splinch.junction.settings.UserPrefsRepository
import com.splinch.junction.sync.firebase.AuthManager
import com.splinch.junction.sync.firebase.ChatSyncManager
import com.splinch.junction.sync.firebase.FeedSyncManager
import com.splinch.junction.sync.firebase.PrefsSyncManager
import com.splinch.junction.ui.ChatScreen
import com.splinch.junction.ui.FeedScreen
import com.splinch.junction.ui.SettingsScreen
import com.splinch.junction.ui.theme.JunctionTheme
import com.splinch.junction.update.UpdateChecker
import com.splinch.junction.update.UpdateInfo
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val voiceOpenRequests = MutableStateFlow(0)
    private val chatOpenRequests = MutableStateFlow(0)
    private val prefsRepository by lazy { UserPrefsRepository(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestNotificationPermissionIfNeeded()
        handleIntent(intent)

        setContent {
            JunctionTheme {
                val context = LocalContext.current
                val lifecycle = (context as? androidx.activity.ComponentActivity)?.lifecycle
                val scope = rememberCoroutineScope()
                val database = remember { JunctionDatabase.getInstance(context) }
                val prefs = remember { UserPrefsRepository(context) }
                val authManager = remember { AuthManager(context) }
                val chatSyncManager = remember { ChatSyncManager(database.chatDao(), authManager) }
                val feedSyncManager = remember { FeedSyncManager(database.feedDao(), authManager) }
                val prefsSyncManager = remember { PrefsSyncManager(prefs, authManager) }
                val roomStore = remember { RoomConversationStore(database.chatDao()) }
                val conversationStore = remember { SyncingConversationStore(roomStore, chatSyncManager) }
                val feedRepository = remember { FeedRepository(database.feedDao(), feedSyncManager) }
                val followRepository = remember { FollowRepository(database.followDao()) }
                val updateState = remember { MutableStateFlow<UpdateInfo?>(null) }
                val chatManager = remember {
                    ChatManager(
                        context = context,
                        store = conversationStore,
                        feedRepository = feedRepository,
                        prefs = prefs,
                        authManager = authManager,
                        updateState = updateState
                    )
                }
                val voiceToken by voiceOpenRequests.collectAsState()
                val chatToken by chatOpenRequests.collectAsState()
                val sessionId by chatManager.sessionId.collectAsState()
                val speechModeEnabled by chatManager.speechModeEnabled.collectAsState()
                val agentToolsEnabled by chatManager.agentToolsEnabled.collectAsState()
                var lastOpenedAt by remember { mutableStateOf(0L) }

                LaunchedEffect(Unit) {
                    runCatching {
                        authManager.start()
                        chatSyncManager.start()
                        feedSyncManager.start()
                        prefsSyncManager.start()
                        chatManager.initialize()
                        lastOpenedAt = prefs.markOpenedAndGetPrevious(System.currentTimeMillis())
                        prefs.setNotificationListenerEnabled(
                            NotificationAccessHelper.isNotificationListenerEnabled(context)
                        )

                        val lastChecked = prefs.lastUpdateCheckAtFlow.first()
                        val now = System.currentTimeMillis()
                        if (now - lastChecked > 86_400_000L) {
                            scope.launch {
                                val update = UpdateChecker().checkForUpdate(BuildConfig.VERSION_NAME)
                                updateState.value = update
                                prefs.updateLastUpdateCheckAt(now)
                            }
                        }
                    }.onFailure { ex ->
                        Log.e(TAG, "Startup initialization failed", ex)
                    }
                }

                LaunchedEffect(sessionId) {
                    if (sessionId.isNotBlank()) {
                        chatSyncManager.setActiveConversation(sessionId)
                    }
                }

                LaunchedEffect(sessionId, speechModeEnabled, agentToolsEnabled) {
                    if (sessionId.isNotBlank()) {
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
                    followRepository = followRepository,
                    prefs = prefs,
                    authManager = authManager,
                    updateState = updateState,
                    lastOpenedAt = lastOpenedAt,
                    voiceToken = voiceToken,
                    chatToken = chatToken
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
    }
}

private enum class JunctionTab {
    FEED,
    CHAT,
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
    followRepository: FollowRepository,
    prefs: UserPrefsRepository,
    authManager: AuthManager,
    updateState: kotlinx.coroutines.flow.MutableStateFlow<UpdateInfo?>,
    lastOpenedAt: Long,
    voiceToken: Int,
    chatToken: Int
) {
    var selectedTab by remember { mutableStateOf(JunctionTab.FEED) }
    val feedItems by feedRepository.feedFlow.collectAsState(initial = emptyList())

    LaunchedEffect(chatToken) {
        if (chatToken > 0) {
            selectedTab = JunctionTab.CHAT
        }
    }

    LaunchedEffect(voiceToken) {
        if (voiceToken > 0) {
            selectedTab = JunctionTab.CHAT
            chatManager.setSpeechMode(true)
            chatManager.setMicEnabled(true)
        }
    }

    Scaffold(
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = selectedTab == JunctionTab.FEED,
                    onClick = { selectedTab = JunctionTab.FEED },
                    icon = { Text("Feed") },
                    label = { Text("Feed") }
                )
                NavigationBarItem(
                    selected = selectedTab == JunctionTab.CHAT,
                    onClick = { selectedTab = JunctionTab.CHAT },
                    icon = { Text("Chat") },
                    label = { Text("Chat") }
                )
                NavigationBarItem(
                    selected = selectedTab == JunctionTab.SETTINGS,
                    onClick = { selectedTab = JunctionTab.SETTINGS },
                    icon = { Text("Settings") },
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
                modifier = Modifier.padding(padding)
            )
            JunctionTab.CHAT -> ChatScreen(
                chatManager = chatManager,
                authManager = authManager,
                modifier = Modifier.padding(padding)
            )
            JunctionTab.SETTINGS -> SettingsScreen(
                userPrefs = prefs,
                feedRepository = feedRepository,
                followRepository = followRepository,
                authManager = authManager,
                modifier = Modifier.padding(padding)
            )
        }
    }
}
