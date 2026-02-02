package com.splinch.junction.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.splinch.junction.feed.data.FeedDao
import com.splinch.junction.feed.model.FeedConverters
import com.splinch.junction.feed.model.FeedItemEntity

@Database(
    entities = [ChatSessionEntity::class, ChatMessageEntity::class, FeedItemEntity::class],
    version = 2,
    exportSchema = false
)
@TypeConverters(FeedConverters::class)
abstract class JunctionDatabase : RoomDatabase() {
    abstract fun chatDao(): ChatDao
    abstract fun feedDao(): FeedDao

    companion object {
        @Volatile
        private var INSTANCE: JunctionDatabase? = null

        fun getInstance(context: Context): JunctionDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    JunctionDatabase::class.java,
                    "junction.db"
                ).addMigrations(MIGRATION_1_2)
                    .fallbackToDestructiveMigration()
                    .build()
                    .also { INSTANCE = it }
            }
        }

        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "ALTER TABLE chat_sessions ADD COLUMN speechModeEnabled INTEGER NOT NULL DEFAULT 0"
                )
                db.execSQL(
                    "ALTER TABLE chat_sessions ADD COLUMN agentToolsEnabled INTEGER NOT NULL DEFAULT 1"
                )
            }
        }
    }
}
