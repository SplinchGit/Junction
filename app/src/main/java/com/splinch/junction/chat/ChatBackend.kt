package com.splinch.junction.chat

import kotlinx.coroutines.delay

interface ChatBackend {
    suspend fun generateResponse(session: ChatSession, userMessage: ChatMessage): ChatMessage
}

class StubBackend : ChatBackend {
    override suspend fun generateResponse(
        session: ChatSession,
        userMessage: ChatMessage
    ): ChatMessage {
        delay(350)
        return ChatMessage(
            sender = Sender.ASSISTANT,
            content = "Got it. I can help triage that. What should happen next?"
        )
    }
}
