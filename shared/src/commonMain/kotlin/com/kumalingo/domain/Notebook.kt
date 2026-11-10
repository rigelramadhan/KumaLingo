package com.kumalingo.domain

import kotlinx.serialization.Serializable

@Serializable
data class Folder(
    val id: String,
    val title: String,
    val parentId: String? = null,
    val depth: Int = 1,
    val ancestorIds: List<String> = emptyList(),
    val sortKey: String = "a0",
    val status: String = "active",
    val revision: Long = 0,
)

@Serializable
data class Note(
    val id: String,
    val folderId: String,
    val hanzi: String,
    val pinyin: String,
    val translation: String,
    val rawPinyin: String = pinyin,
    val aiTranslation: String = translation,
    val sortKey: String = "a0",
    val ancestorIds: List<String> = emptyList(),
    val revision: Long = 0,
)

@Serializable
data class Candidate(val hanzi: String, val pinyin: String, val translation: String, val context: String = "")

@Serializable
data class Notebook(val folders: List<Folder> = emptyList(), val notes: List<Note> = emptyList()) {
    fun children(parentId: String?): List<Folder> = folders.filter { it.parentId == parentId && isVisible(it) }
        .sortedWith(compareBy(Folder::sortKey, Folder::id))

    fun isVisible(folder: Folder): Boolean = folder.status == "active" && folder.ancestorIds.all { ancestor ->
        folders.any { it.id == ancestor && it.status == "active" }
    }

    fun folderNotes(folderId: String): List<Note> = notes.filter { it.folderId == folderId }
        .sortedWith(compareBy(Note::sortKey, Note::id))

    fun breadcrumb(folderId: String): String {
        val folder = folders.find { it.id == folderId } ?: return ""
        return (folder.ancestorIds + folder.id).mapNotNull { id -> folders.find { it.id == id }?.title }.joinToString(" / ")
    }

    fun search(query: String): List<Note> {
        val normalized = normalizeSearch(query)
        val visibleIds = folders.filter(::isVisible).map { it.id }.toSet()
        return notes.filter { note -> note.folderId in visibleIds &&
            listOf(note.hanzi, note.pinyin, note.rawPinyin, note.translation).any { normalizeSearch(it).contains(normalized) }
        }.sortedWith(compareBy({ breadcrumb(it.folderId) }, Note::sortKey, Note::id))
    }

    fun validateParent(parentId: String?): List<Folder> {
        if (parentId == null) return emptyList()
        val parent = folders.find { it.id == parentId } ?: error("Folder no longer exists.")
        require(isVisible(parent)) { "This folder is being deleted." }
        require(parent.depth < 3) { "Chapters support at most three levels." }
        return (parent.ancestorIds + parent.id).map { id -> folders.first { it.id == id } }
    }
}

// Shared and deterministic on Wasm/native: no java.text or JavaScript handles.
fun normalizeSearch(value: String): String {
    val toneGroups = listOf("aāáǎà", "eēéěè", "iīíǐì", "oōóǒò", "uūúǔù", "vüǖǘǚǜ")
    val text = value.lowercase().replace("u:", "v").trim()
    return buildString {
        for (character in text) {
            if (character in '1'..'5' || character in '\u0300'..'\u036f') continue
            append(toneGroups.firstOrNull { character in it }?.first() ?: character)
        }
    }
}

fun validateNote(hanzi: String, pinyin: String, translation: String) {
    require(hanzi.isNotBlank() && hanzi.length <= 200) { "Enter Hanzi (up to 200 characters)." }
    require(pinyin.isNotBlank() && pinyin.length <= 500) { "Enter Pinyin (up to 500 characters)." }
    require(translation.isNotBlank() && translation.length <= 2000) { "Enter an Indonesian meaning (up to 2000 characters)." }
}
