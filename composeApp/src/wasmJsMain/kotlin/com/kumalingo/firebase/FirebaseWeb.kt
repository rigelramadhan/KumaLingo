@file:OptIn(kotlin.js.ExperimentalWasmJsInterop::class)

package com.kumalingo.firebase

import kotlin.js.JsModule

// This npm module must be included by the wasmJsMain Gradle dependency.
// Keep these declarations out of commonMain and future native source sets.
@JsModule("@kumalingo/firebase-web")
internal external fun initializeFirebaseFromJson(configJson: String)

/** Runtime web configuration only. Never pass backend keys or service accounts. */
internal object FirebaseWeb {
    fun initialize(configJson: String) {
        initializeFirebaseFromJson(configJson)
    }
}
