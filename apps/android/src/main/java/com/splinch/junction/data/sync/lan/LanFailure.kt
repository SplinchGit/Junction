package com.splinch.junction.data.sync.lan

enum class LanFailureKind { NOT_DISCOVERED, UNREACHABLE, AUTHENTICATION, STALE_TRUST, TIMEOUT, DISCONNECTED }

class LanFailure(val kind: LanFailureKind, message: String, cause: Throwable? = null) : java.io.IOException(message, cause)

interface LanIdentity {
    fun loadPairing(): LanProtocol.PairingCode?
    fun savePairing(pairing: LanProtocol.PairingCode)
    fun deviceId(): String
    fun publicKeyBase64(): String
    fun sign(message: ByteArray): String
}
