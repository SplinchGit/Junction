package com.splinch.junction.feature.migration

import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.nio.file.Files
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/** Portable, owner-selected export. Never includes preferences, credentials or conversations. */
object MusicArchive {
    private val roots = setOf("music-projects", "music-assets")
    private const val PROJECT = "music-projects/current.junction-music.json"
    private const val MAX_BYTES = 512L * 1024 * 1024
    private const val MAX_FILES = 4096

    private fun validate(name: String) {
        val parts = name.split('/')
        require(parts.size >= 2 && parts.first() in roots && '\\' !in name && ':' !in name &&
            parts.none { it.isEmpty() || it == "." || it == ".." }) { "Not a music project archive" }
    }

    fun export(filesDir: File, output: OutputStream) {
        require(File(filesDir, PROJECT).isFile) { "No saved music project to export" }
        var total = 0L
        var count = 0
        ZipOutputStream(output).use { zip ->
            roots.forEach { root ->
                File(filesDir, root).walkTopDown().forEach { file ->
                    require(!Files.isSymbolicLink(file.toPath())) { "Symbolic links cannot be exported" }
                    if (file.isFile) {
                        val name = file.relativeTo(filesDir).invariantSeparatorsPath
                        validate(name)
                        require(++count <= MAX_FILES) { "Too many music files" }
                        zip.putNextEntry(ZipEntry(name))
                        file.inputStream().use { input ->
                            val buffer = ByteArray(8192)
                            while (true) {
                                val n = input.read(buffer); if (n < 0) break
                                total += n; require(total <= MAX_BYTES) { "Music archive exceeds 512 MiB" }
                                zip.write(buffer, 0, n)
                            }
                        }
                        zip.closeEntry()
                    }
                }
            }
        }
    }

    /** Imports only into an unused studio. Existing projects are never replaced. */
    fun importNew(filesDir: File, input: InputStream, maxBytes: Long = MAX_BYTES) {
        require(roots.none { File(filesDir, it).exists() }) { "This studio already has data. Export it before using a fresh installation to import." }
        val staging = Files.createTempDirectory(filesDir.toPath(), "music-import-").toFile()
        val installed = mutableListOf<File>()
        try {
            val seen = mutableSetOf<String>()
            var total = 0L
            ZipInputStream(input).use { zip ->
                while (true) {
                    val entry = zip.nextEntry ?: break
                    validate(entry.name)
                    require(!entry.isDirectory && seen.add(entry.name) && seen.size <= MAX_FILES) { "Invalid or duplicate music file" }
                    val target = File(staging, entry.name)
                    require(target.canonicalPath.startsWith(staging.canonicalPath + File.separator))
                    target.parentFile!!.mkdirs()
                    target.outputStream().use { output ->
                        val buffer = ByteArray(8192)
                        while (true) {
                            val n = zip.read(buffer); if (n < 0) break
                            total += n; require(total <= maxBytes) { "Music archive exceeds size limit" }
                            output.write(buffer, 0, n)
                        }
                    }
                    zip.closeEntry()
                }
            }
            require(File(staging, PROJECT).isFile) { "Archive contains no project" }
            roots.forEach { name ->
                val source = File(staging, name)
                if (source.exists()) {
                    val destination = File(filesDir, name)
                    Files.move(source.toPath(), destination.toPath())
                    installed.add(destination)
                }
            }
        } catch (error: Exception) {
            installed.forEach { it.deleteRecursively() }
            throw error
        } finally {
            staging.deleteRecursively()
        }
    }
}
