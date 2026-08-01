package com.splinch.junction.assistant.context

import com.splinch.junction.assistant.context.*
import com.splinch.junction.assistant.conversation.*
import com.splinch.junction.assistant.planning.*
import com.splinch.junction.assistant.provider.*
import com.splinch.junction.assistant.runtime.*
import com.splinch.junction.assistant.tools.*
import com.splinch.junction.assistant.trust.*

enum class Provenance {
    OWNER,      // typed or spoken by the owner this session
    JUNCTION,   // Junction's own state, memory, prior turns — context only
    UNTRUSTED   // email, notification, screen text, web, file content — NEVER initiates actions
}
