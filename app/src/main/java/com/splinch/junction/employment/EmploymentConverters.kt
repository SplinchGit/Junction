package com.splinch.junction.employment

import androidx.room.TypeConverter

class EmploymentConverters {
    @TypeConverter
    fun toEmploymentState(value: String?): EmploymentState {
        return try {
            EmploymentState.valueOf(value?.trim().orEmpty())
        } catch (_: Exception) {
            EmploymentState.UNEMPLOYED
        }
    }

    @TypeConverter
    fun fromEmploymentState(state: EmploymentState?): String? = state?.name

    @TypeConverter
    fun toEmploymentType(value: String?): EmploymentType {
        return try {
            EmploymentType.valueOf(value?.trim().orEmpty())
        } catch (_: Exception) {
            EmploymentType.FULL_TIME
        }
    }

    @TypeConverter
    fun fromEmploymentType(type: EmploymentType?): String? = type?.name
}
