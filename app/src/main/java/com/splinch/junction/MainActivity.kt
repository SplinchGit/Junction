package com.splinch.junction

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.splinch.junction.chat.BackendFactory
import com.splinch.junction.chat.ChatManager
import com.splinch.junction.chat.RoomConversationStore
import com.splinch.junction.data.JunctionDatabase
import com.splinch.junction.feed.FeedRepository
import com.splinch.junction.settings.SettingsRepository
import com.splinch.junction.ui.ChatScreen
import com.splinch.junction.ui.FeedScreen
import com.splinch.junction.ui.SettingsScreen
import com.splinch.junction.ui.theme.JunctionTheme
import kotlinx.coroutines.flow.MutableStateFlow

class MainActivity : ComponentActivity() {
    private val voiceOpenRequests = MutableStateFlow(0)
    private val chatOpenRequests = MutableStateFlow(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestNotificationPermissionIfNeeded()
        handleIntent(intent)

        setContent {
            JunctionTheme {
                val context = LocalContext.current
                val database = remember { JunctionDatabase.getInstance(context) }
                val settingsRepository = remember { SettingsRepository(context) }
                val backendProvider = remember { BackendFactory.provider(settingsRepository) }
                val chatManager = remember {
                    ChatManager(
                        store = RoomConversationStore(database.chatDao()),
                        backendProvider = backendProvider
                    )
                }
                val feedRepository = remember { FeedRepository(database.feedDao()) }

                val voiceToken by voiceOpenRequests.collectAsState()
                val chatToken by chatOpenRequests.collectAsState()

                JunctionApp(chatManager, feedRepository, settingsRepository, voiceToken, chatToken)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent?.getBooleanExtra(EXTRA_OPEN_VOICE, false) == true) {
            voiceOpenRequests.value = voiceOpenRequests.value + 1
        } else if (intent?.getBooleanExtra(EXTRA_OPEN_CHAT, false) == true) {
            chatOpenRequests.value = chatOpenRequests.value + 1
        }
    }

    companion object {
        const val EXTRA_OPEN_CHAT = "extra_open_chat"
        const val EXTRA_OPEN_VOICE = "extra_open_voice"
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
    settingsRepository: SettingsRepository,
    voiceToken: Int,
    chatToken: Int
) {
    var selectedTab by remember { mutableStateOf(JunctionTab.FEED) }
    val feed by feedRepository.eventsFlow.collectAsState(initial = emptyList())

    LaunchedEffect(Unit) {
        chatManager.initialize()
        feedRepository.seedIfEmpty()
    }

    LaunchedEffect(chatToken) {
        if (chatToken > 0) {
            selectedTab = JunctionTab.CHAT
        }
    }

    LaunchedEffect(voiceToken) {
        if (voiceToken > 0) {
            selectedTab = JunctionTab.CHAT
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
            JunctionTab.FEED -> FeedScreen(feed, modifier = Modifier.padding(padding))
            JunctionTab.CHAT -> ChatScreen(
                chatManager,
                voiceRequestToken = voiceToken,
                modifier = Modifier.padding(padding)
            )
            JunctionTab.SETTINGS -> SettingsScreen(
                settingsRepository,
                modifier = Modifier.padding(padding)
            )
        }
    }
}
