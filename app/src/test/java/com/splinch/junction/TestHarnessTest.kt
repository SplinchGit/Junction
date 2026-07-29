package com.splinch.junction

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Guards the unit-test harness itself.
 *
 * The injection suite (spec 1.6) parses tool arguments and reader output with
 * org.json, which android.jar only stubs for local unit tests. If the real
 * implementation ever falls off the test classpath this fails loudly here,
 * rather than silently turning security assertions into no-ops.
 */
class TestHarnessTest {

    @Test
    fun `org_json is a real implementation on the unit test classpath`() {
        val parsed = JSONObject("""{"tool":"email_send","recipient":"a@example.com"}""")

        assertEquals("email_send", parsed.getString("tool"))
        assertEquals("a@example.com", parsed.getString("recipient"))
    }
}
