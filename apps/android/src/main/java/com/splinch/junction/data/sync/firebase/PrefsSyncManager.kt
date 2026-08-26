package com.splinch.junction.data.sync.firebase

import com.google.firebase.firestore.ListenerRegistration
import com.splinch.junction.data.preference.UserPrefsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Job
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
    private var authJob: Job? = null
    private var uploadJob: Job? = null

    fun start() {
        if (authJob != null) return
        authJob = scope.launch {
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
        authJob?.cancel()
        authJob = null
        uploadJob?.cancel()
        uploadJob = null
        currentUserId = null
        lastSnapshotHash = null
        stopListening()
    }

    private fun startUploadLoop() {
        uploadJob?.cancel()
        uploadJob = scope.launch {
            prefsRepository.chatModelFlow.collectLatest { chatModel ->
                val uid = currentUserId ?: return@collectLatest
                val hash = chatModel.hashCode()
                if (hash == lastSnapshotHash) return@collectLatest
                lastSnapshotHash = hash
                val firestore = FirebaseProvider.firestoreOrNull() ?: return@collectLatest
                val docRef = firestore
                    .collection("users")
                    .document(uid)
                    .collection("preferences")
                    .document("main")
                docRef.set(mapOf("chatModel" to chatModel))
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
                val remoteModel = (data["chatModel"] as? String)
                    ?.trim()
                    ?.takeIf { it.isNotEmpty() && it.length <= 120 }
                    ?: return@addSnapshotListener
                scope.launch {
                    prefsRepository.setChatModel(remoteModel)
                }
            }
    }

    private fun stopListening() {
        prefsListener?.remove()
        prefsListener = null
    }
}
