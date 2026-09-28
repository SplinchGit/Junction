"""One-time, copy-only extraction of the embedded Android products. No credentials copied."""
from pathlib import Path
import hashlib
import json
import shutil

SOURCE = Path(__file__).resolve().parents[1]
DAW = SOURCE.parent / 'Junction-DAW'
MAFIOSO = SOURCE.parent / '0Mafioso' / 'Mafioso' / 'apps' / 'android'
manifest = []

def write(root, name, value):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding='utf-8')

def copy(relative, root, target):
    source = SOURCE / relative
    files = [source] if source.is_file() else sorted(p for p in source.rglob('*') if p.is_file())
    for file in files:
        dest = root / target / file.relative_to(source) if source.is_dir() else root / target
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(file, dest)
        digest = hashlib.sha256(file.read_bytes()).hexdigest()
        assert hashlib.sha256(dest.read_bytes()).hexdigest() == digest
        manifest.append({'source': str(file.relative_to(SOURCE)), 'destination': str(dest), 'sha256': digest})

def scaffold(root, name, package, extra=''):
    if root.exists():
        raise SystemExit(f'Refusing to overwrite {root}')
    root.mkdir(parents=True)
    for wrapper in ['gradlew', 'gradlew.bat', 'gradle/wrapper']:
        copy(wrapper, root, wrapper)
    write(root, '.gitignore', '.gradle/\n.kotlin/\n**/build/\nlocal.properties\n*.jks\n*.keystore\n.idea/\n')
    write(root, 'settings.gradle.kts', f'''pluginManagement {{ repositories {{ google(); mavenCentral(); gradlePluginPortal() }} }}
dependencyResolutionManagement {{ repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories {{ google(); mavenCentral() }} }}
rootProject.name = "{name}"
include(":app")
''')
    write(root, 'build.gradle.kts', '''plugins {
    id("com.android.application") version "9.3.1" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.10" apply false
}
''')
    write(root, 'gradle.properties', 'org.gradle.jvmargs=-Xmx1536m -Dfile.encoding=UTF-8\norg.gradle.workers.max=1\nandroid.useAndroidX=true\n')
    write(root, 'app/build.gradle.kts', f'''plugins {{ id("com.android.application"); id("org.jetbrains.kotlin.plugin.compose") }}
android {{
    namespace = "{package}"
    compileSdk = 36
    defaultConfig {{ applicationId = "{package}"; minSdk = 26; targetSdk = 36; versionCode = 1; versionName = "0.1.0" }}
    buildFeatures {{ compose = true; buildConfig = true }}
    compileOptions {{ sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }}
}}
dependencies {{
    implementation(platform("androidx.compose:compose-bom:2025.08.00"))
    implementation("androidx.activity:activity-compose:1.12.3")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250107")
    {extra}
}}
''')

scaffold(DAW, 'Junction-DAW', 'com.splinch.junction.daw')
java = 'apps/android/src/main/java/com/splinch/junction/'
copy(java + 'feature/music', DAW, 'app/src/main/java/com/splinch/junction/feature/music')
copy(java + 'platform/audio', DAW, 'app/src/main/java/com/splinch/junction/platform/audio')
copy(java + 'feature/migration/MusicArchive.kt', DAW, 'app/src/main/java/com/splinch/junction/feature/migration/MusicArchive.kt')
copy('apps/android/src/test/java/com/splinch/junction/feature/music', DAW, 'app/src/test/java/com/splinch/junction/feature/music')
copy('apps/android/src/test/java/com/splinch/junction/feature/migration', DAW, 'app/src/test/java/com/splinch/junction/feature/migration')
write(DAW, 'app/src/main/AndroidManifest.xml', '''<manifest xmlns:android="http://schemas.android.com/apk/res/android">
<uses-permission android:name="android.permission.RECORD_AUDIO"/>
<application android:label="Junction DAW" android:allowBackup="false" android:theme="@android:style/Theme.Material.Light.NoActionBar">
<activity android:name=".MainActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity>
<provider android:name="androidx.core.content.FileProvider" android:authorities="${applicationId}.updates" android:exported="false" android:grantUriPermissions="true"><meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/file_paths"/></provider>
</application></manifest>''')
write(DAW, 'app/src/main/res/xml/file_paths.xml', '<paths><cache-path name="mixes" path="music-exports/"/></paths>')
write(DAW, 'app/src/main/java/com/splinch/junction/daw/MainActivity.kt', '''package com.splinch.junction.daw
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.splinch.junction.feature.music.ui.MusicEditorScreen
import com.splinch.junction.feature.migration.MusicArchive
import kotlinx.coroutines.*

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme {
            var studio by remember { mutableStateOf(false) }
            var busy by remember { mutableStateOf(false) }
            var status by remember { mutableStateOf("") }
            val scope = rememberCoroutineScope()
            val importer = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
                if (uri != null) scope.launch {
                    busy = true
                    status = withContext(Dispatchers.IO) { runCatching {
                        contentResolver.openInputStream(uri)?.use { MusicArchive.importNew(filesDir, it) } ?: error("Cannot open archive")
                        "Imported. Open the studio to continue your project."
                    }.getOrElse { "Import failed: ${it.message}" } }
                    busy = false
                }
            }
            val exporter = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri ->
                if (uri != null) scope.launch {
                    busy = true
                    status = withContext(Dispatchers.IO) { runCatching {
                        contentResolver.openOutputStream(uri)?.use { MusicArchive.export(filesDir, it) } ?: error("Cannot open destination")
                        "Project exported."
                    }.getOrElse { "Export failed: ${it.message}" } }
                    busy = false
                }
            }
            Scaffold { insets ->
                Column(Modifier.fillMaxSize().padding(insets)) {
                    if (studio) {
                        TextButton(onClick = { studio = false }) { Text("Project files") }
                        MusicEditorScreen(Modifier.weight(1f))
                    } else Column(Modifier.padding(16.dp)) {
                        Text("Junction DAW", style = MaterialTheme.typography.headlineMedium)
                        Text("Your offline music studio. Import an existing Junction music ZIP before opening a fresh studio. Existing projects are never overwritten by import.")
                        Button(onClick = { studio = true }, enabled = !busy) { Text("Open studio") }
                        OutlinedButton(onClick = { importer.launch(arrayOf("application/zip", "application/octet-stream")) }, enabled = !busy) { Text("Import project") }
                        OutlinedButton(onClick = { exporter.launch("junction-music.zip") }, enabled = !busy) { Text("Export project") }
                        Text(status)
                    }
                }
            }
        } }
    }
}
''')
write(DAW, 'README.md', '''# Junction DAW

Standalone offline Android studio extracted from Junction on 2026-09-27.
Preserves arrangement, piano roll, mixer, automation, synth/sampler, WAV import,
recording, WAV export, undo/redo, autosave and renderer tests. No account or AI API.

Build with JDK 17+ and Android SDK 36: `./gradlew :app:testDebugUnitTest :app:assembleDebug`.
AGP uses built-in Kotlin; do not add the Kotlin Android plugin.

## Transfer from Junction
Update Junction, open Settings and choose **Export existing music project**.
Save the ZIP using Android's document picker. In a fresh DAW installation choose
**Import project**, select that ZIP, then **Open studio**. Junction retains its
original files. No chat, keys or account data enter the archive. Import refuses
to overwrite existing studio data; export your current project before resetting
the standalone app. Import/export limits: 512 MiB, 4096 files. WAV rendering is
separate from full-project ZIP export.

Microphone permission is requested only for recording. This app has no Internet
permission. Debug signing is independent; no Junction signing credentials copied.
Physical audio/recording and device UI tests remain to be run on hardware.
''')

scaffold(MAFIOSO, 'Mafioso-Android', 'com.splinch.mafioso', 'implementation("com.android.billingclient:billing-ktx:8.0.0")')
copy(java + 'feature/mafioso', MAFIOSO, 'app/src/main/java/com/splinch/junction/feature/mafioso')
write(MAFIOSO, 'app/src/main/AndroidManifest.xml', '''<manifest xmlns:android="http://schemas.android.com/apk/res/android">
<uses-permission android:name="android.permission.INTERNET"/>
<application android:label="Mafioso" android:allowBackup="false" android:usesCleartextTraffic="false" android:theme="@android:style/Theme.Material.Light.NoActionBar">
<activity android:name=".MainActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity>
</application></manifest>''')
write(MAFIOSO, 'app/src/main/java/com/splinch/mafioso/MainActivity.kt', '''package com.splinch.mafioso
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.ui.Modifier
import com.splinch.junction.feature.mafioso.ui.MafiosoScreen
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme { Scaffold { insets -> MafiosoScreen("https://d2t8pi3n8wgmgj.cloudfront.net", Modifier.padding(insets)) } } }
    }
}
''')
write(MAFIOSO, 'README.md', '''# Mafioso Android

Independent Android launcher + Play Billing bridge ported from Junction.
The game's existing frontend/backend remain authoritative and unchanged.
Build from this directory using JDK 17+ and Android SDK 36:
`./gradlew :app:assembleDebug`.

Uses application ID `com.splinch.mafioso`, not Junction's application ID.
Before Play release, register this app and its existing `mafioso_points_*`
products, configure signing and update the backend Google Play package setting.
The current infrastructure default `com.splinch.junction` belongs to the old
embedded app. Existing purchases must remain verifiable under their original
package; plan dual-package verification/migration before releasing this wrapper.
No production billing configuration or deployment has been changed here.
No live purchases, sign-in or backend mutations were exercised during extraction.
Local WebView sessions do not migrate across Android application sandboxes;
sign in with the same game account to recover server-side progress.
''')

write(SOURCE, 'docs/audit/product-extraction-manifest.json', json.dumps(manifest, indent=2) + '\n')
print(f'Copied and SHA256-verified {len(manifest)} files. DAW: {DAW}; Mafioso: {MAFIOSO}')
