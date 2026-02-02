package com.splinch.junction.employment.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.splinch.junction.employment.EmploymentStatusEntity
import com.splinch.junction.employment.RoleEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface EmploymentDao {
    @Query("SELECT * FROM employment_status WHERE id = :id LIMIT 1")
    suspend fun getStatus(id: String = EmploymentStatusEntity.CURRENT_ID): EmploymentStatusEntity?

    @Query("SELECT * FROM employment_status WHERE id = :id LIMIT 1")
    fun statusFlow(id: String = EmploymentStatusEntity.CURRENT_ID): Flow<EmploymentStatusEntity?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertStatus(status: EmploymentStatusEntity)

    @Query("SELECT * FROM roles WHERE id = :id LIMIT 1")
    suspend fun getRoleById(id: String): RoleEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertRole(role: RoleEntity)

    @Query("UPDATE roles SET endDate = :endDate, updatedAt = :updatedAt WHERE id = :id")
    suspend fun endRole(id: String, endDate: Long, updatedAt: Long)
}
