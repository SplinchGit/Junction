import com.android.build.api.dsl.ApplicationExtension
import org.gradle.kotlin.dsl.configure
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
    id("com.google.gms.google-services")
    id("com.google.firebase.crashlytics")
}

// Apply Google Services plugin only when google-services.json is present
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
} else {
    logger.lifecycle("google-services.json not found; skipping com.google.gms.google-services plugin")
}

configure<ApplicationExtension> {
    namespace = "com.splinch.junction"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.splinch.junction"
        minSdk = 26
        targetSdk = 36
        val versionCodeValue = 1
        versionCode = versionCodeValue
        versionName = "0.1.0"
        buildConfigField("int", "JUNCTION_VERSION_CODE", versionCodeValue.toString())
        buildConfigField("String", "JUNCTION_API_BASE_URL", "\"http://10.0.2.2:8787\"")
        buildConfigField("boolean", "JUNCTION_USE_HTTP_BACKEND", "false")
        val webClientId = project.findProperty("JUNCTION_WEB_CLIENT_ID")?.toString() ?: ""
        buildConfigField("String", "JUNCTION_WEB_CLIENT_ID", "\"$webClientId\"")
        val realtimeEndpoint = project.findProperty("JUNCTION_REALTIME_ENDPOINT")?.toString() ?: ""
        buildConfigField("String", "JUNCTION_REALTIME_ENDPOINT", "\"$realtimeEndpoint\"")
        val realtimeClientSecretEndpoint =
            project.findProperty("JUNCTION_REALTIME_CLIENT_SECRET_ENDPOINT")?.toString() ?: ""
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
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.4")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("androidx.activity:activity-compose:1.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:5.3.2")
    implementation("androidx.work:work-runtime-ktx:2.11.0")
    implementation("androidx.datastore:datastore-preferences:1.2.0")
    implementation("androidx.room:room-runtime:2.7.2")
    implementation("androidx.room:room-ktx:2.7.2")
    implementation("com.google.firebase:firebase-crashlytics:20.0.4")
    ksp("androidx.room:room-compiler:2.7.2")

    // Firebase dependencies
    // Pin firebase bom to a version compatible with Kotlin 1.9
    implementation(platform("com.google.firebase:firebase-bom:34.7.0"))
    implementation("com.google.firebase:firebase-auth")
    implementation("com.google.firebase:firebase-firestore")
    implementation("androidx.credentials:credentials:1.5.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.5.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")

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
