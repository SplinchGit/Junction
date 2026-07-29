package com.splinch.junction.chat.voice

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.util.Log
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * Neural text-to-speech via Azure AI Speech, used in place of Android's
 * built-in `TextToSpeech` when the owner has configured a key. The on-device
 * engine stays as the fallback (see [LocalVoiceSession]) so voice never depends
 * on the network being up or a key being set.
 *
 * Only the *speaking* half is replaced. Android's on-device recognizer is
 * accurate and free, so transcription stays local -- that also means no audio
 * of the owner's voice ever leaves the device, only the assistant's reply text.
 *
 * The key is read from [com.splinch.junction.settings.KeyStorage] like every
 * other provider credential, and travels only to Azure's endpoint.
 */
class AzureNeuralVoice(
    private val context: Context,
    private val apiKey: String,
    private val region: String = DEFAULT_REGION,
    private val voice: String = DEFAULT_VOICE
) {

    private val client = OkHttpClient()
    private var player: MediaPlayer? = null

    /** True when there's a key to authenticate with; callers fall back to on-device TTS otherwise. */
    val isConfigured: Boolean get() = apiKey.isNotBlank()

    /**
     * Synthesizes [text] and plays it. Suspends until playback has been
     * started, not until it finishes, so a caller can still barge in via [stop].
     * Returns false when synthesis failed and the caller should fall back to the
     * on-device engine rather than silently saying nothing.
     */
    suspend fun speak(text: String): Boolean {
        if (text.isBlank() || !isConfigured) return false

        val audio = withContext(Dispatchers.IO) { synthesize(text) } ?: return false
        return withContext(Dispatchers.Main) { play(audio) }
    }

    fun stop() {
        runCatching {
            player?.stop()
            player?.release()
        }
        player = null
    }

    private fun synthesize(text: String): File? {
        val request = Request.Builder()
            .url("https://$region.tts.speech.microsoft.com/cognitiveservices/v1")
            .post(buildSsml(text).toRequestBody("application/ssml+xml".toMediaType()))
            .addHeader("Ocp-Apim-Subscription-Key", apiKey)
            // MP3 rather than raw PCM: ~10x smaller over a mobile connection,
            // and MediaPlayer decodes it natively.
            .addHeader("X-Microsoft-OutputFormat", "audio-24khz-48kbitrate-mono-mp3")
            .addHeader("User-Agent", "Junction")
            .build()

        return runCatching {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    Log.w(TAG, "Azure TTS failed: HTTP ${response.code}")
                    return null
                }
                val bytes = response.body?.bytes() ?: return null
                // Cached to a file because MediaPlayer can't play from a byte
                // array without a custom MediaDataSource; overwritten each turn
                // so nothing accumulates.
                File(context.cacheDir, CACHE_FILE).apply { writeBytes(bytes) }
            }
        }.onFailure { Log.w(TAG, "Azure TTS request failed", it) }.getOrNull()
    }

    private fun play(audio: File): Boolean {
        stop()
        return runCatching {
            player = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANT)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                setDataSource(audio.absolutePath)
                setOnCompletionListener { stop() }
                prepare()
                start()
            }
            true
        }.onFailure { Log.w(TAG, "Playback failed", it) }.getOrDefault(false)
    }

    /**
     * Wraps the reply in SSML. The text is XML-escaped because a reply can
     * contain `&` or `<` from code or URLs, which would otherwise make the
     * whole request invalid XML and fail the turn.
     */
    private fun buildSsml(text: String): String {
        val escaped = text
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
        return """
            <speak version='1.0' xml:lang='en-GB'>
              <voice xml:lang='en-GB' name='$voice'>$escaped</voice>
            </speak>
        """.trimIndent()
    }

    companion object {
        private const val TAG = "AzureNeuralVoice"
        private const val CACHE_FILE = "azure_tts.mp3"

        /** Matches the region of the junction-speech resource. */
        const val DEFAULT_REGION = "uksouth"

        /** A natural-sounding British neural voice; overridable in Settings. */
        const val DEFAULT_VOICE = "en-GB-OllieMultilingualNeural"

        /** Provider id this key is stored under in KeyStorage. */
        const val KEY_ID = "azure_speech"
    }
}
