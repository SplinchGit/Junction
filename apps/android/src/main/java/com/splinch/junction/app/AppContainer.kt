package com.splinch.junction.app

import android.content.Context
import com.splinch.junction.assistant.conversation.RoomConversationStore
import com.splinch.junction.assistant.conversation.SyncingConversationStore
import com.splinch.junction.assistant.provider.ProviderRegistry
import com.splinch.junction.assistant.runtime.ChatManager
import com.splinch.junction.data.database.JunctionDatabase
import com.splinch.junction.data.preference.UserPrefsRepository
import com.splinch.junction.data.sync.firebase.AuditSyncManager
import com.splinch.junction.data.sync.firebase.AuthManager
import com.splinch.junction.data.sync.firebase.ChatSyncManager
import com.splinch.junction.data.sync.firebase.FeedSyncManager
import com.splinch.junction.data.sync.firebase.PrefsSyncManager
import com.splinch.junction.data.sync.firebase.RemoteCommandSyncManager
import com.splinch.junction.feature.feed.FeedRepository
import com.splinch.junction.feature.update.UpdateInfo
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * The app's dependency graph, built once at Application scope.
 *
 * This used to be assembled with `remember { }` inside MainActivity's Composable, which
 * meant every one of these objects -- [ChatManager] included -- lived and died with the
 * Activity's Composition. That is fine for UI state, but [RemoteCommandSyncManager] has to
 * keep listening for commands from the PC companion after the owner backgrounds Junction,
 * locks the phone, or swipes it out of recents -- none of which necessarily destroy the
 * Activity, but none of which should be required to keep it alive either. Building the
 * graph here instead means the same [ChatManager]/[RemoteCommandSyncManager] instances are
 * reachable from both MainActivity and [com.splinch.junction.data.sync.firebase.RemoteCommandForegroundService],
 * so starting the service is enough to keep the listener alive independent of any Activity.
 */
class AppContainer(context: Context) {
    private val appContext = context.applicationContext

    val database: JunctionDatabase = JunctionDatabase.getInstance(appContext)
    val prefs = UserPrefsRepository(appContext)
    val authManager = AuthManager(appContext)
    val chatSyncManager = ChatSyncManager(database.chatDao(), authManager)
    val feedSyncManager = FeedSyncManager(database.feedDao(), authManager)
    val prefsSyncManager = PrefsSyncManager(prefs, authManager)
    val auditSyncManager = AuditSyncManager(database.actionLogDao(), authManager)
    private val roomStore = RoomConversationStore(database.chatDao())
    private val conversationStore = SyncingConversationStore(roomStore, chatSyncManager)
    val feedRepository = FeedRepository(database.feedDao(), feedSyncManager)
    val updateState = MutableStateFlow<UpdateInfo?>(null)
    val providerRegistry = ProviderRegistry(appContext, prefs)

    val chatManager: ChatManager = ChatManager(
        context = appContext,
        store = conversationStore,
        feedRepository = feedRepository,
        prefs = prefs,
        authManager = authManager,
        updateState = updateState,
        providerRegistry = providerRegistry,
        actionLogDao = database.actionLogDao(),
        modelUsageDao = database.modelUsageDao(),
        planDao = database.planDao(),
        memoryFactDao = database.memoryFactDao()
    )

    val remoteCommandSyncManager = RemoteCommandSyncManager(chatManager, authManager)
}
