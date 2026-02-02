package com.splinch.junction.chat

import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

class HttpBackend(
    private val baseUrl: String,
    private val authTokenProvider: (suspend () -> String?)? = null,
    private val httpClient: OkHttpClient = OkHttpClient()
) : ChatBackend {
    override suspend fun generateResponse(session: ChatSession, userMessage: ChatMessage): ChatMessage {
        return withContext(Dispatchers.IO) {
            val payload = buildPayload(session, userMessage)
            val body = payload.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
            val endpoint = baseUrl.trim().trimEnd('/')
            val url = if (endpoint.endsWith("/chat")) endpoint else "$endpoint/chat"
            val requestBuilder = Request.Builder()
                .url(url)
                .post(body)
            val token = authTokenProvider?.invoke()
            if (!token.isNullOrBlank()) {
                requestBuilder.addHeader("Authorization", "Bearer $token")
            }
            val request = requestBuilder.build()

            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw IOException("Backend error: ${response.code}")
                }
                val responseBody = response.body?.string().orEmpty()
                ChatMessage(
                    sender = Sender.ASSISTANT,
                    content = parseReply(responseBody)
                )
            }
        }
    }

    private fun buildPayload(session: ChatSession, userMessage: ChatMessage): JSONObject {
        val json = JSONObject()
        json.put("sessionId", session.sessionId)
        json.put("message", userMessage.content)
        val messagesArray = JSONArray()
        val history = session.messages.takeLast(20).let { list ->
            if (list.isNotEmpty() && list.last().id == userMessage.id) {
                list.dropLast(1)
            } else {
                list
            }
        }
        history.forEach { msg ->
            val obj = JSONObject()
            obj.put("role", msg.sender.name.lowercase())
            obj.put("content", msg.content)
            messagesArray.put(obj)
        }
        json.put("messages", messagesArray)
        return json
    }

    private fun parseReply(responseBody: String): String {
        return try {
            val json = JSONObject(responseBody)
            when {
                json.has("reply") -> json.getString("reply")
                json.has("content") -> json.getString("content")
                json.has("message") -> json.getString("message")
                else -> responseBody
            }
        } catch (e: Exception) {
            responseBody
        }
    }
}
