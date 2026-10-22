package com.splinch.junction.data.sync.lan

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The vector is signed by the Windows host's real signer (device-commands.js tlsSigner). */
class DeviceCommandVerifierTest {
    private val vector = JSONObject(javaClass.classLoader!!.getResource("device-command-vector.json")!!.readText())
    private val pin = vector.getString("pin")
    private val envelope = vector.getJSONObject("envelope").let { json -> json.keys().asSequence().associateWith { json.get(it) as Any? } }
    private val now = 1_800_000_001_000L

    private fun verify(
        envelope: Map<String, Any?> = this.envelope,
        pin: String = this.pin,
        instance: String = "instance-1",
        device: String = "phone-1",
        at: Long = now,
        seen: (String) -> Boolean = { false }
    ) = DeviceCommandVerifier.verify(envelope, pin, instance, device, at, seen)

    private fun refusal(outcome: DeviceCommandVerifier.Outcome) = (outcome as DeviceCommandVerifier.Outcome.Refused).reason

    @Test
    fun acceptsTheWindowsSignedCommand() {
        val command = (verify() as DeviceCommandVerifier.Outcome.Accepted).command
        assertEquals("COLLECT_LOGS", command.kind)
        assertEquals("READ", command.tier)
        assertEquals(50, command.args.getInt("lines"))
        assertEquals("claude", command.requestedBy)
    }

    @Test
    fun refusesATamperedBody() {
        val tampered = envelope + ("body" to (envelope["body"] as String).replace("\"lines\":50", "\"lines\":500"))
        assertEquals("invalid signature", refusal(verify(tampered)))
    }

    @Test
    fun refusesAKeyOtherThanThePairedPc() {
        assertEquals("key does not match the paired PC", refusal(verify(pin = "0".repeat(64))))
        assertEquals("key does not match the paired PC", refusal(verify(pin = "not-hex")))
    }

    @Test
    fun refusesWrongInstanceDeviceExpiryAndReplay() {
        assertEquals("command is from a different PC", refusal(verify(instance = "other")))
        assertEquals("command is for a different device", refusal(verify(device = "phone-2")))
        assertEquals("command expired", refusal(verify(at = 1_800_000_900_000L)))
        assertEquals("command is from the future", refusal(verify(at = 1_799_999_000_000L)))
        val replay = verify(seen = { it == "0f8e9c4a-2b1d-4c3e-9a7f-5d6b8e1f2a3c" }) as DeviceCommandVerifier.Outcome.Refused
        assertEquals("command already handled", replay.reason)
        assertEquals("0f8e9c4a-2b1d-4c3e-9a7f-5d6b8e1f2a3c", replay.id)
    }

    @Test
    fun refusesMalformedEnvelopes() {
        assertEquals("missing signature", refusal(verify(envelope - "signature")))
        assertEquals("oversized command", refusal(verify(envelope + ("body" to "x".repeat(9_000)))))
        assertTrue(refusal(verify(envelope + ("spki" to "%%%"))).isNotBlank())
    }
}
