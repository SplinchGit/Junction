package com.splinch.junction.data.database.memory

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * §3.3 minimal living profile: a single durable fact (person, preference, or
 * objective) built forward from conversation. Always [Provenance.OWNER] —
 * created only via the owner-confirmed `remember_fact` tool, never inferred
 * automatically from untrusted content — so it may safely be replayed into
 * future context as [Provenance.JUNCTION] (Junction's own state).
 */
@Entity(tableName = "memory_facts")
data class MemoryFactEntity(
    @PrimaryKey val id: String,
    val content: String,
    val category: String, // "person" | "preference" | "objective" | "other"
    val createdAt: Long,
    val sourceRef: String?
)
