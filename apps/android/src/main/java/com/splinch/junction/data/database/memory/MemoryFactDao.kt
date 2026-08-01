package com.splinch.junction.data.database.memory

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface MemoryFactDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(fact: MemoryFactEntity)

    @Query("DELETE FROM memory_facts WHERE id = :id")
    suspend fun delete(id: String)

    @Query("SELECT * FROM memory_facts ORDER BY createdAt ASC")
    fun allFlow(): Flow<List<MemoryFactEntity>>

    @Query("SELECT * FROM memory_facts WHERE content LIKE '%' || :query || '%' ORDER BY createdAt DESC")
    suspend fun search(query: String): List<MemoryFactEntity>

    @Query("SELECT COUNT(*) FROM memory_facts")
    suspend fun count(): Int

    @Query("SELECT * FROM memory_facts ORDER BY createdAt ASC")
    suspend fun allOnce(): List<MemoryFactEntity>
}
