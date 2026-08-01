package com.splinch.junction.data.database.usage

import androidx.room.Entity
import androidx.room.PrimaryKey

/** Provider-reported usage for one model response; never duplicated per tool action. */
@Entity(tableName = "model_usage")
data class ModelUsageEntity(
    @PrimaryKey val id: String,
    val timestamp: Long,
    val sessionId: String,
    val lane: String,
    val provider: String,
    val model: String,
    val tokensIn: Int?,
    val tokensOut: Int?,
    val latencyMs: Long
)