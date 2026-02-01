package com.splinch.junction.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface FeedDao {
    @Query("SELECT * FROM feed_events ORDER BY timestamp DESC")
    fun observeEvents(): Flow<List<FeedEventEntity>>

    @Query("SELECT * FROM feed_events ORDER BY timestamp DESC")
    suspend fun getEvents(): List<FeedEventEntity>

    @Query("SELECT COUNT(*) FROM feed_events")
    suspend fun countEvents(): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertEvents(events: List<FeedEventEntity>)

    @Query("DELETE FROM feed_events")
    suspend fun clearEvents()
}
