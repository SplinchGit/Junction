package com.splinch.junction.data.sync.firebase

import com.google.firebase.firestore.SetOptions
import com.splinch.junction.data.database.audit.ActionLogDao
import com.splinch.junction.data.database.audit.ActionLogEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

/**
 * §4.3 PC companion audit mirror. Read-only from the web client's
 * perspective (enforced in firestore.rules) — only the phone pushes rows
 * here, and only a fixed, non-sensitive field subset (never argumentsJson or
 * planText). This is a one-way mirror of outcomes, not a sync channel the
 * companion can act through.
 */
class AuditSyncManager(
    private val actionLogDao: ActionLogDao,
    private val authManager: AuthManager
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var currentUserId: String? = null
    private var job: kotlinx.coroutines.Job? = null

    fun start() {
        scope.launch {
            authManager.userFlow.collectLatest { user ->
                currentUserId = user?.uid
                job?.cancel()
                if (user != null) attachMirror(user.uid)
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
    }

    private fun attachMirror(uid: String) {
        job = scope.launch {
            actionLogDao.recentFlow(100)
                .distinctUntilChanged()
                .collectLatest { entries -> mirror(uid, entries) }
        }
    }

    private suspend fun mirror(uid: String, entries: List<ActionLogEntity>) {
        val firestore = FirebaseProvider.firestoreOrNull() ?: return
        val collection = firestore.collection("users").document(uid).collection("audit_log")
        for (entry in entries) {
            collection.document(entry.id).set(
                mapOf(
                    "id" to entry.id,
                    "timestamp" to entry.timestamp,
                    "toolName" to entry.toolName,
                    "decision" to entry.decision,
                    "outcome" to entry.outcome,
                    "riskTier" to entry.effectiveTier,
                    "blockReason" to entry.blockReason
                ),
                SetOptions.merge()
            )
        }
    }
}
