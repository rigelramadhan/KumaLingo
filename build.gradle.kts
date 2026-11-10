plugins {
    kotlin("multiplatform") version "2.3.21" apply false
    kotlin("plugin.serialization") version "2.3.21" apply false
    id("org.jetbrains.compose") version "1.11.1" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.3.21" apply false
}

// File-based npm dependencies need explicit inputs for cross-package metadata changes.
tasks.matching { it.name == "kotlinWasmNpmInstall" }.configureEach {
    inputs.file(layout.projectDirectory.file("webBridge/package.json"))
    inputs.file(layout.projectDirectory.file("webBridge/package-lock.json"))
}
