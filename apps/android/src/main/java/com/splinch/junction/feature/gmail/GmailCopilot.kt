package com.splinch.junction.feature.gmail

import android.content.Context
import com.google.api.client.googleapis.extensions.android.gms.auth.GoogleAccountCredential
import com.google.api.client.googleapis.extensions.android.gms.auth.UserRecoverableAuthIOException
import com.google.api.client.http.javanet.NetHttpTransport
import com.google.api.client.json.gson.GsonFactory
import com.google.api.services.gmail.Gmail
import com.google.api.services.gmail.GmailScopes
import com.google.api.services.gmail.model.Message
import com.google.api.services.gmail.model.MessagePart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import android.util.Base64
import java.util.Properties
import javax.mail.Session
import javax.mail.internet.InternetAddress
import javax.mail.internet.MimeMessage
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

enum class EmailCategory { PRIMARY, SOCIAL, PROMOTIONS, UPDATES, FORUMS, OTHER }

data class EmailSummary(
    val id: String,
    val threadId: String,
    val subject: String,
    val from: String,
    val snippet: String,
    val timestamp: Long,
    val unread: Boolean,
    val category: EmailCategory = EmailCategory.OTHER,
    val hasListUnsubscribe: Boolean = false
)

data class DraftReplyResult(val draftId: String, val recipient: String)

/** Raw Gmail content is short-lived and must only be passed to the reader lane. */
data class EmailForReader(val summary: EmailSummary, val rawContent: String)

class GmailCopilot(context: Context, private val accountEmail: String) {
    private val credential = GoogleAccountCredential.usingOAuth2(
        context,
        listOf(GmailScopes.GMAIL_MODIFY, GmailScopes.GMAIL_COMPOSE)
    ).also { it.selectedAccountName = accountEmail }

    private val service = Gmail.Builder(
        NetHttpTransport(),
        GsonFactory.getDefaultInstance(),
        credential
    ).setApplicationName("Junction").build()

    suspend fun listUnread(maxResults: Long = 10): List<EmailSummary> = withContext(Dispatchers.IO) {
        val response = service.users().messages().list("me")
            .setQ("is:unread")
            .setMaxResults(maxResults)
            .execute()
        response.messages?.mapNotNull { ref ->
            runCatching {
                val msg = service.users().messages().get("me", ref.id)
                    .setFormat("metadata")
                    .setMetadataHeaders(listOf("Subject", "From", "Date"))
                    .execute()
                val headers = msg.payload?.headers?.associateBy { it.name.lowercase() }
                EmailSummary(
                    id = msg.id,
                    threadId = msg.threadId,
                    subject = headers?.get("subject")?.value ?: "(no subject)",
                    from = headers?.get("from")?.value ?: "",
                    snippet = msg.snippet ?: "",
                    timestamp = msg.internalDate ?: 0L,
                    unread = msg.labelIds?.contains("UNREAD") == true
                )
            }.getOrNull()
        } ?: emptyList()
    }

    suspend fun archiveMessage(messageId: String): Boolean = withContext(Dispatchers.IO) {
        runCatching {
            service.users().messages().modify("me", messageId,
                com.google.api.services.gmail.model.ModifyMessageRequest()
                    .setRemoveLabelIds(listOf("INBOX"))
            ).execute()
            true
        }.getOrDefault(false)
    }

    /**
     * Creates a reply draft only to an address already present in the thread.
     * The caller cannot provide a recipient, which blocks content-derived
     * novel-address egress before it reaches the sending tool.
     */
    suspend fun draftReply(threadId: String, body: String): DraftReplyResult? = withContext(Dispatchers.IO) {
        runCatching {
            val thread = service.users().threads().get("me", threadId)
                .setFormat("metadata")
                .setMetadataHeaders(listOf("From", "Reply-To", "Subject"))
                .execute()
            val latest = thread.messages?.lastOrNull()
                ?: throw IllegalArgumentException("Thread has no messages")
            val headers = latest.payload?.headers?.associateBy { it.name.lowercase() }.orEmpty()
            val recipient = parseAddress(
                headers["reply-to"]?.value ?: headers["from"]?.value.orEmpty()
            ) ?: throw IllegalArgumentException("Thread has no replyable sender address")
            if (recipient.equals(accountEmail, ignoreCase = true)) {
                throw IllegalArgumentException("Thread does not contain an external reply recipient")
            }
            val subject = headers["subject"]?.value.orEmpty().let {
                if (it.startsWith("Re:", ignoreCase = true)) it else "Re: $it"
            }
            val props = Properties()
            val session = Session.getDefaultInstance(props, null)
            val email = MimeMessage(session).apply {
                setFrom(InternetAddress(credential.selectedAccountName))
                addRecipient(javax.mail.Message.RecipientType.TO, InternetAddress(recipient))
                setSubject(subject)
                setText(body)
            }
            val baos = java.io.ByteArrayOutputStream()
            email.writeTo(baos)
            val raw = Base64.encodeToString(baos.toByteArray(), Base64.URL_SAFE or Base64.NO_WRAP)
            val draft = com.google.api.services.gmail.model.Draft().setMessage(
                Message().setRaw(raw).setThreadId(threadId)
            )
            val draftId = service.users().drafts().create("me", draft).execute().id
                ?: throw IllegalStateException("Gmail did not return a draft ID")
            DraftReplyResult(draftId, recipient)
        }.getOrNull()
    }

    /** Sends a previously created Gmail draft and confirms Gmail assigned it the SENT label. */
    suspend fun sendDraft(draftId: String): Boolean = withContext(Dispatchers.IO) {
        runCatching {
            val sent = service.users().drafts().send("me", com.google.api.services.gmail.model.Draft().setId(draftId)).execute()
            val messageId = sent.id ?: return@runCatching false
            val message = service.users().messages().get("me", messageId).setFormat("minimal").execute()
            message.labelIds?.contains("SENT") == true
        }.getOrDefault(false)
    }

    /**
     * List recent inbox messages tagged with Gmail's own category labels
     * (Primary/Social/Promotions/Updates/Forums) and flag which ones carry a
     * List-Unsubscribe header, so the caller can offer to unsubscribe.
     */
    suspend fun triage(maxResults: Long = 20): List<EmailSummary> = withContext(Dispatchers.IO) {
        try {
            val response = service.users().messages().list("me")
                .setQ("in:inbox")
                .setMaxResults(maxResults)
                .execute()
            response.messages?.mapNotNull { ref ->
                runCatching {
                    val msg = service.users().messages().get("me", ref.id)
                        .setFormat("metadata")
                        .setMetadataHeaders(listOf("Subject", "From", "Date", "List-Unsubscribe"))
                        .execute()
                    val headers = msg.payload?.headers?.associateBy { it.name.lowercase() }
                    EmailSummary(
                        id = msg.id,
                        threadId = msg.threadId,
                        subject = headers?.get("subject")?.value ?: "(no subject)",
                        from = headers?.get("from")?.value ?: "",
                        snippet = msg.snippet ?: "",
                        timestamp = msg.internalDate ?: 0L,
                        unread = msg.labelIds?.contains("UNREAD") == true,
                        category = categorize(msg.labelIds),
                        hasListUnsubscribe = !headers?.get("list-unsubscribe")?.value.isNullOrBlank()
                    )
                }.getOrNull()
            } ?: emptyList()
        } catch (e: UserRecoverableAuthIOException) {
            throw IllegalStateException(authErrorMessage())
        }
    }

    /**
     * Fetches inbox bodies for the quarantined reader lane. Callers must not
     * persist or send [EmailForReader.rawContent] to the actor lane.
     */
    suspend fun triageForReader(maxResults: Long = 20): List<EmailForReader> = withContext(Dispatchers.IO) {
        try {
            val response = service.users().messages().list("me")
                .setQ("in:inbox")
                .setMaxResults(maxResults)
                .execute()
            response.messages?.mapNotNull { ref ->
                runCatching {
                    val msg = service.users().messages().get("me", ref.id)
                        .setFormat("full")
                        .execute()
                    val headers = msg.payload?.headers?.associateBy { it.name.lowercase() }
                    val summary = EmailSummary(
                        id = msg.id,
                        threadId = msg.threadId,
                        subject = headers?.get("subject")?.value ?: "(no subject)",
                        from = headers?.get("from")?.value ?: "",
                        snippet = msg.snippet ?: "",
                        timestamp = msg.internalDate ?: 0L,
                        unread = msg.labelIds?.contains("UNREAD") == true,
                        category = categorize(msg.labelIds),
                        hasListUnsubscribe = !headers?.get("list-unsubscribe")?.value.isNullOrBlank()
                    )
                    val body = extractReadableText(msg.payload).take(MAX_READER_BODY_CHARS)
                    EmailForReader(
                        summary = summary,
                        rawContent = "From: ${summary.from}\nSubject: ${summary.subject}\n\n$body"
                    )
                }.getOrNull()
            } ?: emptyList()
        } catch (e: UserRecoverableAuthIOException) {
            throw IllegalStateException(authErrorMessage())
        }
    }

    /**
     * Unsubscribe from the mailing list that sent [messageId], using its
     * List-Unsubscribe header. Prefers the RFC 8058 one-click HTTP POST when
     * advertised (List-Unsubscribe-Post: List-Unsubscribe=One-Click),
     * otherwise falls back to a plain GET on an https: target, or sending a
     * blank unsubscribe email to a mailto: target. Returns whether the
     * request itself succeeded (the mailing list's own processing time is
     * outside what this can verify).
     */
    suspend fun unsubscribe(messageId: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val msg = service.users().messages().get("me", messageId)
                .setFormat("metadata")
                .setMetadataHeaders(listOf("List-Unsubscribe", "List-Unsubscribe-Post"))
                .execute()
            val headers = msg.payload?.headers?.associateBy { it.name.lowercase() }
            val listUnsubscribe = headers?.get("list-unsubscribe")?.value
                ?: throw IllegalStateException("This message has no List-Unsubscribe header; automatic unsubscribe isn't supported for it.")

            val httpsUrl = Regex("<(https?://[^>]+)>").find(listUnsubscribe)?.groupValues?.get(1)
            val mailto = Regex("<mailto:([^>]+)>").find(listUnsubscribe)?.groupValues?.get(1)

            when {
                httpsUrl != null -> postOneClickUnsubscribe(httpsUrl)
                mailto != null -> sendUnsubscribeEmail(mailto)
                else -> false
            }
        } catch (e: UserRecoverableAuthIOException) {
            throw IllegalStateException(authErrorMessage())
        }
    }

    private fun categorize(labelIds: List<String>?): EmailCategory {
        if (labelIds == null) return EmailCategory.OTHER
        return when {
            labelIds.contains("CATEGORY_PROMOTIONS") -> EmailCategory.PROMOTIONS
            labelIds.contains("CATEGORY_SOCIAL") -> EmailCategory.SOCIAL
            labelIds.contains("CATEGORY_UPDATES") -> EmailCategory.UPDATES
            labelIds.contains("CATEGORY_FORUMS") -> EmailCategory.FORUMS
            labelIds.contains("CATEGORY_PERSONAL") -> EmailCategory.PRIMARY
            else -> EmailCategory.OTHER
        }
    }

    private fun postOneClickUnsubscribe(url: String): Boolean = runCatching {
        val client = OkHttpClient()
        val body = "List-Unsubscribe=One-Click".toRequestBody("text/plain".toMediaType())
        val request = Request.Builder().url(url).post(body).build()
        client.newCall(request).execute().use { it.isSuccessful }
    }.getOrDefault(false)

    private fun sendUnsubscribeEmail(mailtoTarget: String): Boolean = runCatching {
        val addressPart = mailtoTarget.substringBefore("?")
        val query = mailtoTarget.substringAfter("?", "")
        val params = query.split("&").mapNotNull { pair ->
            val idx = pair.indexOf("=")
            if (idx < 0) null else pair.substring(0, idx) to java.net.URLDecoder.decode(pair.substring(idx + 1), "UTF-8")
        }.toMap()
        val subject = params["subject"] ?: "Unsubscribe"
        val body = params["body"] ?: "Please unsubscribe me from this mailing list."

        val props = Properties()
        val session = Session.getDefaultInstance(props, null)
        val email = MimeMessage(session).apply {
            setFrom(InternetAddress(accountEmail))
            addRecipient(javax.mail.Message.RecipientType.TO, InternetAddress(addressPart))
            setSubject(subject)
            setText(body)
        }
        val baos = java.io.ByteArrayOutputStream()
        email.writeTo(baos)
        val raw = Base64.encodeToString(baos.toByteArray(), Base64.URL_SAFE or Base64.NO_WRAP)
        service.users().messages().send("me", Message().setRaw(raw)).execute()
        true
    }.getOrDefault(false)

    private fun authErrorMessage(): String =
        "Gmail access needs to be granted for $accountEmail. Reconnect the Gmail account in Settings and approve the permission prompt."

    private fun extractReadableText(part: MessagePart?): String {
        if (part == null) return ""
        val mimeType = part.mimeType.orEmpty().lowercase()
        if (mimeType.startsWith("text/plain")) return decodeBody(part)
        val children = part.parts.orEmpty()
        val plainChildren = children.map { child -> extractReadableText(child) }.filter { it.isNotBlank() }
        if (plainChildren.isNotEmpty()) return plainChildren.joinToString("\n")
        return if (mimeType.startsWith("text/html")) decodeBody(part) else ""
    }

    private fun decodeBody(part: MessagePart): String = runCatching {
        val data = part.body?.data ?: return@runCatching ""
        String(Base64.decode(data, Base64.URL_SAFE or Base64.NO_WRAP), Charsets.UTF_8)
    }.getOrDefault("")

    private fun parseAddress(headerValue: String): String? = runCatching {
        InternetAddress.parse(headerValue).firstOrNull()?.address
    }.getOrNull()

    private companion object {
        const val MAX_READER_BODY_CHARS = 12_000
    }
}
