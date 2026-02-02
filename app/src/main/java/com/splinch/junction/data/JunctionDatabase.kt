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
    version = 3,
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
                ).addMigrations(MIGRATION_1_2, MIGRATION_2_3)
                    .fallbackToDestructiveMigration()
                    .build()
                    .also { INSTANCE = it }
            }
        }

        private data class ColumnSpec(
            val name: String,
            val sqlType: String,
            val notNull: Boolean,
            val defaultExpr: String,
            val coalesceExpr: (existingColumns: Set<String>) -> String
        )

        private fun tableExists(db: SupportSQLiteDatabase, table: String): Boolean {
            db.query(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='$table'"
            ).use { cursor ->
                return cursor.moveToFirst()
            }
        }

        private fun getColumns(db: SupportSQLiteDatabase, table: String): Set<String> {
            if (!tableExists(db, table)) return emptySet()
            db.query("PRAGMA table_info(`$table`)").use { cursor ->
                val nameIndex = cursor.getColumnIndex("name")
                val columns = mutableSetOf<String>()
                while (cursor.moveToNext()) {
                    if (nameIndex >= 0) {
                        columns.add(cursor.getString(nameIndex))
                    }
                }
                return columns
            }
        }

        private fun ensureColumn(
            db: SupportSQLiteDatabase,
            table: String,
            column: String,
            definition: String
        ) {
            val columns = getColumns(db, table)
            if (!columns.contains(column)) {
                db.execSQL("ALTER TABLE `$table` ADD COLUMN $column $definition")
            }
        }

        private fun createFeedItemsTable(db: SupportSQLiteDatabase, tableName: String) {
            db.execSQL(
                """
                CREATE TABLE IF NOT EXISTS `$tableName` (
                    id TEXT NOT NULL PRIMARY KEY,
                    source TEXT NOT NULL,
                    packageName TEXT,
                    category TEXT NOT NULL,
                    title TEXT NOT NULL,
                    body TEXT,
                    timestamp INTEGER NOT NULL,
                    priority INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    threadKey TEXT,
                    actionHint TEXT,
                    updatedAt INTEGER NOT NULL
                )
                """.trimIndent()
            )
        }

        private fun rebuildFeedItems(db: SupportSQLiteDatabase) {
            val existingColumns = getColumns(db, "feed_items")
            createFeedItemsTable(db, "feed_items_new")
            if (existingColumns.isNotEmpty()) {
                val columns = listOf(
                    ColumnSpec(
                        name = "id",
                        sqlType = "TEXT",
                        notNull = true,
                        defaultExpr = "lower(hex(randomblob(16)))",
                        coalesceExpr = { cols ->
                            if (cols.contains("id")) {
                                "COALESCE(id, lower(hex(randomblob(16))))"
                            } else {
                                "lower(hex(randomblob(16)))"
                            }
                        }
                    ),
                    ColumnSpec(
                        name = "source",
                        sqlType = "TEXT",
                        notNull = true,
                        defaultExpr = "'Unknown'",
                        coalesceExpr = { cols ->
                            if (cols.contains("source")) "COALESCE(source, 'Unknown')" else "'Unknown'"
                        }
                    ),
                    ColumnSpec(
                        name = "packageName",
                        sqlType = "TEXT",
                        notNull = false,
                        defaultExpr = "NULL",
                        coalesceExpr = { cols ->
                            if (cols.contains("packageName")) "packageName" else "NULL"
                        }
                    ),
                    ColumnSpec(
                        name = "category",
                        sqlType = "TEXT",
                        notNull = true,
                        defaultExpr = "'OTHER'",
                        coalesceExpr = { cols ->
                            if (cols.contains("category")) "COALESCE(category, 'OTHER')" else "'OTHER'"
                        }
                    ),
                    ColumnSpec(
                        name = "title",
                        sqlType = "TEXT",
                        notNull = true,
                        defaultExpr = "''",
                        coalesceExpr = { cols ->
                            if (cols.contains("title")) "COALESCE(title, '')" else "''"
                        }
                    ),
                    ColumnSpec(
                        name = "body",
                        sqlType = "TEXT",
                        notNull = false,
                        defaultExpr = "NULL",
                        coalesceExpr = { cols ->
                            if (cols.contains("body")) "body" else "NULL"
                        }
                    ),
                    ColumnSpec(
                        name = "timestamp",
                        sqlType = "INTEGER",
                        notNull = true,
                        defaultExpr = "0",
                        coalesceExpr = { cols ->
                            if (cols.contains("timestamp")) "COALESCE(timestamp, 0)" else "0"
                        }
                    ),
                    ColumnSpec(
                        name = "priority",
                        sqlType = "INTEGER",
                        notNull = true,
                        defaultExpr = "5",
                        coalesceExpr = { cols ->
                            if (cols.contains("priority")) "COALESCE(priority, 5)" else "5"
                        }
                    ),
                    ColumnSpec(
                        name = "status",
                        sqlType = "TEXT",
                        notNull = true,
                        defaultExpr = "'NEW'",
                        coalesceExpr = { cols ->
                            if (cols.contains("status")) "COALESCE(status, 'NEW')" else "'NEW'"
                        }
                    ),
                    ColumnSpec(
                        name = "threadKey",
                        sqlType = "TEXT",
                        notNull = false,
                        defaultExpr = "NULL",
                        coalesceExpr = { cols ->
                            if (cols.contains("threadKey")) "threadKey" else "NULL"
                        }
                    ),
                    ColumnSpec(
                        name = "actionHint",
                        sqlType = "TEXT",
                        notNull = false,
                        defaultExpr = "NULL",
                        coalesceExpr = { cols ->
                            if (cols.contains("actionHint")) "actionHint" else "NULL"
                        }
                    ),
                    ColumnSpec(
                        name = "updatedAt",
                        sqlType = "INTEGER",
                        notNull = true,
                        defaultExpr = "0",
                        coalesceExpr = { cols ->
                            if (cols.contains("updatedAt")) {
                                if (cols.contains("timestamp")) {
                                    "COALESCE(updatedAt, timestamp, 0)"
                                } else {
                                    "COALESCE(updatedAt, 0)"
                                }
                            } else if (cols.contains("timestamp")) {
                                "COALESCE(timestamp, 0)"
                            } else {
                                "0"
                            }
                        }
                    )
                )

                val insertColumns = columns.joinToString(", ") { it.name }
                val selectColumns = columns.joinToString(", ") { it.coalesceExpr(existingColumns) }
                db.execSQL(
                    "INSERT INTO feed_items_new ($insertColumns) SELECT $selectColumns FROM feed_items"
                )
                db.execSQL("DROP TABLE feed_items")
            }
            db.execSQL("ALTER TABLE feed_items_new RENAME TO feed_items")
        }

        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                if (tableExists(db, "chat_sessions")) {
                    ensureColumn(
                        db,
                        "chat_sessions",
                        "speechModeEnabled",
                        "INTEGER NOT NULL DEFAULT 0"
                    )
                    ensureColumn(
                        db,
                        "chat_sessions",
                        "agentToolsEnabled",
                        "INTEGER NOT NULL DEFAULT 1"
                    )
                }
            }
        }

        private val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                if (tableExists(db, "chat_sessions")) {
                    ensureColumn(
                        db,
                        "chat_sessions",
                        "speechModeEnabled",
                        "INTEGER NOT NULL DEFAULT 0"
                    )
                    ensureColumn(
                        db,
                        "chat_sessions",
                        "agentToolsEnabled",
                        "INTEGER NOT NULL DEFAULT 1"
                    )
                }
                rebuildFeedItems(db)
            }
        }
    }
}
