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
}

/*
Firebase is opt-in (spec 0.4): the app must build and run with no Google account
and no google-services.json. The Google plugins are therefore applied only when
that file is actually present, so a clean checkout builds without it.
*/
val googleServicesFile = file("google-services.json")
if (googleServicesFile.exists()) {
    apply(plugin = "com.google.gms.google-services")
    apply(plugin = "com.google.firebase.crashlytics")
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

/* ---------- Android config ---------- */

configure<ApplicationExtension> {

    namespace = "com.splinch.junction"
    compileSdk = 36

    val debugKeystore = file("debug.keystore")
    val localProps = loadLocalProps(rootProject.projectDir)
    val releaseStoreFile =
        findProperty("JUNCTION_RELEASE_STORE_FILE")?.toString()
            ?: localProps.getProperty("JUNCTION_RELEASE_STORE_FILE")
            ?: System.getenv("JUNCTION_RELEASE_STORE_FILE")
    val releaseStorePassword =
        findProperty("JUNCTION_RELEASE_STORE_PASSWORD")?.toString()
            ?: localProps.getProperty("JUNCTION_RELEASE_STORE_PASSWORD")
            ?: System.getenv("JUNCTION_RELEASE_STORE_PASSWORD")
    val releaseKeyAlias =
        findProperty("JUNCTION_RELEASE_KEY_ALIAS")?.toString()
            ?: localProps.getProperty("JUNCTION_RELEASE_KEY_ALIAS")
            ?: System.getenv("JUNCTION_RELEASE_KEY_ALIAS")
    val releaseKeyPassword =
        findProperty("JUNCTION_RELEASE_KEY_PASSWORD")?.toString()
            ?: localProps.getProperty("JUNCTION_RELEASE_KEY_PASSWORD")
            ?: System.getenv("JUNCTION_RELEASE_KEY_PASSWORD")

    signingConfigs {
        getByName("debug") {
            if (debugKeystore.exists()) {
                storeFile = debugKeystore
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
        create("release") {
            if (
                !releaseStoreFile.isNullOrBlank() &&
                !releaseStorePassword.isNullOrBlank() &&
                !releaseKeyAlias.isNullOrBlank() &&
                !releaseKeyPassword.isNullOrBlank()
            ) {
                storeFile = file(releaseStoreFile)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.getByName("release")
        }
    }

    defaultConfig {
        applicationId = "com.splinch.junction"
        minSdk = 26
        targetSdk = 36

        // CI passes its run number so every published build outranks the previous
        // one and installs over it. Local builds keep the checked-in baseline.
        val baselineVersionCode = 2
        val versionCodeValue =
            (
                findProperty("JUNCTION_VERSION_CODE")?.toString()
                    ?: localProps.getProperty("JUNCTION_VERSION_CODE")
                    ?: System.getenv("JUNCTION_VERSION_CODE")
                )?.toIntOrNull()
                ?.coerceAtLeast(baselineVersionCode)
                ?: baselineVersionCode
        versionCode = versionCodeValue
        versionName = "0.5.0"

        buildConfigField(
            "int",
            "JUNCTION_VERSION_CODE",
            versionCodeValue.toString()
        )

        val chatModel =
            findProperty("JUNCTION_CHAT_MODEL")?.toString()
                ?: localProps.getProperty("JUNCTION_CHAT_MODEL")
                ?: System.getenv("JUNCTION_CHAT_MODEL")
                ?: "gpt-4.1-mini"

        buildConfigField(
            "String",
            "JUNCTION_CHAT_MODEL",
            "\"$chatModel\""
        )

        val webClientId =
            findProperty("JUNCTION_WEB_CLIENT_ID")?.toString()
                ?: localProps.getProperty("JUNCTION_WEB_CLIENT_ID")
                ?: System.getenv("JUNCTION_WEB_CLIENT_ID")
                ?: ""

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

        buildConfigField(
            "boolean",
            "JUNCTION_FIREBASE_CONFIGURED",
            googleServicesFile.exists().toString()
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

    testOptions {
        unitTests {
            isReturnDefaultValues = true
        }
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
            // The Gmail API stack (google-api-client-android, javax.mail) pulls
            // in several jars that each ship their own copy of common
            // META-INF metadata files — pure packaging duplicates with
            // identical or irrelevant content, safe to exclude from the APK.
            excludes += "/META-INF/DEPENDENCIES"
            excludes += "/META-INF/LICENSE*"
            excludes += "/META-INF/NOTICE*"
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
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    // android.jar stubs org.json for unit tests; a real implementation lets the
    // injection suite exercise the same JSON parsing the app uses at runtime.
    testImplementation("org.json:json:20250107")
    testImplementation("com.squareup.okhttp3:mockwebserver:5.3.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("junit:junit:4.13.2")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material")
    implementation("androidx.compose.material:material-icons-extended")

    implementation("com.squareup.okhttp3:okhttp:5.3.2")
    // WebRTC for Realtime voice (chat/realtime/RealtimeSessionManager.kt). Google doesn't
    // publish an official Android WebRTC AAR, so this uses GetStream's actively-maintained
    // repackaging -- the com.infobip:google-webrtc build previously used here was missing
    // the org.webrtc.Environment class (an incomplete BUILD.gn target on their end), which
    // crashed PeerConnectionFactory.initialize() with NoClassDefFoundError on every attempt.
    implementation("io.getstream:stream-webrtc-android:1.3.9")
    implementation("androidx.security:security-crypto:1.1.0-alpha07")
    implementation("dev.rikka.shizuku:api:13.1.5")

    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("com.google.apis:google-api-services-gmail:v1-rev20220404-2.0.0")
    implementation("com.google.api-client:google-api-client-android:2.6.0") {
        exclude(group = "org.apache.httpcomponents")
    }

    // Android port of JavaMail, used by GmailCopilot to build/send MIME replies.
    implementation("com.sun.mail:android-mail:1.6.7")
    implementation("com.sun.mail:android-activation:1.6.7")
}
