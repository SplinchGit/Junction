package com.splinch.junction.data.database

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.splinch.junction.data.database.audit.ActionLogDao
import com.splinch.junction.data.database.audit.ActionLogEntity
import com.splinch.junction.data.database.chat.ChatDao
import com.splinch.junction.data.database.chat.ChatMessageEntity
import com.splinch.junction.data.database.chat.ChatSessionEntity
import com.splinch.junction.data.database.feed.FeedDao
import com.splinch.junction.data.database.memory.MemoryFactDao
import com.splinch.junction.data.database.memory.MemoryFactEntity
import com.splinch.junction.data.database.planning.PlanDao
import com.splinch.junction.data.database.planning.PlanEntity
import com.splinch.junction.data.database.planning.StepEntity
import com.splinch.junction.data.database.usage.ModelUsageDao
import com.splinch.junction.data.database.usage.ModelUsageEntity
import com.splinch.junction.feature.feed.model.FeedConverters
import com.splinch.junction.feature.feed.model.FeedItemEntity

@Database(
    entities = [
        ChatSessionEntity::class,
        ChatMessageEntity::class,
        FeedItemEntity::class,
        ActionLogEntity::class,
        ModelUsageEntity::class,
        PlanEntity::class,
        StepEntity::class,
        MemoryFactEntity::class
    ],
    version = 16,
    exportSchema = false
)
@TypeConverters(FeedConverters::class)
abstract class JunctionDatabase : RoomDatabase() {
    abstract fun chatDao(): ChatDao
    abstract fun feedDao(): FeedDao
    abstract fun actionLogDao(): ActionLogDao
    abstract fun modelUsageDao(): ModelUsageDao
    abstract fun planDao(): PlanDao
    abstract fun memoryFactDao(): MemoryFactDao

    companion object {
        @Volatile
        private var INSTANCE: JunctionDatabase? = null

        fun getInstance(context: Context): JunctionDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    JunctionDatabase::class.java,
                    "junction.db"
                ).addMigrations(MIGRATION_7_8, MIGRATION_8_9, MIGRATION_9_10, MIGRATION_10_11, MIGRATION_11_12, MIGRATION_12_13, MIGRATION_13_14, MIGRATION_14_15, MIGRATION_15_16)
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

        private val MIGRATION_8_9 = object : Migration(8, 9) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // Add provenance to chat_messages
                db.execSQL("ALTER TABLE `chat_messages` ADD COLUMN `provenance` TEXT NOT NULL DEFAULT 'OWNER'")
                // Add provenance to feed_items
                db.execSQL("ALTER TABLE `feed_items` ADD COLUMN `provenance` TEXT NOT NULL DEFAULT 'UNTRUSTED'")
                // Create action_log table
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS `action_log` (
                        `id` TEXT NOT NULL PRIMARY KEY,
                        `timestamp` INTEGER NOT NULL,
                        `sessionId` TEXT NOT NULL,
                        `planId` TEXT,
                        `stepId` TEXT,
                        `toolName` TEXT NOT NULL,
                        `argumentsJson` TEXT NOT NULL,
                        `planText` TEXT,
                        `planHash` TEXT,
                        `riskTier` TEXT NOT NULL,
                        `effectiveTier` TEXT NOT NULL,
                        `triggerProvenance` TEXT NOT NULL,
                        `tainted` INTEGER NOT NULL DEFAULT 0,
                        `taintSource` TEXT,
                        `decision` TEXT NOT NULL,
                        `blockReason` TEXT,
                        `outcome` TEXT,
                        `postConditionPassed` INTEGER,
                        `outcomeDetail` TEXT,
                        `undoAvailable` INTEGER NOT NULL DEFAULT 0,
                        `latencyMs` INTEGER,
                        `provider` TEXT,
                        `model` TEXT,
                        `tokensIn` INTEGER,
                        `tokensOut` INTEGER,
                        `costEstimate` REAL
                    )
                """.trimIndent())
            }
        }

        private val MIGRATION_9_10 = object : Migration(9, 10) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS `plans` (
                        `id` TEXT NOT NULL PRIMARY KEY,
                        `goal` TEXT NOT NULL,
                        `sessionId` TEXT NOT NULL,
                        `trigger` TEXT NOT NULL,
                        `status` TEXT NOT NULL,
                        `tainted` INTEGER NOT NULL,
                        `taintSource` TEXT,
                        `createdAt` INTEGER NOT NULL
                    )
                """.trimIndent())
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS `plan_steps` (
                        `id` TEXT NOT NULL PRIMARY KEY,
                        `planId` TEXT NOT NULL,
                        `callId` TEXT NOT NULL,
                        `orderIndex` INTEGER NOT NULL,
                        `tool` TEXT NOT NULL,
                        `argumentsJson` TEXT NOT NULL,
                        `summary` TEXT NOT NULL,
                        `riskTier` TEXT NOT NULL,
                        `dependsOnJson` TEXT NOT NULL,
                        `status` TEXT NOT NULL,
                        `blockReason` TEXT,
                        `postConditionPassed` INTEGER,
                        `outcomeDetail` TEXT,
                        `rollbackAvailable` INTEGER NOT NULL DEFAULT 0
                    )
                """.trimIndent())
            }
        }

        private val MIGRATION_10_11 = object : Migration(10, 11) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `chat_messages` ADD COLUMN `sourceRef` TEXT")
                // Fail closed for pre-existing rows where provenance may have been unset or implicitly trusted.
                db.execSQL("UPDATE `chat_messages` SET `provenance` = 'UNTRUSTED'")
            }
        }

        private val MIGRATION_11_12 = object : Migration(11, 12) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS `model_usage` (
                        `id` TEXT NOT NULL PRIMARY KEY,
                        `timestamp` INTEGER NOT NULL,
                        `sessionId` TEXT NOT NULL,
                        `lane` TEXT NOT NULL,
                        `provider` TEXT NOT NULL,
                        `model` TEXT NOT NULL,
                        `tokensIn` INTEGER,
                        `tokensOut` INTEGER,
                        `latencyMs` INTEGER NOT NULL
                    )
                """.trimIndent())
            }
        }

        private val MIGRATION_12_13 = object : Migration(12, 13) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS `memory_facts` (
                        `id` TEXT NOT NULL PRIMARY KEY,
                        `content` TEXT NOT NULL,
                        `category` TEXT NOT NULL,
                        `createdAt` INTEGER NOT NULL,
                        `sourceRef` TEXT
                    )
                """.trimIndent())
            }
        }

        private val MIGRATION_14_15 = object : Migration(14, 15) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // Caches a one-line description of an attached image so older
                // turns replay as cheap text instead of re-uploading the
                // base64 bytes on every subsequent request.
                db.execSQL("ALTER TABLE `chat_messages` ADD COLUMN `imageSummary` TEXT")
            }
        }

        private val MIGRATION_13_14 = object : Migration(13, 14) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `chat_messages` ADD COLUMN `imagePath` TEXT")
            }
        }

        private val MIGRATION_15_16 = object : Migration(15, 16) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // Friendly provider/model label ("Claude Sonnet 5") stamped on each
                // ASSISTANT message, so a mid-conversation fallback is visible on the
                // bubble itself instead of only in a system-message aside.
                db.execSQL("ALTER TABLE `chat_messages` ADD COLUMN `modelLabel` TEXT")
            }
        }
    }
}
