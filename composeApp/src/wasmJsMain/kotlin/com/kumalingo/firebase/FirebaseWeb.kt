@file:OptIn(kotlin.js.ExperimentalWasmJsInterop::class)

package com.kumalingo.firebase

/** Runtime web configuration only. Never pass backend keys or service accounts. */
internal object FirebaseWeb {
    fun initialize(configJson: String) {
        initializeFirebaseFromJson(configJson)
    }
}
