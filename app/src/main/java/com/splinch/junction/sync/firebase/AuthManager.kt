package com.splinch.junction.sync.firebase

import android.app.Activity
import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import com.splinch.junction.BuildConfig
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.tasks.await

class AuthManager(private val context: Context) {
    private val auth: FirebaseAuth = FirebaseProvider.auth
    private val _userFlow = MutableStateFlow(auth.currentUser)
    val userFlow: StateFlow<FirebaseUser?> = _userFlow.asStateFlow()

    private val authListener = FirebaseAuth.AuthStateListener { firebaseAuth ->
        _userFlow.value = firebaseAuth.currentUser
    }

    fun start() {
        auth.addAuthStateListener(authListener)
        _userFlow.value = auth.currentUser
    }

    fun stop() {
        auth.removeAuthStateListener(authListener)
    }

    suspend fun signInWithGoogle(activity: Activity): Result<Unit> {
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
        auth.signOut()
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
