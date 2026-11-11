package com.splinch.junction.feature.projects

/** Invalidates responses begun before a confirmed mutation or a navigation change. */
class ObjectiveRefreshGate {
    private var generation = 0L
    @Synchronized fun begin(): Long = generation
    @Synchronized fun accepts(ticket: Long): Boolean = ticket == generation
    @Synchronized fun invalidate() { generation++ }
}
