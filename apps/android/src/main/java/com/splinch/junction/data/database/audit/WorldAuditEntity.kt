package com.splinch.junction.data.database.audit

import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.Index

/** Immutable copy of a host-validated Junction World event. There is no update/delete DAO. */
@Entity(tableName = "junction_world_audit", indices = [Index(value = ["sequence"], unique = true)])
data class WorldAuditEntity(
    @PrimaryKey val id: String,
    val sequence: Long,
    val timestamp: Long,
    val category: String,
    val summary: String,
    val details: String?,
    val goalId: String?,
    val actionId: String?,
    val actionStatus: String?,
    val communicationId: String?,
    val conversationId: String?,
    val communicationDirection: String?,
    val durationMs: Long?,
    val workspaceFreeBytes: Long?,
    val memoryUsedBytes: Long?,
    val cpuPercent: Double?
)
