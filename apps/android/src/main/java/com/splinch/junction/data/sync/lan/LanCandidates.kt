package com.splinch.junction.data.sync.lan

import kotlinx.coroutines.TimeoutCancellationException

/** Advertisements are address hints only. Transport must still verify saved trust. */
fun lanCandidates(discovered: List<LanEndpoint>, trusted: LanProtocol.PairingCode?): List<LanEndpoint> =
    (discovered.filter { trusted == null || it.instanceId == trusted.instanceId } +
        listOfNotNull(trusted?.let { LanEndpoint(it.host, it.port, it.instanceId, it.certificateSha256) }))
        .distinctBy { it.host to it.port }

fun canTryAnotherLanAddress(error: Throwable): Boolean = error is TimeoutCancellationException ||
    error is java.net.ConnectException || error is java.net.SocketTimeoutException || error is java.net.UnknownHostException ||
    (error is LanFailure && error.kind in setOf(LanFailureKind.UNREACHABLE, LanFailureKind.TIMEOUT))
