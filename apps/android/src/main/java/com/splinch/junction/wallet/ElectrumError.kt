package com.splinch.junction.wallet

/**
 * §8 error taxonomy. Every failure mode the owner can hit gets its own case
 * with its own message — no generic "something went wrong", and no stack trace
 * ever reaches the UI (§9).
 *
 * [BroadcastIndeterminate] is deliberately distinct from [Timeout]: a
 * `broadcast` call that times out may or may not have reached the network, so
 * it must never be auto-retried (§8). It is modelled as its own outcome so a
 * caller cannot accidentally fold it into generic retry handling.
 */
sealed class ElectrumError(val userMessage: String) {

    data object DaemonUnreachable : ElectrumError(
        "Can't reach the Electrum daemon. Check it's running (`electrum daemon -d`) " +
            "and that its RPC port is forwarded to this device."
    )

    data object AuthFailed : ElectrumError(
        "Electrum rejected the RPC credentials. Check the username and password " +
            "against `electrum getconfig rpcuser` and `electrum getconfig rpcpassword`."
    )

    data object NoWalletLoaded : ElectrumError(
        "No wallet is loaded in Electrum. Run `electrum load_wallet` and try again."
    )

    data object WalletLocked : ElectrumError(
        "Wrong wallet password, or the wallet is locked."
    )

    data class InsufficientFunds(val detail: String) : ElectrumError(
        "Not enough confirmed balance to cover that amount plus the fee."
    )

    data class InvalidAddress(val address: String) : ElectrumError(
        "Electrum rejected that destination address."
    )

    data class NotSynchronised(val detail: String) : ElectrumError(
        "Electrum hasn't finished syncing. Balances and history may be wrong — " +
            "wait for sync to complete before spending."
    )

    data class BroadcastRejected(val detail: String) : ElectrumError(
        "The network rejected the transaction: $detail"
    )

    data object Timeout : ElectrumError(
        "Electrum didn't respond in time. Nothing was sent."
    )

    /**
     * A `broadcast` that timed out or failed ambiguously. The transaction may
     * or may not have been published. Never retried automatically (§8).
     */
    data object BroadcastIndeterminate : ElectrumError(
        "The broadcast timed out and Junction can't tell whether it went through. " +
            "Do NOT send again — check your transaction history for the payment first."
    )

    data class NotConfigured(val reason: String) : ElectrumError(reason)

    data class RateLimited(val retryAfterSeconds: Long) : ElectrumError(
        "Too many attempts. Wait $retryAfterSeconds seconds and try again."
    )

    /** An Electrum-side JSON-RPC error that didn't match a known case. */
    data class Rpc(val code: Int, val detail: String) : ElectrumError(
        "Electrum returned an error: $detail"
    )

    /** A transport or parsing failure that didn't match a known case. */
    data class Unexpected(val detail: String) : ElectrumError(
        "Unexpected problem talking to Electrum: $detail"
    )
}

/** Result of any Electrum call. Nothing throws across the module boundary. */
sealed interface ElectrumResult<out T> {
    data class Ok<T>(val value: T) : ElectrumResult<T>
    data class Err(val error: ElectrumError) : ElectrumResult<Nothing>
}

inline fun <T, R> ElectrumResult<T>.map(transform: (T) -> R): ElectrumResult<R> = when (this) {
    is ElectrumResult.Ok -> ElectrumResult.Ok(transform(value))
    is ElectrumResult.Err -> this
}

/**
 * Maps an Electrum JSON-RPC error payload onto the §8 taxonomy.
 *
 * Electrum does not use stable numeric codes for wallet-level failures, so
 * these are matched on message text. Kept in one function so the matching is
 * auditable and easy to correct against the installed version.
 */
fun classifyRpcError(code: Int, message: String): ElectrumError {
    val m = message.lowercase()
    return when {
        m.contains("wallet not loaded") ||
            m.contains("no wallet") ||
            m.contains("not loaded") -> ElectrumError.NoWalletLoaded

        m.contains("invalid password") ||
            m.contains("wrong password") ||
            m.contains("incorrect password") ||
            m.contains("password required") ||
            m.contains("decrypt") -> ElectrumError.WalletLocked

        m.contains("insufficient funds") ||
            m.contains("not enough funds") ||
            m.contains("no utxo") -> ElectrumError.InsufficientFunds(message)

        m.contains("invalid bitcoin address") ||
            m.contains("invalid address") ||
            m.contains("not a valid address") -> ElectrumError.InvalidAddress(message)

        m.contains("not connected") ||
            m.contains("not synchronized") ||
            m.contains("not synchronised") -> ElectrumError.NotSynchronised(message)

        m.contains("rejected") ||
            m.contains("txn-") ||
            m.contains("dust") ||
            m.contains("min relay fee") -> ElectrumError.BroadcastRejected(message)

        else -> ElectrumError.Rpc(code, message)
    }
}
