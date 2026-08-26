package com.splinch.junction.data.sync.firebase

import android.content.Context
import android.provider.Settings
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.SetOptions
import com.google.firebase.Timestamp
import com.splinch.junction.BuildConfig
import com.splinch.junction.data.database.memory.MemoryFactDao
import com.splinch.junction.data.database.memory.MemoryFactEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import java.util.concurrent.ConcurrentHashMap

/** v1 account/device registration and owner-confirmed memory additions. Synced data is context, never a trigger. */
class SharedStateSyncManager(
    context: Context,
    private val memoryDao: MemoryFactDao,
    private val authManager: AuthManager
) {
    private val appContext = context.applicationContext
    private val syncState = appContext.getSharedPreferences("junction_shared_state_v1", Context.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val deviceId = "android-" + Settings.Secure.getString(appContext.contentResolver, Settings.Secure.ANDROID_ID)
    private var authJob: Job? = null
    private var uploadJob: Job? = null
    private var memoryListener: ListenerRegistration? = null
    private var currentUserId: String? = null
    private val publishedMemoryIds = ConcurrentHashMap.newKeySet<String>()

    fun start() {
        if (authJob != null) return
        authJob = scope.launch {
            authManager.userFlow.collectLatest { user ->
                stopUserWork()
                currentUserId = user?.uid
                if (user == null) return@collectLatest
                val firestore = FirebaseProvider.firestoreOrNull() ?: return@collectLatest
                firestore.collection("users").document(user.uid).collection("devices").document(deviceId).set(
                    mapOf("deviceId" to deviceId, "name" to "Junction Android", "platform" to "android", "appVersion" to BuildConfig.VERSION_NAME, "syncEnabled" to true, "createdAt" to Timestamp.now(), "lastSeenAt" to Timestamp.now()),
                    SetOptions.merge()
                ).await()
                val memories = firestore.collection("users").document(user.uid).collection("shared_memory")
                // Reconcile the durable local publication index before attaching
                // the remote listener. A deletion made before process death must
                // become a tombstone, not be re-imported from Firestore.
                val publishedKey = "published_memory_${user.uid}"
                publishedMemoryIds.clear()
                publishedMemoryIds.addAll(syncState.getStringSet(publishedKey, emptySet()).orEmpty())
                val startupFacts = memoryDao.allFlow().first()
                val startupIds = startupFacts.map { it.id }.toSet()
                for (removedId in publishedMemoryIds - startupIds) {
                    memories.document(removedId).update("deletedAt", System.currentTimeMillis()).await()
                }
                publishedMemoryIds.retainAll(startupIds)
                syncState.edit().putStringSet(publishedKey, publishedMemoryIds.toSet()).apply()
                memoryListener = memories.addSnapshotListener { snapshot, _ ->
                    snapshot?.documents?.forEach { doc ->
                        val data = doc.data ?: return@forEach
                        scope.launch {
                            if (data["deletedAt"] != null) { memoryDao.delete(doc.id); publishedMemoryIds.remove(doc.id);syncState.edit().putStringSet(publishedKey,publishedMemoryIds.toSet()).apply();return@launch }
                            if (data["provenance"] != "OWNER") return@launch
                            memoryDao.insert(MemoryFactEntity(doc.id, data["content"] as? String ?: return@launch, data["category"] as? String ?: "other", (data["createdAt"] as? Number)?.toLong() ?: System.currentTimeMillis(), "shared:firestore:${doc.id}"))
                            publishedMemoryIds.add(doc.id)
                            syncState.edit().putStringSet(publishedKey,publishedMemoryIds.toSet()).apply()
                        }
                    }
                }
                uploadJob = scope.launch {
                    memoryDao.allFlow().collectLatest { facts ->
                        val localFacts = facts.filterNot { it.sourceRef?.startsWith("shared:") == true }
                        val currentIds = facts.map { it.id }.toSet()
                        (publishedMemoryIds - currentIds).forEach { removedId ->
                            memories.document(removedId).update("deletedAt", System.currentTimeMillis()).await()
                        }
                        localFacts.forEach { fact ->
                            memories.document(fact.id).set(
                                mapOf("id" to fact.id, "content" to fact.content, "category" to fact.category, "createdAt" to fact.createdAt, "provenance" to "OWNER", "sourceRef" to (fact.sourceRef ?: "shared:android:${fact.id}"), "deviceId" to deviceId, "schemaVersion" to 1),
                                SetOptions.merge()
                            ).await()
                        }
                        publishedMemoryIds.clear()
                        publishedMemoryIds.addAll(currentIds)
                        syncState.edit().putStringSet(publishedKey, publishedMemoryIds.toSet()).apply()
                    }
                }
            }
        }
    }

    fun stop() {
        val uid = currentUserId
        if (uid != null) scope.launch {
            FirebaseProvider.firestoreOrNull()?.collection("users")?.document(uid)
                ?.collection("devices")?.document(deviceId)?.set(
                    mapOf("syncEnabled" to false, "lastSeenAt" to Timestamp.now(), "disabledAt" to Timestamp.now()),
                    SetOptions.merge()
                )?.await()
        }
        currentUserId = null
        authJob?.cancel()
        authJob = null
        stopUserWork()
    }
    private fun stopUserWork() { uploadJob?.cancel(); uploadJob = null; memoryListener?.remove(); memoryListener = null; publishedMemoryIds.clear() }
}
