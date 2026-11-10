package com.kumalingo

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kumalingo.domain.Folder
import com.kumalingo.domain.Note
import kotlin.random.Random

private fun requestId() = "r_" + Random.nextLong().toString().replace("-", "n") + Random.nextLong().toString().replace("-", "n")

@Composable
internal fun FolderEditor(client: NotebookClient, state: ClientState, folder: Folder?, parentId: String?, dismiss: () -> Unit) {
    var title by remember { mutableStateOf(folder?.title ?: "") }
    val request = remember { requestId() }
    val savedAtStart = remember { state.saved }
    LaunchedEffect(state.saved) { if (state.saved > savedAtStart) dismiss() }
    AlertDialog(onDismissRequest = { if (!state.busy) dismiss() }, title = { Text(if (folder == null) "A new chapter" else "Rename chapter") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(title, { if (it.length <= 120) title = it }, label = { Text("Chapter title") }, singleLine = true)
            state.error?.let { Text(it, color = MaterialTheme.colors.error) }
        }
    }, confirmButton = { TextButton(onClick = { client.dispatch(if (folder == null) Command("create-folder", requestId = request, title = title, parentId = parentId) else Command("rename-folder", id = folder.id, revision = folder.revision, title = title)) }, enabled = title.isNotBlank() && !state.busy) { Text("Save") } }, dismissButton = { TextButton(onClick = dismiss, enabled = !state.busy) { Text("Cancel") } })
}

@Composable
internal fun NoteEditor(client: NotebookClient, state: ClientState, folder: Folder, note: Note?, dismiss: () -> Unit) {
    var raw by remember { mutableStateOf("") }
    var hanzi by remember { mutableStateOf(note?.hanzi ?: "") }
    var pinyin by remember { mutableStateOf(note?.pinyin ?: "") }
    var translation by remember { mutableStateOf(note?.translation ?: "") }
    var original by remember { mutableStateOf(note?.aiTranslation ?: "") }
    var chosen by remember { mutableStateOf(note != null) }
    var manual by remember { mutableStateOf(false) }
    var requestedPinyin by remember { mutableStateOf<String?>(null) }
    val request = remember { requestId() }
    val savedAtStart = remember { state.saved }
    LaunchedEffect(state.saved) { if (state.saved > savedAtStart) dismiss() }
    val valid = chosen && hanzi.isNotBlank() && pinyin.isNotBlank() && translation.isNotBlank()
    AlertDialog(onDismissRequest = { if (!state.busy) dismiss() }, title = { Text(if (note == null) "A word to remember" else "Make this meaning yours") }, text = {
        Column(Modifier.widthIn(max = 520.dp).heightIn(max = 540.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (note == null) {
                OutlinedTextField(raw, { if (it.length <= 200) { raw = it; chosen = manual } }, label = { Text("Raw Pinyin, e.g. shi") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Row {
                    Button(onClick = { chosen = false; manual = false; requestedPinyin = raw; client.dispatch(Command("translate", rawPinyin = raw)) }, enabled = raw.isNotBlank() && !state.busy) { Text("Find meanings") }
                    TextButton(onClick = { manual = true; chosen = true; original = "" }, enabled = !state.busy) { Text("Enter manually") }
                }
                Text("Only this input is sent to AI. The free AI provider may use it to improve its products.", color = Color(0xFF756E68), fontSize = 11.sp)
                if (!manual && requestedPinyin == raw) for (candidate in state.candidates) Surface(shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, if (chosen && hanzi == candidate.hanzi && pinyin == candidate.pinyin) MaterialTheme.colors.primary else Color(0xFFE5DFD9)), modifier = Modifier.fillMaxWidth().clickable {
                    hanzi = candidate.hanzi; pinyin = candidate.pinyin; translation = candidate.translation; original = candidate.translation; chosen = true
                }) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("${candidate.hanzi}   ${candidate.pinyin}", fontSize = 20.sp)
                        Text(candidate.translation)
                        if (candidate.context.isNotBlank()) Text(candidate.context, color = Color(0xFF756E68), fontSize = 12.sp)
                    }
                }
                if (manual) {
                    OutlinedTextField(hanzi, { if (it.length <= 200) hanzi = it }, label = { Text("Hanzi") }, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(pinyin, { if (it.length <= 500) pinyin = it }, label = { Text("Tone-marked Pinyin") }, modifier = Modifier.fillMaxWidth())
                }
            } else Text("${note.hanzi} · ${note.pinyin}", fontSize = 23.sp)
            if (chosen) {
                OutlinedTextField(translation, { if (it.length <= 2000) translation = it }, label = { Text("Your Indonesian meaning") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
                if (original.isNotEmpty()) TextButton(onClick = { translation = original }) { Text("Reset to AI suggestion") }
            }
            state.error?.let { Text(it, color = MaterialTheme.colors.error) }
        }
    }, confirmButton = { TextButton(onClick = {
        client.dispatch(if (note != null) Command("edit-note", id = note.id, revision = note.revision, translation = translation) else Command("create-note", requestId = request, folderId = folder.id, hanzi = hanzi, pinyin = pinyin, translation = translation, rawPinyin = raw.ifBlank { pinyin }, aiTranslation = original))
    }, enabled = valid && !state.busy) { Text("Save note") } }, dismissButton = { TextButton(onClick = dismiss, enabled = !state.busy) { Text("Cancel") } })
}

@Composable
internal fun DeleteConfirmation(title: String, message: String, busy: Boolean, dismiss: () -> Unit, confirm: () -> Unit) {
    AlertDialog(onDismissRequest = dismiss, title = { Text(title) }, text = { Text(message) }, confirmButton = { TextButton(onClick = confirm, enabled = !busy) { Text("Delete", color = MaterialTheme.colors.error) } }, dismissButton = { TextButton(onClick = dismiss) { Text("Keep it") } })
}
