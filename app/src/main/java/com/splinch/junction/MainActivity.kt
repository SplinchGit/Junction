package com.splinch.junction

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.splinch.junction.chat.ChatManager
import com.splinch.junction.ui.ChatScreen
import com.splinch.junction.ui.FeedScreen
import com.splinch.junction.ui.theme.JunctionTheme
import com.splinch.junction.feed.MockFeedData
import com.splinch.junction.feed.SocialEvent

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            JunctionTheme {
                val chatManager = remember { ChatManager() }
                val feed = remember { MockFeedData.build() }
                JunctionApp(chatManager, feed)
            }
        }
    }
}

private enum class JunctionTab {
    FEED,
    CHAT
}

@Composable
private fun JunctionApp(chatManager: ChatManager, feed: List<SocialEvent>) {
    var selectedTab by remember { mutableStateOf(JunctionTab.FEED) }

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
            }
        }
    ) { padding ->
        when (selectedTab) {
            JunctionTab.FEED -> FeedScreen(feed, modifier = Modifier.padding(padding))
            JunctionTab.CHAT -> ChatScreen(chatManager, modifier = Modifier.padding(padding))
        }
    }
}
