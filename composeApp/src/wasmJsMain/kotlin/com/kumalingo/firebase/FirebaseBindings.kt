@file:OptIn(kotlin.js.ExperimentalWasmJsInterop::class)
@file:kotlin.js.JsModule("@kumalingo/firebase-web")

package com.kumalingo.firebase

// File-level module binding preserves named ESM exports in Kotlin/Wasm.
internal external fun startRuntime(onEvent: (String) -> Unit)
internal external fun dispatchCommand(commandJson: String)
internal external fun initializeFirebaseFromJson(configJson: String)
