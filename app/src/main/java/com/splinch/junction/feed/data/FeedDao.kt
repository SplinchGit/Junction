package com.splinch.junction.feed.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.splinch.junction.feed.model.FeedItemEntity
import com.splinch.junction.feed.model.FeedStatus
import kotlinx.coroutines.flow.Flow

@Dao
interface FeedDao {
    @Query("SELECT * FROM feed_items ORDER BY timestamp DESC")
    fun feedStream(): Flow<List<FeedItemEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(item: FeedItemEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(items: List<FeedItemEntity>)

    @Query("UPDATE feed_items SET status = :status WHERE id = :id")
    suspend fun updateStatus(id: String, status: FeedStatus)

    @Query("UPDATE feed_items SET status = 'ARCHIVED' WHERE id = :id")
    suspend fun archive(id: String)

    @Query("UPDATE feed_items SET status = 'SEEN' WHERE id = :id")
    suspend fun markSeen(id: String)

    @Query("SELECT COUNT(*) FROM feed_items")
    suspend fun countAll(): Int

    @Query("DELETE FROM feed_items")
    suspend fun clearAll()

    @Query("SELECT DISTINCT packageName FROM feed_items WHERE packageName IS NOT NULL")
    suspend fun distinctPackages(): List<String>

    @Query("SELECT * FROM feed_items ORDER BY timestamp DESC")
    suspend fun getAll(): List<FeedItemEntity>
}
