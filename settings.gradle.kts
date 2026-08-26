pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "Junction"
include(":app")
project(":app").projectDir = file("apps/android")
// Avatar module is intentionally parked while the replacement is designed.
// Its source/assets remain in /avatar but are not compiled or packaged.
