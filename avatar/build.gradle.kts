/*
IMPORTANT — Kotlin & AGP

This module uses Android Gradle Plugin built-in Kotlin (AGP 8+), same as
:app. DO NOT apply org.jetbrains.kotlin.android or kotlin { } — AGP already
provides the Kotlin extension, and applying the plugin on top of it fails
with "Cannot add extension with name 'kotlin'".
*/
plugins {
    id("com.android.library")
    // AGP 8+ provides Kotlin support; do NOT apply kotlin.android plugin
    id("org.jetbrains.kotlin.plugin.compose")
}

// Explicitly prevent the Kotlin plugin from being applied by parent build scripts
pluginManager.withPlugin("org.jetbrains.kotlin.android") {
    throw GradleException("The 'org.jetbrains.kotlin.android' plugin must not be applied to :avatar; AGP 8+ already provides Kotlin support.")
}

android {
    namespace = "com.junction.avatar"
    compileSdk = 36

    defaultConfig {
        minSdk = 26 // Filament requires API 19+; 26 matches modern Junction baseline
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // .glb is a binary asset — make sure AAPT doesn't try to compress it further
    androidResources {
        noCompress += "glb"
    }
}

dependencies {
    // Filament: rendering engine + glTF loader (gltfio) + Ubershader for PBR materials
    implementation("com.google.android.filament:filament-android:1.74.0")
    implementation("com.google.android.filament:gltfio-android:1.74.0")
    implementation("com.google.android.filament:filament-utils-android:1.74.0")

    // Aligned to the same Compose BOM as :app so both modules resolve to
    // identical Compose artifact versions.
    implementation(platform("androidx.compose:compose-bom:2025.08.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.core:core-ktx:1.17.0")
}
