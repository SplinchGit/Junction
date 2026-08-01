package com.splinch.junction.data.sync.firebase

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore

object FirebaseProvider {
    @Volatile
    private var initialized = false
    @Volatile
    private var appContext: Context? = null

    fun initialize(context: Context): Boolean {
        if (initialized) return true
        val safeContext = context.applicationContext
        appContext = safeContext
        val app = FirebaseApp.initializeApp(safeContext)
        initialized = app != null
        return initialized
    }

    fun isInitialized(): Boolean = initialized

    /** Firebase clients are unavailable until an explicit owner opt-in initializes the SDK. */
    fun authOrNull(): FirebaseAuth? {
        return if (initialized) FirebaseAuth.getInstance() else null
    }

    fun firestoreOrNull(): FirebaseFirestore? {
        return if (initialized) FirebaseFirestore.getInstance() else null
    }
}
