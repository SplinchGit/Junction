package com.splinch.junction.feed.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.splinch.junction.feed.model.FeedCategory
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

    @Query("UPDATE feed_items SET status = :status, updatedAt = :updatedAt WHERE id = :id")
    suspend fun updateStatus(id: String, status: FeedStatus, updatedAt: Long)

    @Query("UPDATE feed_items SET status = 'ARCHIVED', aggregateCount = 0, updatedAt = :updatedAt WHERE id = :id")
    suspend fun archive(id: String, updatedAt: Long)

    @Query("UPDATE feed_items SET status = 'SEEN', aggregateCount = 0, updatedAt = :updatedAt WHERE id = :id")
    suspend fun markSeen(id: String, updatedAt: Long)

    @Query("SELECT * FROM feed_items WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): FeedItemEntity?

    @Query("SELECT * FROM feed_items WHERE threadKey = :threadKey LIMIT 1")
    suspend fun getByThreadKey(threadKey: String): FeedItemEntity?

    @Query(
        "SELECT * FROM feed_items WHERE packageName = :packageName AND category = :category " +
            "ORDER BY updatedAt DESC LIMIT 1"
    )
    suspend fun getLatestByPackageAndCategory(
        packageName: String,
        category: FeedCategory
    ): FeedItemEntity?

    @Query(
        "SELECT * FROM feed_items WHERE packageName = :packageName AND category = :category AND id != :keepId"
    )
    suspend fun getByPackageAndCategoryExcept(
        packageName: String,
        category: FeedCategory,
        keepId: String
    ): List<FeedItemEntity>

    @Query(
        "UPDATE feed_items SET status = 'ARCHIVED', aggregateCount = 0, updatedAt = :updatedAt " +
            "WHERE packageName = :packageName AND category = :category AND id != :keepId"
    )
    suspend fun archiveByPackageAndCategoryExcept(
        packageName: String,
        category: FeedCategory,
        keepId: String,
        updatedAt: Long
    )

    @Query("SELECT COUNT(*) FROM feed_items")
    suspend fun countAll(): Int

    @Query("DELETE FROM feed_items")
    suspend fun clearAll()

    @Query("SELECT DISTINCT packageName FROM feed_items WHERE packageName IS NOT NULL")
    suspend fun distinctPackages(): List<String>

    @Query("SELECT * FROM feed_items ORDER BY timestamp DESC")
    suspend fun getAll(): List<FeedItemEntity>
}
