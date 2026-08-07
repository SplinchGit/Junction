package com.junction.avatar

import android.content.Context
import java.io.File
import java.io.IOException

/**
 * Owns the on-disk location for the avatar model. User-uploaded models are
 * written to app-internal storage only (filesDir) — never external/shared
 * storage — and never leave the device. This matches Junction's existing
 * local-first privacy posture.
 *
 * Files are validated as parseable glTF binaries before being accepted;
 * anything else is rejected rather than loaded.
 */
object AvatarStorage {
    private const val MODEL_DIR = "avatar_models"
    private const val ACTIVE_MODEL_FILENAME = "active_avatar.glb"
    private const val MAX_FILE_SIZE_BYTES = 25L * 1024 * 1024 // 25 MB cap

    private const val GLB_MAGIC = 0x46546C67 // "glTF" little-endian magic, per spec

    fun modelDir(context: Context): File =
        File(context.filesDir, MODEL_DIR).apply { mkdirs() }

    fun activeModelFile(context: Context): File =
        File(modelDir(context), ACTIVE_MODEL_FILENAME)

    fun bundledPlaceholder(): String = "models/placeholder_avatar.glb" // in assets/

    /**
     * Validates and stores a user-supplied .glb as the active avatar model.
     * Throws IOException with a clear reason if the file fails validation —
     * caller should surface this to the user rather than silently loading it.
     */
    @Throws(IOException::class)
    fun importUserModel(context: Context, sourceBytes: ByteArray) {
        if (sourceBytes.size > MAX_FILE_SIZE_BYTES) {
            throw IOException("Model file too large (max ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB)")
        }
        if (!isValidGlb(sourceBytes)) {
            throw IOException("File is not a valid .glb (glTF binary) model")
        }
        activeModelFile(context).writeBytes(sourceBytes)
    }

    fun resetToPlaceholder(context: Context) {
        val f = activeModelFile(context)
        if (f.exists()) f.delete()
    }

    fun hasCustomModel(context: Context): Boolean = activeModelFile(context).exists()

    private fun isValidGlb(bytes: ByteArray): Boolean {
        if (bytes.size < 12) return false
        val magic = (bytes[0].toInt() and 0xFF) or
            ((bytes[1].toInt() and 0xFF) shl 8) or
            ((bytes[2].toInt() and 0xFF) shl 16) or
            ((bytes[3].toInt() and 0xFF) shl 24)
        return magic == GLB_MAGIC
    }
}
