package com.kumalingo

import com.kumalingo.domain.Candidate
import com.kumalingo.domain.Notebook
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.Serializable

data class ClientState(
    val status: String = "loading", val email: String = "", val notebook: Notebook = Notebook(),
    val busy: Boolean = false, val error: String? = null, val candidates: List<Candidate> = emptyList(),
    val saved: Int = 0, val pendingDeletes: Int = 0,
)
@Serializable
data class RuntimeEvent(
    val type: String, val status: String = "", val email: String = "", val notebook: Notebook? = null,
    val busy: Boolean = false, val message: String? = null, val candidates: List<Candidate> = emptyList(),
    val pendingDeletes: Int = 0,
)
@Serializable
data class Command(
    val op: String, val id: String? = null, val revision: Long? = null, val requestId: String? = null,
    val title: String? = null, val parentId: String? = null, val folderId: String? = null,
    val hanzi: String? = null, val pinyin: String? = null, val translation: String? = null,
    val rawPinyin: String? = null, val aiTranslation: String? = null, val beforeId: String? = null,
    val context: String? = null,
)
interface NotebookClient {
    val state: StateFlow<ClientState>
    fun start()
    fun dispatch(command: Command)
}
