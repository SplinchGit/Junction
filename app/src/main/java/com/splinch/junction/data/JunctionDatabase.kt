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
    entities = [
        ChatSessionEntity::class,
        ChatMessageEntity::class,
        FeedItemEntity::class
    ],
    version = 8,
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
                ).addMigrations(MIGRATION_7_8)
                    .fallbackToDestructiveMigration(true)
                    .build()
                    .also { INSTANCE = it }
            }
        }

        private val MIGRATION_7_8 = object : Migration(7, 8) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("DROP TABLE IF EXISTS `employment_status`")
                db.execSQL("DROP TABLE IF EXISTS `roles`")
                db.execSQL("DROP TABLE IF EXISTS `follow_targets`")
                db.execSQL("DROP TABLE IF EXISTS `interest_rules`")
                db.execSQL("DROP TABLE IF EXISTS `suggestions`")
                db.execSQL("DROP TABLE IF EXISTS `rejected_suggestions`")
            }
        }
    }
}
