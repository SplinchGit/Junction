package com.splinch.junction.employment

import com.splinch.junction.employment.data.EmploymentDao
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

data class EmploymentStatusSnapshot(
    val status: EmploymentStatusEntity?,
    val role: RoleEntity?
)

class EmploymentRepository(private val dao: EmploymentDao) {
    fun statusFlow(): Flow<EmploymentStatusEntity?> = dao.statusFlow()

    fun statusSnapshotFlow(): Flow<EmploymentStatusSnapshot> {
        return dao.statusFlow().map { status ->
            val role = status?.currentRoleId?.let { dao.getRoleById(it) }
            EmploymentStatusSnapshot(status, role)
        }
    }

    suspend fun setStatus(
        state: EmploymentState,
        since: Long = System.currentTimeMillis(),
        currentRoleId: String? = null,
        notes: String? = null
    ) {
        val updatedAt = System.currentTimeMillis()
        val status = EmploymentStatusEntity(
            id = EmploymentStatusEntity.CURRENT_ID,
            state = state,
            currentRoleId = currentRoleId,
            since = since,
            notes = notes,
            updatedAt = updatedAt
        )
        dao.upsertStatus(status)
    }

    suspend fun upsertRole(role: RoleEntity) {
        dao.upsertRole(role)
    }

    suspend fun createRole(
        title: String,
        employerName: String,
        employmentType: EmploymentType,
        startDate: Long,
        source: String? = null,
        payText: String? = null
    ): RoleEntity {
        val role = RoleEntity(
            title = title,
            employerName = employerName,
            employmentType = employmentType,
            startDate = startDate,
            source = source,
            payText = payText
        )
        dao.upsertRole(role)
        return role
    }

    suspend fun endRole(roleId: String, endDate: Long = System.currentTimeMillis()) {
        dao.endRole(roleId, endDate, System.currentTimeMillis())
    }

    suspend fun clearCurrentRole() {
        val status = dao.getStatus() ?: return
        dao.upsertStatus(status.copy(currentRoleId = null, updatedAt = System.currentTimeMillis()))
    }
}
