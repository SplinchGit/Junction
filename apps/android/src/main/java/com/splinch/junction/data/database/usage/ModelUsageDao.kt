package com.splinch.junction.data.database.usage

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface ModelUsageDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entry: ModelUsageEntity)

    @Query("SELECT * FROM model_usage ORDER BY timestamp DESC LIMIT :limit")
    fun recentFlow(limit: Int = 100): Flow<List<ModelUsageEntity>>
}