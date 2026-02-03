/*
IMPORTANT — Kotlin & AGP

This module uses Android Gradle Plugin built-in Kotlin (AGP 8+).

DO NOT apply:
- org.jetbrains.kotlin.android
- kotlin { }
- kotlin.sourceSets { }

AGP already provides the Kotlin extension.
*/

import com.android.build.api.dsl.ApplicationExtension
import java.util.Properties
import org.gradle.kotlin.dsl.configure

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
    id("com.google.gms.google-services")
    id("com.google.firebase.crashlytics")
}

/* ---------- helpers (Gradle-safe Kotlin ONLY) ---------- */

fun loadLocalProps(root: File): Properties {
    val props = Properties()
    val f = File(root, "local.properties")
    if (f.exists()) {
        f.inputStream().use { props.load(it) }
    }
    return props
}

fun Project.requireProp(name: String, localProps: Properties): String {
    return (
            findProperty(name)?.toString()
                ?: localProps.getProperty(name)
                ?: System.getenv(name)
            )?.takeIf { it.isNotBlank() }
        ?: error("Missing required property: $name (local.properties or env var)")
}

/* ---------- Android config ---------- */

configure<ApplicationExtension> {

    namespace = "com.splinch.junction"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.splinch.junction"
        minSdk = 26
        targetSdk = 36

        val versionCodeValue = 2
        versionCode = versionCodeValue
        versionName = "0.5.0"

        buildConfigField(
            "int",
            "JUNCTION_VERSION_CODE",
            versionCodeValue.toString()
        )

        buildConfigField(
            "String",
            "JUNCTION_API_BASE_URL",
            "\"http://10.0.2.2:8787\""
        )

        buildConfigField(
            "boolean",
            "JUNCTION_USE_HTTP_BACKEND",
            "false"
        )

        val localProps = loadLocalProps(rootProject.projectDir)

        val chatModel =
            findProperty("JUNCTION_CHAT_MODEL")?.toString()
                ?: localProps.getProperty("JUNCTION_CHAT_MODEL")
                ?: System.getenv("JUNCTION_CHAT_MODEL")
                ?: "gpt-5.2"

        buildConfigField(
            "String",
            "JUNCTION_CHAT_MODEL",
            "\"$chatModel\""
        )

        val webClientId = project.requireProp(
            "JUNCTION_WEB_CLIENT_ID",
            localProps
        )

        buildConfigField(
            "String",
            "JUNCTION_WEB_CLIENT_ID",
            "\"$webClientId\""
        )

        val realtimeEndpoint =
            findProperty("JUNCTION_REALTIME_ENDPOINT")?.toString()
                ?: localProps.getProperty("JUNCTION_REALTIME_ENDPOINT")
                ?: System.getenv("JUNCTION_REALTIME_ENDPOINT")
                ?: ""

        buildConfigField(
            "String",
            "JUNCTION_REALTIME_ENDPOINT",
            "\"$realtimeEndpoint\""
        )

        val clientSecretEndpoint =
            findProperty("JUNCTION_REALTIME_CLIENT_SECRET_ENDPOINT")?.toString()
                ?: localProps.getProperty("JUNCTION_REALTIME_CLIENT_SECRET_ENDPOINT")
                ?: System.getenv("JUNCTION_REALTIME_CLIENT_SECRET_ENDPOINT")
                ?: ""

        buildConfigField(
            "String",
            "JUNCTION_REALTIME_CLIENT_SECRET_ENDPOINT",
            "\"$clientSecretEndpoint\""
        )
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

/* ---------- deps ---------- */

dependencies {

    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity-compose:1.12.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.10.2")

    implementation("androidx.work:work-runtime-ktx:2.11.1")
    implementation("androidx.datastore:datastore-preferences:1.2.0")

    implementation("androidx.room:room-runtime:2.8.4")
    implementation("androidx.room:room-ktx:2.8.4")
    ksp("androidx.room:room-compiler:2.8.4")

    implementation(platform("com.google.firebase:firebase-bom:34.8.0"))
    implementation("com.google.firebase:firebase-auth")
    implementation("com.google.firebase:firebase-firestore")
    implementation("com.google.firebase:firebase-crashlytics")

    implementation("androidx.credentials:credentials:1.5.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.5.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.2.0")

    val composeBom = platform("androidx.compose:compose-bom:2025.08.00")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material")
    implementation("androidx.compose.material:material-icons-extended")

    implementation("com.squareup.okhttp3:okhttp:5.3.2")
    implementation("com.infobip:google-webrtc:1.0.45036")

    debugImplementation("androidx.compose.ui:ui-tooling")
}
