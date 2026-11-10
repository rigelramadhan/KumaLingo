package com.kumalingo

import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInParent
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kumalingo.domain.*

private val Muted = Color(0xFF756E68)

@Composable
internal fun NotebookScreen(client: NotebookClient, state: ClientState) {
    val notebook = state.notebook
    var selected by remember { mutableStateOf<String?>(null) }
    var search by remember { mutableStateOf("") }
    var showChapters by remember { mutableStateOf(false) }
    var folderDialog by remember { mutableStateOf(false) }
    var rename by remember { mutableStateOf<Folder?>(null) }
    var parent by remember { mutableStateOf<String?>(null) }
    var noteDialog by remember { mutableStateOf(false) }
    var edit by remember { mutableStateOf<Note?>(null) }
    var deleteFolder by remember { mutableStateOf<Folder?>(null) }
    var deleteNote by remember { mutableStateOf<Note?>(null) }
    LaunchedEffect(notebook.folders) {
        if (notebook.folders.none { it.id == selected && notebook.isVisible(it) }) selected = notebook.children(null).firstOrNull()?.id
    }
    val folder = notebook.folders.find { it.id == selected }
    val notes = if (search.isNotBlank()) notebook.search(search) else selected?.let(notebook::folderNotes) ?: emptyList()
    fun addFolder(parentId: String?) { parent = parentId; rename = null; folderDialog = true }
    @Composable fun chapters() {
        Chapters(notebook, selected, state.busy, { selected = it; search = ""; showChapters = false }, { addFolder(it) }, { rename = it; folderDialog = true }, { deleteFolder = it })
    }
    BoxWithConstraints(Modifier.fillMaxSize().background(MaterialTheme.colors.background)) {
        val compact = maxWidth < 760.dp
        Row(Modifier.fillMaxSize()) {
            if (!compact) Surface(color = Color.White, modifier = Modifier.width(260.dp).fillMaxHeight()) { chapters() }
            Column(Modifier.weight(1f).padding(if (compact) 16.dp else 32.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (compact) TextButton(onClick = { showChapters = true }) { Text("Chapters") }
                    OutlinedTextField(search, { search = it }, placeholder = { Text("Search Hanzi, Pinyin, or Indonesian…") }, singleLine = true, shape = RoundedCornerShape(14.dp), modifier = Modifier.weight(1f))
                    TextButton(onClick = { client.dispatch(Command("sign-out")) }, enabled = !state.busy) { Text("Sign out") }
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text(if (search.isNotBlank()) "All matching notes" else folder?.title ?: "Your notebook", fontSize = 27.sp, fontWeight = FontWeight.Medium)
                        Text(if (search.isNotBlank()) "${notes.size} results across your notebook" else selected?.let(notebook::breadcrumb) ?: "Make room for your first words", color = Muted, fontSize = 13.sp)
                    }
                    Button(onClick = { edit = null; noteDialog = true }, enabled = folder != null && !state.busy, shape = RoundedCornerShape(12.dp)) { Text("Add note") }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("${notebook.notes.size} words collected", color = Muted, modifier = Modifier.weight(1f))
                    TextButton(onClick = { client.dispatch(Command("export-json")) }, enabled = !state.busy) { Text("Backup") }
                    TextButton(onClick = { client.dispatch(Command("export-pdf")) }, enabled = !state.busy && notebook.notes.isNotEmpty()) { Text("Export PDF") }
                }
                if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                state.error?.let { Text(it, color = MaterialTheme.colors.error) }
                if (state.pendingDeletes > 0) Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Removing ${state.pendingDeletes} chapter group(s)…", color = Muted, modifier = Modifier.weight(1f))
                    TextButton(onClick = { client.dispatch(Command("retry-deletions")) }) { Text("Retry") }
                }
                if (notes.isEmpty()) {
                    Column(Modifier.weight(1f).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                        Text(if (search.isNotBlank()) "No words found" else "Every word starts somewhere.", fontSize = 23.sp)
                        Spacer(Modifier.height(12.dp))
                        Text(if (search.isNotBlank()) "Try another spelling or meaning." else "Create a chapter, then add something you want to remember.", color = Muted)
                        if (folder == null && search.isBlank()) TextButton(onClick = { addFolder(null) }) { Text("Create your first chapter") }
                    }
                } else NoteList(notes, notebook, search.isNotBlank(), state.busy, { edit = it; noteDialog = true }, { deleteNote = it }, { note, before -> client.dispatch(Command("move-note", id = note.id, revision = note.revision, beforeId = before)) })
            }
        }
        if (compact && showChapters) AlertDialog(onDismissRequest = { showChapters = false }, title = { Text("Your chapters") }, text = { Box(Modifier.heightIn(max = 480.dp)) { chapters() } }, confirmButton = { TextButton(onClick = { showChapters = false }) { Text("Done") } })
    }
    if (folderDialog) FolderEditor(client, state, rename, parent) { folderDialog = false }
    if (noteDialog && folder != null) NoteEditor(client, state, folder, edit) { noteDialog = false }
    deleteFolder?.let { target ->
        val count = notebook.notes.count { target.id in it.ancestorIds }
        DeleteConfirmation("Delete ${target.title}?", "This removes its subchapters and $count notes. This cannot be undone.", state.busy, { deleteFolder = null }) {
            client.dispatch(Command("delete-folder", id = target.id, revision = target.revision)); deleteFolder = null
        }
    }
    deleteNote?.let { target -> DeleteConfirmation("Delete this note?", "${target.hanzi} will be removed from your notebook.", state.busy, { deleteNote = null }) {
        client.dispatch(Command("delete-note", id = target.id, revision = target.revision)); deleteNote = null
    } }
}

@Composable
private fun Chapters(notebook: Notebook, selected: String?, busy: Boolean, select: (String) -> Unit, add: (String?) -> Unit, rename: (Folder) -> Unit, delete: (Folder) -> Unit) {
    val collapsed = remember { mutableStateMapOf<String, Boolean>() }
    Column(Modifier.fillMaxHeight().padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("KumaLingo", color = MaterialTheme.colors.primary, fontSize = 25.sp, fontWeight = FontWeight.Bold)
        Text("A word at a time.", color = Muted, fontSize = 13.sp)
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("CHAPTERS", fontSize = 12.sp, color = Muted, modifier = Modifier.weight(1f))
            TextButton(onClick = { add(null) }, enabled = !busy) { Text("+ New") }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            @Composable fun branch(parent: String?) {
                for (folder in notebook.children(parent)) {
                    key(folder.id) {
                        var menu by remember { mutableStateOf(false) }
                        Row(Modifier.fillMaxWidth().padding(start = ((folder.depth - 1) * 12).dp).background(if (selected == folder.id) Color(0xFFFBECE9) else Color.Transparent, RoundedCornerShape(10.dp)), verticalAlignment = Alignment.CenterVertically) {
                            Text(if (collapsed[folder.id] == true) "›" else "⌄", modifier = Modifier.clickable { collapsed[folder.id] = collapsed[folder.id] != true }.padding(8.dp).semantics { contentDescription = "Toggle ${folder.title} subchapters" })
                            Text(folder.title, modifier = Modifier.weight(1f).clickable { select(folder.id) }.padding(vertical = 12.dp), maxLines = 2, fontSize = 14.sp)
                            Box {
                                TextButton(onClick = { menu = true }, enabled = !busy, contentPadding = PaddingValues(4.dp), modifier = Modifier.width(32.dp)) { Text("⋯") }
                                DropdownMenu(menu, { menu = false }) {
                                    if (folder.depth < 3) DropdownMenuItem(onClick = { menu = false; add(folder.id) }) { Text("Add subchapter") }
                                    DropdownMenuItem(onClick = { menu = false; rename(folder) }) { Text("Rename") }
                                    DropdownMenuItem(onClick = { menu = false; delete(folder) }) { Text("Delete") }
                                }
                            }
                        }
                        if (collapsed[folder.id] != true) branch(folder.id)
                    }
                }
            }
            branch(null)
        }
        Text("Your Mandarin, thoughtfully kept.", color = Muted, fontSize = 12.sp)
    }
}

@Composable
private fun ColumnScope.NoteList(notes: List<Note>, notebook: Notebook, searching: Boolean, busy: Boolean, edit: (Note) -> Unit, delete: (Note) -> Unit, move: (Note, String?) -> Unit) {
    val centers = remember { mutableStateMapOf<String, Float>() }
    var dragging by remember { mutableStateOf<String?>(null) }
    var dragY by remember { mutableStateOf(0f) }
    var startY by remember { mutableStateOf(0f) }
    Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        notes.forEachIndexed { index, note ->
            key(note.id) {
                Surface(shape = RoundedCornerShape(16.dp), color = Color.White, elevation = 1.dp, modifier = Modifier.fillMaxWidth().onGloballyPositioned { centers[note.id] = it.boundsInParent().center.y }.graphicsLayer { if (dragging == note.id) { translationY = dragY; alpha = 0.8f } }) {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                            if (!searching) Text("⠿", fontSize = 25.sp, color = Muted, modifier = Modifier.semantics { contentDescription = "Drag to reorder ${note.hanzi}" }.pointerInput(note.id, notes.map { it.id }, busy) {
                                if (!busy) detectDragGestures(onDragStart = { dragging = note.id; startY = centers[note.id] ?: 0f; dragY = 0f }, onDrag = { change, amount -> change.consume(); dragY += amount.y }, onDragCancel = { dragging = null; dragY = 0f }, onDragEnd = {
                                    val center = startY + dragY
                                    val before = notes.filter { it.id != note.id }.firstOrNull { (centers[it.id] ?: Float.MAX_VALUE) > center }?.id
                                    dragging = null; dragY = 0f; move(note, before)
                                })
                            })
                            SelectionContainer(Modifier.weight(1f)) { Text(note.hanzi, fontSize = 28.sp, fontWeight = FontWeight.Medium) }
                            TextButton(onClick = { edit(note) }, enabled = !busy) { Text("Edit") }
                            TextButton(onClick = { delete(note) }, enabled = !busy) { Text("Delete") }
                        }
                        SelectionContainer { Text(note.pinyin, color = MaterialTheme.colors.primary, fontSize = 17.sp) }
                        SelectionContainer { Text(note.translation, fontSize = 16.sp) }
                        if (note.aiTranslation.isNotEmpty() && note.translation != note.aiTranslation) Text("Your translation", fontSize = 11.sp, color = Muted)
                        if (searching) Text(notebook.breadcrumb(note.folderId), color = Muted, fontSize = 12.sp)
                        else Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            TextButton(onClick = { move(note, notes[index - 1].id) }, enabled = index > 0 && !busy) { Text("Move up") }
                            TextButton(onClick = { move(note, notes.getOrNull(index + 2)?.id) }, enabled = index < notes.lastIndex && !busy) { Text("Move down") }
                        }
                    }
                }
            }
        }
    }
}
