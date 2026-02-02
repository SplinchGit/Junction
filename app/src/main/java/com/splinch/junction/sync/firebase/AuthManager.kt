package com.splinch.junction.sync.firebase

import android.app.Activity
import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import com.splinch.junction.BuildConfig
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.tasks.await

class AuthManager(private val context: Context) {
    private val _userFlow = MutableStateFlow<FirebaseUser?>(null)
    val userFlow: StateFlow<FirebaseUser?> = _userFlow.asStateFlow()

    private var authListener: com.google.firebase.auth.FirebaseAuth.AuthStateListener? = null

    fun start() {
        if (!FirebaseProvider.initialize(context)) {
            _userFlow.value = null
            return
        }
        val auth = FirebaseProvider.authOrNull() ?: return
        val listener = com.google.firebase.auth.FirebaseAuth.AuthStateListener { firebaseAuth ->
            _userFlow.value = firebaseAuth.currentUser
        }
        authListener = listener
        auth.addAuthStateListener(listener)
        _userFlow.value = auth.currentUser
    }

    fun stop() {
        val auth = FirebaseProvider.authOrNull()
        val listener = authListener
        if (auth != null && listener != null) {
            auth.removeAuthStateListener(listener)
        }
    }

    fun currentUser(): FirebaseUser? {
        return FirebaseProvider.authOrNull()?.currentUser
    }

    suspend fun signInWithGoogle(activity: Activity): Result<Unit> {
        if (!FirebaseProvider.initialize(context)) {
            return Result.failure(IllegalStateException("Firebase is not configured yet"))
        }
        val webClientId = BuildConfig.JUNCTION_WEB_CLIENT_ID
        if (webClientId.isBlank()) {
            return Result.failure(IllegalStateException("Missing JUNCTION_WEB_CLIENT_ID"))
        }

        return try {
            val credentialManager = CredentialManager.create(context)
            val googleIdOption = GetGoogleIdOption.Builder()
                .setFilterByAuthorizedAccounts(false)
                .setServerClientId(webClientId)
                .setAutoSelectEnabled(true)
                .build()

            val request = GetCredentialRequest.Builder()
                .addCredentialOption(googleIdOption)
                .build()

            val result = credentialManager.getCredential(activity, request)
            val token = extractIdToken(result)
                ?: return Result.failure(IllegalStateException("No Google ID token"))
            val auth = FirebaseProvider.authOrNull()
                ?: return Result.failure(IllegalStateException("FirebaseAuth unavailable"))
            val credential = GoogleAuthProvider.getCredential(token, null)
            auth.signInWithCredential(credential).await()
            Result.success(Unit)
        } catch (ex: GetCredentialException) {
            Result.failure(ex)
        } catch (ex: Exception) {
            Result.failure(ex)
        }
    }

    suspend fun signOut() {
        FirebaseProvider.authOrNull()?.signOut()
    }

    private fun extractIdToken(result: GetCredentialResponse): String? {
        return try {
            val credential = GoogleIdTokenCredential.createFrom(result.credential.data)
            credential.idToken
        } catch (_: Exception) {
            null
        }
    }
}
