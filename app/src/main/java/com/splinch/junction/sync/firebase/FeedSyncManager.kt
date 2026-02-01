package com.splinch.junction.sync.firebase

import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.SetOptions
import com.splinch.junction.feed.FeedRemoteSync
import com.splinch.junction.feed.data.FeedDao
import com.splinch.junction.feed.model.FeedItemEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

class FeedSyncManager(
    private val feedDao: FeedDao,
    private val authManager: AuthManager
) : FeedRemoteSync {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var currentUserId: String? = null
    private var feedListener: ListenerRegistration? = null

    fun start() {
        scope.launch {
            authManager.userFlow.collectLatest { user ->
                currentUserId = user?.uid
                if (user == null) {
                    stopListening()
                } else {
                    attachListener()
                }
            }
        }
    }

    fun stop() {
        stopListening()
    }

    override suspend fun onLocalUpsert(item: FeedItemEntity) {
        val uid = currentUserId ?: return
        val firestore = FirebaseProvider.firestoreOrNull() ?: return
        val docRef = firestore
            .collection("users")
            .document(uid)
            .collection("feed_items")
            .document(item.id)
        docRef.set(item.toFirestoreMap(uid), SetOptions.merge())
    }

    private fun attachListener() {
        val uid = currentUserId ?: return
        val firestore = FirebaseProvider.firestoreOrNull() ?: return
        stopListening()
        feedListener = firestore
            .collection("users")
            .document(uid)
            .collection("feed_items")
            .addSnapshotListener { snapshot, _ ->
                if (snapshot == null) return@addSnapshotListener
                scope.launch {
                    for (doc in snapshot.documents) {
                        val data = doc.data ?: continue
                        val remote = feedItemFromFirestore(doc.id, data) ?: continue
                        val local = feedDao.getById(remote.id)
                        if (local == null || remote.updatedAt > local.updatedAt) {
                            feedDao.insert(remote)
                        }
                    }
                }
            }
    }

    private fun stopListening() {
        feedListener?.remove()
        feedListener = null
    }
}
