package com.splinch.junction.data.sync.lan

import kotlinx.coroutines.TimeoutCancellationException

/** Advertisements are address hints only. Transport must still verify saved trust. */
fun lanCandidates(discovered: List<LanEndpoint>, trusted: LanProtocol.PairingCode?, manualHost: String = ""): List<LanEndpoint> =
    (listOfNotNull(trusted?.takeIf { manualHost.matches(Regex("[A-Za-z0-9_.:-]{1,253}")) }?.let {
        LanEndpoint(manualHost, it.port, it.instanceId, it.certificateSha256)
    }) + discovered.filter { trusted == null || it.instanceId == trusted.instanceId } +
        listOfNotNull(trusted?.let { LanEndpoint(it.host, it.port, it.instanceId, it.certificateSha256) }))
        .distinctBy { it.host to it.port }

fun canTryAnotherLanAddress(error: Throwable): Boolean = error is TimeoutCancellationException ||
    error is java.net.ConnectException || error is java.net.SocketTimeoutException || error is java.net.UnknownHostException ||
    (error is LanFailure && error.kind in setOf(LanFailureKind.UNREACHABLE, LanFailureKind.TIMEOUT))

/** A relay may recover a network outage, but must never override an explicit trust rejection. */
fun canFallbackToRelay(error: Throwable): Boolean = when (error) {
    is LanFailure -> error.kind in setOf(LanFailureKind.UNREACHABLE, LanFailureKind.TIMEOUT, LanFailureKind.DISCONNECTED)
    is java.net.ConnectException, is java.net.SocketTimeoutException, is java.net.UnknownHostException,
    is TimeoutCancellationException -> true
    else -> false
}
