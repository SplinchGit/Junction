package com.splinch.junction.sync.firebase

import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.SetOptions
import com.splinch.junction.settings.PrefsSnapshot
import com.splinch.junction.settings.UserPrefsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

class PrefsSyncManager(
    private val prefsRepository: UserPrefsRepository,
    private val authManager: AuthManager
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var currentUserId: String? = null
    private var prefsListener: ListenerRegistration? = null
    private var lastSnapshotHash: Int? = null

    fun start() {
        scope.launch {
            authManager.userFlow.collectLatest { user ->
                currentUserId = user?.uid
                if (user == null) {
                    stopListening()
                } else {
                    attachListener()
                    startUploadLoop()
                }
            }
        }
    }

    fun stop() {
        stopListening()
    }

    private fun startUploadLoop() {
        scope.launch {
            prefsRepository.snapshotFlow.collectLatest { snapshot ->
                val uid = currentUserId ?: return@collectLatest
                val hash = snapshot.hashCode()
                if (hash == lastSnapshotHash) return@collectLatest
                lastSnapshotHash = hash
                val firestore = FirebaseProvider.firestoreOrNull() ?: return@collectLatest
                val docRef = firestore
                    .collection("users")
                    .document(uid)
                    .collection("preferences")
                    .document("main")
                docRef.set(snapshot.toFirestoreMap(), SetOptions.merge())
            }
        }
    }

    private fun attachListener() {
        val uid = currentUserId ?: return
        val firestore = FirebaseProvider.firestoreOrNull() ?: return
        stopListening()
        prefsListener = firestore
            .collection("users")
            .document(uid)
            .collection("preferences")
            .document("main")
            .addSnapshotListener { snapshot, _ ->
                val data = snapshot?.data ?: return@addSnapshotListener
                val remote = prefsSnapshotFromFirestore(data) ?: return@addSnapshotListener
                scope.launch {
                    prefsRepository.applySnapshot(remote)
                }
            }
    }

    private fun stopListening() {
        prefsListener?.remove()
        prefsListener = null
    }
}

private fun PrefsSnapshot.toFirestoreMap(): Map<String, Any?> {
    return mapOf(
        "lastOpenedAt" to lastOpenedAt,
        "digestIntervalMinutes" to digestIntervalMinutes,
        "notificationAccessAcknowledged" to notificationAccessAcknowledged,
        "notificationListenerEnabled" to notificationListenerEnabled,
        "appWeights" to appWeights,
        "disabledPackages" to disabledPackages.toList(),
        "lastUpdateCheckAt" to lastUpdateCheckAt,
        "realtimeClientSecretEndpoint" to realtimeClientSecretEndpoint,
        "connectedIntegrations" to connectedIntegrations.toList(),
        "mafiosoGameEnabled" to mafiosoGameEnabled
    )
}

private fun prefsSnapshotFromFirestore(data: Map<String, Any?>): PrefsSnapshot? {
    val lastOpenedAt = (data["lastOpenedAt"] as? Number)?.toLong() ?: return null
    val digestInterval = (data["digestIntervalMinutes"] as? Number)?.toInt() ?: 30
    val notificationAck = data["notificationAccessAcknowledged"] as? Boolean ?: false
    val listenerEnabled = data["notificationListenerEnabled"] as? Boolean ?: false
    val appWeights = (data["appWeights"] as? Map<*, *>)?.mapNotNull { (k, v) ->
        val key = k as? String ?: return@mapNotNull null
        val value = (v as? Number)?.toInt() ?: return@mapNotNull null
        key to value
    }?.toMap() ?: emptyMap()
    val disabledPackages = (data["disabledPackages"] as? List<*>)?.mapNotNull { it as? String }?.toSet()
        ?: emptySet()
    val lastUpdateCheckAt = (data["lastUpdateCheckAt"] as? Number)?.toLong() ?: 0L
    val realtimeClientSecretEndpoint = data["realtimeClientSecretEndpoint"] as? String ?: ""
    val connectedIntegrations = (data["connectedIntegrations"] as? List<*>)?.mapNotNull { it as? String }?.toSet()
        ?: emptySet()
    val mafiosoGameEnabled = data["mafiosoGameEnabled"] as? Boolean ?: false
    return PrefsSnapshot(
        lastOpenedAt = lastOpenedAt,
        digestIntervalMinutes = digestInterval,
        notificationAccessAcknowledged = notificationAck,
        notificationListenerEnabled = listenerEnabled,
        appWeights = appWeights,
        disabledPackages = disabledPackages,
        lastUpdateCheckAt = lastUpdateCheckAt,
        realtimeClientSecretEndpoint = realtimeClientSecretEndpoint,
        connectedIntegrations = connectedIntegrations,
        mafiosoGameEnabled = mafiosoGameEnabled
    )
}
