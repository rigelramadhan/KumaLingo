package com.kumalingo.domain

import kotlin.test.*

class NotebookTest {
    private val root = Folder("root", "Everyday")
    private val child = Folder("child", "Greetings", "root", 2, listOf("root"))
    private val leaf = Folder("leaf", "Morning", "child", 3, listOf("root", "child"))
    private val notebook = Notebook(listOf(root, child, leaf), listOf(
        Note("hello", "leaf", "你好", "nǐ hǎo", "Halo", sortKey = "a1"),
        Note("tea", "root", "茶", "chá", "Teh", sortKey = "a0"),
    ))

    @Test fun searchCoversAllFoldersAndToneStyles() {
        assertEquals("hello", notebook.search("ni3 hao3").single().id)
        assertEquals("hello", notebook.search("ni3hao3").single().id)
        assertEquals("tea", notebook.search("茶").single().id)
        assertEquals("hello", notebook.search("HALO").single().id)
        assertEquals("Everyday / Greetings / Morning", notebook.breadcrumb("leaf"))
    }
    @Test fun parentValidationRejectsFourthLevelAndMissingParents() {
        assertEquals(listOf(root, child), notebook.validateParent("child"))
        assertFailsWith<IllegalArgumentException> { notebook.validateParent("leaf") }
        assertFailsWith<IllegalStateException> { notebook.validateParent("missing") }
    }
    @Test fun deletingAncestorHidesTheWholeSubtreeFromSearch() {
        val deleting = notebook.copy(folders = notebook.folders.map { if (it.id == "root") it.copy(status = "deleting") else it })
        assertTrue(deleting.search("").isEmpty())
        assertFailsWith<IllegalArgumentException> { deleting.validateParent("child") }
    }
    @Test fun umlautAndCombiningTonesNormalize() {
        assertEquals(normalizeSearch("lü4"), normalizeSearch("lǜ"))
        assertEquals(normalizeSearch("lu:4"), normalizeSearch("lǜ"))
        assertEquals("ni", normalizeSearch("ni\u030c"))
        assertEquals("lv", normalizeSearch("lu\u0308\u0300"))
        assertEquals("2025", normalizeSearch("2025"))
    }
    @Test fun noteValidationRejectsEmptyAndOversizedInput() {
        assertFailsWith<IllegalArgumentException> { validateNote("", "ni", "Halo") }
        assertFailsWith<IllegalArgumentException> { validateNote("你", "ni", "x".repeat(2001)) }
    }
    @Test fun numericTranslationKeywordsAreNotMistakenForPinyinTones() {
        val numbered = notebook.copy(notes = listOf(notebook.notes.first().copy(translation = "Pelajaran2025, HSK5")))
        assertEquals("hello", numbered.search("2025").single().id)
        assertEquals("hello", numbered.search("HSK5").single().id)
        assertEquals("hello", numbered.search("ni3hao3").single().id)
    }
}
