package com.splinch.junction.follow

import androidx.room.TypeConverter

class FollowConverters {
    @TypeConverter
    fun fromSourceApp(value: SourceApp?): String? = value?.name

    @TypeConverter
    fun toSourceApp(value: String?): SourceApp? = value?.let { runCatching { SourceApp.valueOf(it) }.getOrNull() }

    @TypeConverter
    fun fromFollowTargetType(value: FollowTargetType?): String? = value?.name

    @TypeConverter
    fun toFollowTargetType(value: String?): FollowTargetType? =
        value?.let { runCatching { FollowTargetType.valueOf(it) }.getOrNull() }

    @TypeConverter
    fun fromMatchType(value: MatchType?): String? = value?.name

    @TypeConverter
    fun toMatchType(value: String?): MatchType? = value?.let { runCatching { MatchType.valueOf(it) }.getOrNull() }

    @TypeConverter
    fun fromSuggestionType(value: SuggestionType?): String? = value?.name

    @TypeConverter
    fun toSuggestionType(value: String?): SuggestionType? =
        value?.let { runCatching { SuggestionType.valueOf(it) }.getOrNull() }

    @TypeConverter
    fun fromSuggestionStatus(value: SuggestionStatus?): String? = value?.name

    @TypeConverter
    fun toSuggestionStatus(value: String?): SuggestionStatus? =
        value?.let { runCatching { SuggestionStatus.valueOf(it) }.getOrNull() }
}

