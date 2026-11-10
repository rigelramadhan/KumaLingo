plugins {
    kotlin("multiplatform")
    id("org.jetbrains.compose")
    id("org.jetbrains.kotlin.plugin.compose")
}
kotlin {
    jvm()
    @OptIn(org.jetbrains.kotlin.gradle.ExperimentalWasmDsl::class)
    wasmJs {
        browser {
            commonWebpackConfig { outputFileName = "kumalingo.js" }
        }
        binaries.executable()
    }
    sourceSets {
        commonMain.dependencies {
            implementation(project(":shared"))
            implementation("org.jetbrains.compose.runtime:runtime:1.11.1")
            implementation("org.jetbrains.compose.foundation:foundation:1.11.1")
            implementation("org.jetbrains.compose.material:material:1.11.1")
            implementation("org.jetbrains.compose.ui:ui:1.11.1")
            implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
            implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
        }
        wasmJsMain.dependencies {
            // Relative to build/wasm/packages/<module>; keep generated locks portable.
            implementation(npm("@kumalingo/firebase-web", "file:../../../../webBridge"))
        }
    }
}
