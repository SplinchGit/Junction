/*
 * IMPORTANT — Kotlin / AGP
 *
 * This module uses Android Gradle Plugin's built-in Kotlin support,
 * matching the :app module.
 *
 * DO NOT add:
 *
 *     id("org.jetbrains.kotlin.android")
 *
 * DO NOT add a:
 *
 *     kotlin { ... }
 *
 * block.
 *
 * AGP already registers the Kotlin extension. Applying the standalone
 * Kotlin Android plugin as well causes Gradle configuration to fail with:
 *
 *     Cannot add extension with name 'kotlin',
 *     as there is an extension already registered with that name.
 */

plugins {
    id("com.android.library")
    // Compose compiler plugin for Kotlin 2.x. This is a Kotlin compiler
    // plugin, NOT the Kotlin Android plugin, so it does not register a
    // duplicate 'kotlin' extension.
    id("org.jetbrains.kotlin.plugin.compose")
}

// Safety net: if anything (IDE auto-fix, parent build script, convention
// plugin) tries to apply the standalone Kotlin Android plugin to this module,
// fail fast with a clear message instead of Gradle's cryptic duplicate
// extension error.
pluginManager.withPlugin("org.jetbrains.kotlin.android") {
    throw GradleException(
        "The 'org.jetbrains.kotlin.android' plugin must not be applied to :avatar. " +
        "AGP 9+ provides built-in Kotlin support; applying the standalone plugin " +
        "causes 'Cannot add extension with name 'kotlin''."
    )
}

android {
    namespace = "com.junction.avatar"
    compileSdk = 36

    defaultConfig {
        // Filament supports API 19+, but Junction targets API 26+.
        minSdk = 26
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // GLB files are already compressed binary assets.
    androidResources {
        noCompress += "glb"
    }
}

dependencies {
    // Filament rendering + glTF/GLB loading.
    implementation("com.google.android.filament:filament-android:1.74.0")
    implementation("com.google.android.filament:gltfio-android:1.74.0")
    implementation("com.google.android.filament:filament-utils-android:1.74.0")

    // Keep Compose versions aligned with :app.
    implementation(platform("androidx.compose:compose-bom:2025.08.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")

    implementation("androidx.core:core-ktx:1.17.0")
}
