package com.splinch.junction.wallet

/**
 * §7 configuration for the Electrum JSON-RPC daemon.
 *
 * Junction is a *client only*. It implements no wallet logic, generates no
 * keys, and has no code path that reads, requests, displays or transmits a
 * seed phrase (§2, §6.4). Every cryptographic operation stays inside Electrum.
 *
 * [rpcPassword] is never held here at rest — it is read from [ElectrumSecrets]
 * (EncryptedSharedPreferences) at call time and lives only for the request.
 */
data class ElectrumConfig(
    val host: String,
    /** §7: no default. Electrum assigns a random RPC port unless set explicitly. */
    val port: Int,
    val rpcUser: String,
    val timeoutSeconds: Int = DEFAULT_TIMEOUT_SECONDS
) {
    companion object {
        const val DEFAULT_HOST = "127.0.0.1"
        const val DEFAULT_TIMEOUT_SECONDS = 5
    }
}

/**
 * §6.1 host restriction, isolated to one place.
 *
 * Electrum's RPC uses HTTP basic auth, which sends credentials unencrypted.
 * Junction must therefore never speak to a daemon over an untrusted network.
 *
 * Junction runs on Android while Electrum runs on a desktop, so plain
 * "connect to 127.0.0.1" only reaches a daemon when something is forwarding
 * that loopback port to the host machine — `adb reverse tcp:<port> tcp:<port>`
 * over USB, or a local SSH port-forward. Both keep the connection genuinely
 * loopback from the device's point of view and satisfy §6.1 unmodified.
 *
 * [Loopback] is the only policy enabled. An encrypted-tunnel policy (Tailscale,
 * WireGuard) would slot in here as a second branch and nowhere else, but it
 * requires amending §6.1 and is deliberately not implemented yet.
 */
sealed interface HostPolicy {

    /** Returns null if the host is acceptable, or a reason string if it is not. */
    fun rejectionReason(host: String): String?

    data object Loopback : HostPolicy {
        private val allowed = setOf(
            "127.0.0.1",
            "::1",
            "0:0:0:0:0:0:0:1",
            "localhost"
        )

        override fun rejectionReason(host: String): String? {
            val normalised = host.trim().trim('[', ']').lowercase()
            // 127.0.0.0/8 is entirely loopback, not just 127.0.0.1.
            val isIpv4Loopback = normalised.startsWith("127.") &&
                normalised.split('.').let { parts ->
                    parts.size == 4 && parts.all { it.toIntOrNull() in 0..255 }
                }
            if (normalised in allowed || isIpv4Loopback) return null
            return "Junction only connects to a loopback address. Electrum's RPC sends " +
                "its credentials unencrypted, so a non-loopback host would expose them. " +
                "Forward the daemon's port to this device instead — " +
                "`adb reverse tcp:<port> tcp:<port>` over USB, or an SSH local forward."
        }
    }
}

/** Result of validating a candidate configuration before it is saved or used. */
sealed interface ConfigValidation {
    data class Valid(val config: ElectrumConfig) : ConfigValidation
    data class Invalid(val reason: String) : ConfigValidation
}

/**
 * Validates a candidate config. Called both when the owner saves settings and
 * before every connection, so a config that was persisted by an older build
 * can never be used if it would fail today's policy.
 */
fun validateElectrumConfig(
    host: String,
    port: Int?,
    rpcUser: String,
    timeoutSeconds: Int = ElectrumConfig.DEFAULT_TIMEOUT_SECONDS,
    policy: HostPolicy = HostPolicy.Loopback
): ConfigValidation {
    policy.rejectionReason(host)?.let { return ConfigValidation.Invalid(it) }

    if (port == null) {
        return ConfigValidation.Invalid(
            "Set the Electrum RPC port. There is no safe default — Electrum picks a " +
                "random port unless you run `electrum setconfig rpcport <port>`."
        )
    }
    if (port !in 1..65535) {
        return ConfigValidation.Invalid("Port must be between 1 and 65535.")
    }
    if (rpcUser.isBlank()) {
        return ConfigValidation.Invalid(
            "Set the RPC username — the value from `electrum getconfig rpcuser`."
        )
    }
    if (timeoutSeconds !in 1..120) {
        return ConfigValidation.Invalid("Timeout must be between 1 and 120 seconds.")
    }

    return ConfigValidation.Valid(
        ElectrumConfig(
            host = host.trim(),
            port = port,
            rpcUser = rpcUser.trim(),
            timeoutSeconds = timeoutSeconds
        )
    )
}
