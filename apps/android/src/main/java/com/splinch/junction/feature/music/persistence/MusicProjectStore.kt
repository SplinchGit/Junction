package com.splinch.junction.feature.music.persistence

import android.content.Context
import android.util.AtomicFile
import com.splinch.junction.feature.music.model.MusicProject
import java.io.File

class MusicProjectStore(context: Context) {
    private val projectDirectory = File(context.filesDir, "music-projects")
    private val projectFile = AtomicFile(File(projectDirectory, "current.junction-music.json"))

    fun loadOrCreate(): MusicProject {
        if (!projectFile.baseFile.exists()) return MusicProject.starter()
        return runCatching {
            projectFile.openRead().bufferedReader().use { reader ->
                MusicProjectCodec.decode(reader.readText())
            }
        }.getOrElse { MusicProject.starter() }
    }

    @Synchronized
    fun save(project: MusicProject) {
        projectDirectory.mkdirs()
        val stream = projectFile.startWrite()
        try {
            stream.write(MusicProjectCodec.encode(project).toByteArray(Charsets.UTF_8))
            stream.flush()
            projectFile.finishWrite(stream)
        } catch (error: Throwable) {
            projectFile.failWrite(stream)
            throw error
        }
    }
}
