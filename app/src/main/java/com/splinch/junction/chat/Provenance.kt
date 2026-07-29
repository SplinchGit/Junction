package com.splinch.junction.chat

enum class Provenance {
    OWNER,      // typed or spoken by the owner this session
    JUNCTION,   // Junction's own state, memory, prior turns — context only
    UNTRUSTED   // email, notification, screen text, web, file content — NEVER initiates actions
}
