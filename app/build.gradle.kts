import com.android.build.api.dsl.ApplicationExtension
import org.gradle.api.GradleException
import org.gradle.kotlin.dsl.configure
import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
    id("com.google.gms.google-services")
    id("com.google.firebase.crashlytics")
}

private fun loadLocalProperties(projectRoot: java.io.File): Properties {
    val props = Properties()
    val file = java.io.File(projectRoot, "local.properties")
    if (file.exists()) {
        file.inputStream().use { props.load(it) }
    }
    return props
}

private fun requireProp(
    name: String,
    projectProps: org.gradle.api.Project,
    localProps: Properties
): String {
    val v = projectProps.findProperty(name)?.toString()
        ?: localProps.getProperty(name)
        ?: System.getenv(name)

    if (v.isNullOrBlank()) {
        throw GradleException(
            "Missing required config '$name'.\n" +
                    "Add it to local.properties OR set an env var.\n" +
                    "Example (local.properties):\n" +
                    "$name=your_value_here"
        )
    }
    return v
}

private fun optionalProp(
    name: String,
    projectProps: org.gradle.api.Project,
    localProps: Properties,
    defaultValue: String
): String {
    return projectProps.findProperty(name)?.toString()
        ?: localProps.getProperty(name)
        ?: System.getenv(name)
        ?: defaultValue
}

configure<ApplicationExtension> {
    namespace = "com.splinch.junction"
    compileSdk = 36

    val localProps = loadLocalProperties(rootProject.projectDir)

    defaultConfig {
        applicationId = "com.splinch.junction"
        minSdk = 26
        targetSdk = 36

        val versionCodeValue = 2
        versionCode = versionCodeValue
        versionName = "0.5.0"

        buildConfigField("int", "JUNCTION_VERSION_CODE", versionCodeValue.toString())

        // Backend config (real default for emulator loopback).
        buildConfigField("String", "JUNCTION_API_BASE_URL", "\"http://10.0.2.2:8787\"")
        buildConfigField("boolean", "JUNCTION_USE_HTTP_BACKEND", "false")

        val chatModel = optionalProp(
            name = "JUNCTION_CHAT_MODEL",
            projectProps = project,
            localProps = localProps,
            defaultValue = "gpt-5.2"
        )
        buildConfigField("String", "JUNCTION_CHAT_MODEL", "\"$chatModel\"")

        // Web OAuth Client ID (ends with .apps.googleusercontent.com).
        // Leave blank for local builds; the app also supports a runtime override.
        val webClientId = optionalProp(
            name = "JUNCTION_WEB_CLIENT_ID",
            projectProps = project,
            localProps = localProps,
            defaultValue = ""
        )
        buildConfigField("String", "JUNCTION_WEB_CLIENT_ID", "\"$webClientId\"")

        // Optional endpoints (you can require these too if you want)
        val realtimeEndpoint = optionalProp(
            name = "JUNCTION_REALTIME_ENDPOINT",
            projectProps = project,
            localProps = localProps,
            defaultValue = ""
        )
        buildConfigField("String", "JUNCTION_REALTIME_ENDPOINT", "\"$realtimeEndpoint\"")

        val realtimeClientSecretEndpoint = optionalProp(
            name = "JUNCTION_REALTIME_CLIENT_SECRET_ENDPOINT",
            projectProps = project,
            localProps = localProps,
            defaultValue = ""
        )
        buildConfigField(
            "String",
            "JUNCTION_REALTIME_CLIENT_SECRET_ENDPOINT",
            "\"$realtimeClientSecretEndpoint\""
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

    // IMPORTANT:
    // Keep KSP source wiring automatic (avoid kotlin/sourceSets tweaks here).
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.activity:activity-compose:1.12.3")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.10.2")

    implementation("com.squareup.okhttp3:okhttp:5.3.2")
    implementation("androidx.work:work-runtime-ktx:2.11.1")
    implementation("androidx.datastore:datastore-preferences:1.2.0")

    implementation("androidx.room:room-runtime:2.8.4")
    implementation("androidx.room:room-ktx:2.8.4")
    ksp("androidx.room:room-compiler:2.8.4")

    // Firebase (BOM-managed versions)
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

    implementation("com.infobip:google-webrtc:1.0.45036")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
