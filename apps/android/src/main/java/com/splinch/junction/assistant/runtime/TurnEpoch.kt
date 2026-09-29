package com.splinch.junction.assistant.runtime

import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicBoolean

/** Rejects provider events belonging to a turn superseded by a newer owner message. */
class TurnEpoch {
    private val current = AtomicLong(0)

    fun begin(): Long = current.incrementAndGet()

    fun isCurrent(epoch: Long): Boolean = current.get() == epoch
}

/** Delivers the terminal result of a turn at most once across normal and cancellation paths. */
class TurnCompletion(private val callback: ((TurnOutcome) -> Unit)?) {
    private val delivered = AtomicBoolean(false)

    fun report(outcome: TurnOutcome): Boolean {
        if (callback == null || !delivered.compareAndSet(false, true)) return false
        callback.invoke(outcome)
        return true
    }
}
