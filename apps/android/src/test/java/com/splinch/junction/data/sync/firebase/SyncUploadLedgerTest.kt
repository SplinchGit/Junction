package com.splinch.junction.data.sync.firebase

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncUploadLedgerTest {
    private val store = mutableMapOf<String, String>()
    private val ledger = SyncUploadLedger({ store[it] }, { key, value -> store[key] = value })

    @Test
    fun uploadedMessagesAreNotResent() {
        assertFalse(ledger.messageUploaded("owner", "m1"))
        ledger.recordMessage("owner", "m1")
        assertTrue(ledger.messageUploaded("owner", "m1"))
        assertFalse(ledger.messageUploaded("owner", "m2"))
        // Persisted: a new ledger over the same storage remembers the upload.
        assertTrue(SyncUploadLedger({ store[it] }, { key, value -> store[key] = value }).messageUploaded("owner", "m1"))
    }

    @Test
    fun conversationIsResentOnlyWhenItAdvances() {
        assertFalse(ledger.conversationCurrent("owner", "c1", 100))
        ledger.recordConversation("owner", "c1", 100)
        assertTrue(ledger.conversationCurrent("owner", "c1", 100))
        assertFalse(ledger.conversationCurrent("owner", "c1", 101))
        // An older timestamp never moves the marker backwards.
        ledger.recordConversation("owner", "c1", 50)
        assertTrue(ledger.conversationCurrent("owner", "c1", 100))
    }

    @Test
    fun ledgersAreSeparatePerAccount() {
        ledger.recordMessage("owner", "m1")
        assertFalse(ledger.messageUploaded("other", "m1"))
    }

    @Test
    fun corruptStorageFallsBackToResendingRatherThanFailing() {
        store["uploaded:owner"] = "{not json"
        assertFalse(ledger.messageUploaded("owner", "m1"))
        ledger.recordMessage("owner", "m1")
        assertTrue(ledger.messageUploaded("owner", "m1"))
    }

    @Test
    fun ledgerStaysBounded() {
        val small = SyncUploadLedger({ store[it] }, { key, value -> store[key] = value }, maxMessages = 50)
        repeat(75) { small.recordMessage("owner", "m$it") }
        val stored = org.json.JSONObject(store.getValue("uploaded:owner")).getJSONObject("messages")
        assertEquals(50, stored.length())
    }
}
