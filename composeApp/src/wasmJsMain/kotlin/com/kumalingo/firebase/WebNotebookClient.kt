@file:OptIn(kotlin.js.ExperimentalWasmJsInterop::class)

package com.kumalingo.firebase

import com.kumalingo.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.Json

internal class WebNotebookClient : NotebookClient {
    private val current = MutableStateFlow(ClientState())
    override val state: StateFlow<ClientState> = current
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = false }
    override fun start() {
        startRuntime { payload ->
            try {
                val event = json.decodeFromString<RuntimeEvent>(payload)
                current.value = when (event.type) {
                    "status" -> if (event.status in listOf("signedOut", "blocked", "unconfigured")) ClientState(status = event.status, error = event.message)
                        else current.value.copy(status = event.status, email = event.email, error = null)
                    "snapshot" -> current.value.copy(notebook = event.notebook ?: current.value.notebook)
                    "busy" -> current.value.copy(busy = event.busy, error = if (event.busy) null else current.value.error)
                    "error" -> current.value.copy(error = event.message ?: "Something went wrong. Please try again.")
                    "candidates" -> current.value.copy(candidates = event.candidates)
                    "saved" -> current.value.copy(saved = current.value.saved + 1)
                    "progress" -> current.value.copy(pendingDeletes = event.pendingDeletes)
                    else -> current.value
                }
            } catch (_: Throwable) { current.value = ClientState(status = "unconfigured", error = "The notebook response could not be read. Please reload.") }
        }
    }
    override fun dispatch(command: Command) { dispatchCommand(json.encodeToString(command)) }
}
