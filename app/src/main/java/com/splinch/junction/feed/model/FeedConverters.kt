package com.splinch.junction.feed.model

import androidx.room.TypeConverter

class FeedConverters {
    @TypeConverter
    fun toCategory(value: String?): FeedCategory {
        return try {
            FeedCategory.valueOf(value?.trim().orEmpty())
        } catch (_: Exception) {
            FeedCategory.OTHER
        }
    }

    @TypeConverter
    fun fromCategory(category: FeedCategory?): String? {
        return category?.name
    }

    @TypeConverter
    fun toStatus(value: String?): FeedStatus {
        return try {
            FeedStatus.valueOf(value?.trim().orEmpty())
        } catch (_: Exception) {
            FeedStatus.NEW
        }
    }

    @TypeConverter
    fun fromStatus(status: FeedStatus?): String? {
        return status?.name
    }
}
