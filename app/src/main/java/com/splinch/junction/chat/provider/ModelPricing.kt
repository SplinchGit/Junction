package com.splinch.junction.chat.provider

/**
 * §Cost control: rough per-model USD-per-token rates used only to populate
 * [ActionLogEntity.costEstimate][com.splinch.junction.data.ActionLogEntity]
 * and the Settings running-total — an estimate for the owner's own budgeting,
 * not a billing-accurate figure. Rates are approximate list prices and will
 * drift out of date; unknown models fall back to a conservative blended rate
 * rather than reporting no cost at all.
 */
object ModelPricing {
    private data class Rate(val inputPerToken: Double, val outputPerToken: Double)

    private val rates: List<Pair<String, Rate>> = listOf(
        "claude-haiku" to Rate(0.80 / 1_000_000, 4.0 / 1_000_000),
        "claude-sonnet" to Rate(3.0 / 1_000_000, 15.0 / 1_000_000),
        "claude-opus" to Rate(15.0 / 1_000_000, 75.0 / 1_000_000),
        "gpt-4.1-mini" to Rate(0.40 / 1_000_000, 1.60 / 1_000_000),
        "gpt-4.1" to Rate(2.0 / 1_000_000, 8.0 / 1_000_000),
        "gpt-4o-mini" to Rate(0.15 / 1_000_000, 0.60 / 1_000_000),
        "gpt-4o" to Rate(2.5 / 1_000_000, 10.0 / 1_000_000),
        "deepseek" to Rate(0.27 / 1_000_000, 1.10 / 1_000_000)
    )

    private val fallback = Rate(1.0 / 1_000_000, 3.0 / 1_000_000)

    fun estimateCostUsd(model: String?, tokensIn: Int?, tokensOut: Int?): Double? {
        if (tokensIn == null && tokensOut == null) return null
        val rate = model?.lowercase()?.let { m -> rates.firstOrNull { m.contains(it.first) }?.second } ?: fallback
        return (tokensIn ?: 0) * rate.inputPerToken + (tokensOut ?: 0) * rate.outputPerToken
    }
}
