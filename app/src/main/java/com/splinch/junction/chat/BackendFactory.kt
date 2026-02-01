package com.splinch.junction.chat

import com.splinch.junction.BuildConfig

object BackendFactory {
    fun create(): ChatBackend {
        return if (BuildConfig.JUNCTION_USE_HTTP_BACKEND && BuildConfig.JUNCTION_API_BASE_URL.isNotBlank()) {
            HttpBackend(BuildConfig.JUNCTION_API_BASE_URL)
        } else {
            StubBackend()
        }
    }
}
