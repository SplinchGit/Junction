package com.splinch.junction.feed.model

import androidx.room.TypeConverter

class FeedConverters {
    @TypeConverter
    fun toCategory(value: String?): FeedCategory? {
        return value?.let { FeedCategory.valueOf(it) }
    }

    @TypeConverter
    fun fromCategory(category: FeedCategory?): String? {
        return category?.name
    }

    @TypeConverter
    fun toStatus(value: String?): FeedStatus? {
        return value?.let { FeedStatus.valueOf(it) }
    }

    @TypeConverter
    fun fromStatus(status: FeedStatus?): String? {
        return status?.name
    }
}
