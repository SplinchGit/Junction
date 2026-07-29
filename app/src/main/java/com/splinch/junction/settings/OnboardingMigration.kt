package com.splinch.junction.settings

import kotlinx.coroutines.flow.first

/**
 * Existing users predate the onboarding flag and already have a provider key
 * stored — treat that as onboarding-done rather than forcing them through the
 * wizard again. Call once per process start, not on every recomposition: a
 * later "run wizard again" (flag flipped back to false from Settings) would
 * otherwise be instantly self-defeated by this same heuristic re-detecting
 * the still-present key.
 */
suspend fun resolveOnboardingCompleted(
    prefs: UserPrefsRepository,
    keyStorage: KeyStorage
): Boolean {
    if (prefs.onboardingCompletedFlow.first()) return true
    val config = prefs.providerConfigFlow.first()
    val hasKey = keyStorage.getApiKey(config.providerId).isNotBlank()
    if (hasKey) {
        prefs.setOnboardingCompleted(true)
        return true
    }
    return false
}
