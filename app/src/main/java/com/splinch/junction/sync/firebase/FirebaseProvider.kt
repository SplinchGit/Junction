package com.splinch.junction.sync.firebase

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore

object FirebaseProvider {
    @Volatile
    private var initialized = false

    fun initialize(context: Context): Boolean {
        if (initialized) return true
        val app = FirebaseApp.initializeApp(context)
        initialized = app != null
        return initialized
    }

    fun isInitialized(): Boolean = initialized

    fun authOrNull(): FirebaseAuth? = if (initialized) FirebaseAuth.getInstance() else null

    fun firestoreOrNull(): FirebaseFirestore? = if (initialized) FirebaseFirestore.getInstance() else null
}
