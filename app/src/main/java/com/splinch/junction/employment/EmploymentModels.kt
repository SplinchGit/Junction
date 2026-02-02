package com.splinch.junction.employment

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.util.UUID

enum class EmploymentState {
    UNEMPLOYED,
    SEEKING,
    EMPLOYED,
    SELF_EMPLOYED,
    STUDENT,
    UNABLE_TO_WORK
}

enum class EmploymentType {
    FULL_TIME,
    PART_TIME,
    CONTRACT,
    TEMP,
    ZERO_HOURS,
    GIG
}

@Entity(tableName = "employment_status")
data class EmploymentStatusEntity(
    @PrimaryKey val id: String = CURRENT_ID,
    val state: EmploymentState,
    val currentRoleId: String?,
    val since: Long,
    val notes: String? = null,
    val updatedAt: Long = since
) {
    companion object {
        const val CURRENT_ID = "current"
    }
}

@Entity(tableName = "roles")
data class RoleEntity(
    @PrimaryKey val id: String = UUID.randomUUID().toString(),
    val title: String,
    val employerName: String,
    val employmentType: EmploymentType,
    val startDate: Long,
    val endDate: Long? = null,
    val payText: String? = null,
    val source: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = createdAt
)
