package com.splinch.junction.data.database.audit

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface WorldAuditDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAll(events: List<WorldAuditEntity>)

    @Query("SELECT * FROM junction_world_audit ORDER BY sequence DESC LIMIT :limit")
    fun recentFlow(limit: Int = 1000): Flow<List<WorldAuditEntity>>

    @Query("SELECT MAX(sequence) FROM junction_world_audit")
    suspend fun latestSequence(): Long?
}
