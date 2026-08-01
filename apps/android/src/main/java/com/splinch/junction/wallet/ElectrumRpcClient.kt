package com.splinch.junction.wallet

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Credentials
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit

/**
 * §4 transport. A thin JSON-RPC 2.0 client over HTTP basic auth.
 *
 * Holds no wallet logic and no keys. Nothing throws across this boundary —
 * every failure comes back as [ElectrumResult.Err] carrying a §8 case.
 *
 * Logging: this class never logs request bodies. `payto` bodies in particular
 * carry the wallet spend password, so [describeForLog] emits the method name
 * and nothing else (§6.3).
 */
class ElectrumRpcClient(
    private val configProvider: suspend () -> ElectrumConfig?,
    private val rpcPasswordProvider: suspend () -> String?,
    private val hostPolicy: HostPolicy = HostPolicy.Loopback
) {

    private val jsonMediaType = "application/json".toMediaType()

    /** Built per-call because the read timeout is configurable (§7). */
    private fun clientFor(config: ElectrumConfig) = OkHttpClient.Builder()
        .connectTimeout(config.timeoutSeconds.toLong(), TimeUnit.SECONDS)
        .readTimeout(config.timeoutSeconds.toLong(), TimeUnit.SECONDS)
        .retryOnConnectionFailure(false) // §8: no silent retries on any method.
        .build()

    /**
     * Invoke an Electrum RPC method with ordinary (non-secret) parameters.
     *
     * @param params positional or named parameters; Electrum 4.x accepts an
     *   object for named params, which is what the callers here use.
     */
    suspend fun call(method: String, params: JSONObject = JSONObject()): ElectrumResult<Any?> {
        val config = resolveConfig() ?: return ElectrumResult.Err(
            ElectrumError.NotConfigured("Electrum isn't set up yet.")
        )
        hostPolicy.rejectionReason(config.host)?.let {
            return ElectrumResult.Err(ElectrumError.NotConfigured(it))
        }
        val body = JSONObject().apply {
            put("jsonrpc", "2.0")
            put("id", "junction")
            put("method", method)
            put("params", params)
        }.toString()

        return execute(config, method, body.toByteArray(Charsets.UTF_8))
    }

    /**
     * Invoke a method that requires the wallet spend password.
     *
     * The password arrives as a [CharArray] and is escaped straight into the
     * request bytes — it is never concatenated into a String, because JVM
     * Strings are immutable and cannot be wiped (§6.2, §9). The intermediate
     * buffer is zeroed before this function returns.
     *
     * The caller still owns [password] and must zero it in its own `finally`.
     * This function does not zero the caller's array, so a caller that reuses
     * it for a retry is not left with a blank one.
     */
    suspend fun callWithPassword(
        method: String,
        params: JSONObject,
        password: CharArray
    ): ElectrumResult<Any?> {
        val config = resolveConfig() ?: return ElectrumResult.Err(
            ElectrumError.NotConfigured("Electrum isn't set up yet.")
        )
        hostPolicy.rejectionReason(config.host)?.let {
            return ElectrumResult.Err(ElectrumError.NotConfigured(it))
        }

        val buffer = StringBuilder(256)
        var bytes: ByteArray? = null
        try {
            // Serialise the non-secret part first, then splice the password in.
            // params must not already contain a "password" key.
            buffer.append("{\"jsonrpc\":\"2.0\",\"id\":\"junction\",\"method\":")
            buffer.append(JSONObject.quote(method))
            buffer.append(",\"params\":{")
            val keys = params.keys().asSequence().toList()
            for (key in keys) {
                buffer.append(JSONObject.quote(key)).append(':')
                buffer.append(jsonValue(params.opt(key)))
                buffer.append(',')
            }
            buffer.append("\"password\":\"")
            appendJsonEscaped(buffer, password)
            buffer.append("\"}}")

            bytes = encodeAndWipe(buffer)
            return execute(config, method, bytes)
        } finally {
            wipe(buffer)
            bytes?.fill(0)
        }
    }

    // ── Internals ────────────────────────────────────────────────────────────

    private suspend fun resolveConfig(): ElectrumConfig? = configProvider()

    private suspend fun execute(
        config: ElectrumConfig,
        method: String,
        bodyBytes: ByteArray
    ): ElectrumResult<Any?> = withContext(Dispatchers.IO) {
        val rpcPassword = rpcPasswordProvider() ?: return@withContext ElectrumResult.Err(
            ElectrumError.NotConfigured("No Electrum RPC password stored.")
        )

        val request = Request.Builder()
            .url("http://${config.host}:${config.port}")
            .header("Authorization", Credentials.basic(config.rpcUser, rpcPassword))
            .header("Content-Type", "application/json")
            .post(bodyBytes.toRequestBody(jsonMediaType))
            .build()

        try {
            clientFor(config).newCall(request).execute().use { response ->
                if (response.code == 401 || response.code == 403) {
                    return@withContext ElectrumResult.Err(ElectrumError.AuthFailed)
                }
                val text = response.body?.string().orEmpty()
                if (text.isBlank()) {
                    return@withContext ElectrumResult.Err(
                        ElectrumError.Unexpected("Empty response from ${describeForLog(method)}.")
                    )
                }
                parseEnvelope(text)
            }
        } catch (e: SocketTimeoutException) {
            // §8: a broadcast timeout is indeterminate and must never be retried.
            ElectrumResult.Err(
                if (method == "broadcast") ElectrumError.BroadcastIndeterminate
                else ElectrumError.Timeout
            )
        } catch (e: ConnectException) {
            ElectrumResult.Err(ElectrumError.DaemonUnreachable)
        } catch (e: IOException) {
            ElectrumResult.Err(
                if (method == "broadcast") ElectrumError.BroadcastIndeterminate
                else ElectrumError.DaemonUnreachable
            )
        }
    }

    private fun parseEnvelope(text: String): ElectrumResult<Any?> {
        val json = try {
            JSONObject(text)
        } catch (e: Exception) {
            return ElectrumResult.Err(
                ElectrumError.Unexpected("Electrum sent a response Junction couldn't read.")
            )
        }

        if (!json.isNull("error")) {
            val errorField = json.opt("error")
            return when (errorField) {
                is JSONObject -> ElectrumResult.Err(
                    classifyRpcError(
                        code = errorField.optInt("code", 0),
                        message = errorField.optString("message", errorField.toString())
                    )
                )
                else -> ElectrumResult.Err(classifyRpcError(0, errorField.toString()))
            }
        }
        return ElectrumResult.Ok(if (json.isNull("result")) null else json.opt("result"))
    }

    /** §6.3: safe to log. Method name only — never arguments, never the body. */
    private fun describeForLog(method: String) = "electrum.$method"

    private fun jsonValue(value: Any?): String = when (value) {
        null, JSONObject.NULL -> "null"
        is String -> JSONObject.quote(value)
        is Number, is Boolean -> value.toString()
        is JSONObject, is JSONArray -> value.toString()
        else -> JSONObject.quote(value.toString())
    }

    private fun appendJsonEscaped(sb: StringBuilder, chars: CharArray) {
        for (c in chars) {
            when (c) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                '\b' -> sb.append("\\b")
                '' -> sb.append("\\f")
                else -> if (c < ' ') sb.append("\\u%04x".format(c.code)) else sb.append(c)
            }
        }
    }

    /**
     * UTF-8 encodes the buffer without going through [StringBuilder.toString],
     * which would create an unwipeable String holding the password.
     */
    private fun encodeAndWipe(sb: StringBuilder): ByteArray {
        val chars = CharArray(sb.length)
        sb.getChars(0, sb.length, chars, 0)
        val buffer = Charsets.UTF_8.encode(java.nio.CharBuffer.wrap(chars))
        val bytes = ByteArray(buffer.remaining())
        buffer.get(bytes)
        chars.fill(' ')
        return bytes
    }

    private fun wipe(sb: StringBuilder) {
        for (i in 0 until sb.length) sb.setCharAt(i, ' ')
        sb.setLength(0)
    }
}
