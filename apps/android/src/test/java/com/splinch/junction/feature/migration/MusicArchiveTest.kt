package com.splinch.junction.feature.migration

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.file.Files
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.*
import org.junit.Test

class MusicArchiveTest {
    private fun temporary(block: (File) -> Unit) {
        val root = Files.createTempDirectory("music-archive-test").toFile()
        try { block(root) } finally { root.deleteRecursively() }
    }
    private fun zip(vararg entries: Pair<String, String>): ByteArray = ByteArrayOutputStream().apply {
        ZipOutputStream(this).use { zip -> entries.forEach { (name, value) ->
            zip.putNextEntry(ZipEntry(name)); zip.write(value.toByteArray()); zip.closeEntry()
        } }
    }.toByteArray()
    @Test fun `round trip preserves project and audio without unrelated private files`() = temporary { root ->
        val source = File(root, "source").apply { mkdirs() }
        File(source, "music-projects").mkdirs(); File(source, "music-assets").mkdirs()
        File(source, "music-projects/current.junction-music.json").writeText("project")
        File(source, "music-assets/take.wav").writeText("audio")
        File(source, "private-token").writeText("must not export")
        val output = ByteArrayOutputStream()
        MusicArchive.export(source, output)
        val target = File(root, "target").apply { mkdirs() }
        MusicArchive.importNew(target, ByteArrayInputStream(output.toByteArray()))
        assertEquals("project", File(target, "music-projects/current.junction-music.json").readText())
        assertEquals("audio", File(target, "music-assets/take.wav").readText())
        assertFalse(File(target, "private-token").exists())
    }
    @Test fun `rejects traversal and unrelated paths without installing partial data`() = temporary { root ->
        listOf("../escape", "music-assets/../escape", "secrets/key", "/music-assets/x", "music-assets\\x").forEach { bad ->
            assertThrows(IllegalArgumentException::class.java) {
                MusicArchive.importNew(root, ByteArrayInputStream(zip("music-projects/current.junction-music.json" to "ok", bad to "bad")))
            }
            assertFalse(File(root, "music-projects").exists())
        }
    }
    @Test fun `refuses to overwrite an existing project`() = temporary { root ->
        File(root, "music-projects").mkdirs()
        File(root, "music-projects/current.junction-music.json").writeText("keep")
        assertThrows(IllegalArgumentException::class.java) {
            MusicArchive.importNew(root, ByteArrayInputStream(zip("music-projects/current.junction-music.json" to "replace")))
        }
        assertEquals("keep", File(root, "music-projects/current.junction-music.json").readText())
    }
    @Test fun `rejects oversized archives and archives without project`() = temporary { root ->
        assertThrows(IllegalArgumentException::class.java) {
            MusicArchive.importNew(root, ByteArrayInputStream(zip("music-projects/current.junction-music.json" to "too large")), maxBytes = 4)
        }
        assertThrows(IllegalArgumentException::class.java) {
            MusicArchive.importNew(root, ByteArrayInputStream(zip("music-assets/take.wav" to "audio")))
        }
        assertTrue(root.listFiles().orEmpty().isEmpty())
    }
}
