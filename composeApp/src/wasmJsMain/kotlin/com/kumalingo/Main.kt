package com.kumalingo

import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.window.ComposeViewport
import com.kumalingo.firebase.WebNotebookClient

@OptIn(ExperimentalComposeUiApi::class)
fun main() {
    val client = WebNotebookClient()
    client.start()
    ComposeViewport { NotebookApp(client) }
}
