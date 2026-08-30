package com.splinch.junction.feature.music.playback

import com.splinch.junction.feature.music.model.MusicProject
import java.io.File

interface MusicPlaybackEngine {
    fun playArrangement(project: MusicProject, assetDirectory: File, onPosition: (Double) -> Unit, onComplete: () -> Unit)
    fun stop()
}
