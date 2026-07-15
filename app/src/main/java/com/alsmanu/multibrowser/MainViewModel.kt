package com.alsmanu.multibrowser

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.alsmanu.multibrowser.data.AppState
import com.alsmanu.multibrowser.data.Panel
import com.alsmanu.multibrowser.data.PanelType
import com.alsmanu.multibrowser.mail.MailIdentity
import com.alsmanu.multibrowser.mail.MailMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val app = application as MultiBrowserApplication
    private val _state = MutableStateFlow(AppState())
    val state: StateFlow<AppState> = _state.asStateFlow()
    private val _mail = MutableStateFlow<Map<String, Pair<MailIdentity, List<MailMessage>>>>(emptyMap())
    val mail = _mail.asStateFlow()

    init {
        viewModelScope.launch {
            _state.value = app.panelStore.state.first()
            _state.value.panels.filter { it.type == PanelType.TEMP_MAIL }.forEach { refreshMail(it.id) }
        }
    }

    private fun update(block: (AppState) -> AppState) {
        _state.value = block(_state.value)
        viewModelScope.launch { app.panelStore.save(_state.value) }
    }

    fun add(type: PanelType) = update { it.copy(panels = it.panels + Panel(type = type, title = if (type == PanelType.BROWSER) "صفحة جديدة" else "بريد مؤقت")) }
    fun hide(id: String) = update { state -> state.copy(panels = state.panels.map { if (it.id == id) it.copy(hidden = true) else it }) }
    fun restore(id: String) = update { state -> state.copy(panels = state.panels.map { if (it.id == id) it.copy(hidden = false) else it }) }
    fun toggleLayout() = update { it.copy(floatingLayout = !it.floatingLayout) }
    fun toggleTheme() = update { it.copy(darkTheme = !it.darkTheme) }
    fun updatePage(id: String, url: String? = null, title: String? = null) = update { state ->
        state.copy(panels = state.panels.map { if (it.id == id) it.copy(url = url ?: it.url, title = title ?: it.title) else it })
    }

    fun clearBrowser(panel: Panel) {
        app.browserEngine.clear(panel.id, panel.contextId) { updatePage(panel.id, "https://www.google.com", "صفحة نظيفة") }
    }

    fun remove(panel: Panel) {
        viewModelScope.launch {
            if (panel.type == PanelType.BROWSER) app.browserEngine.clear(panel.id, panel.contextId) {}
            else app.mailClient.delete(panel.id, _mail.value[panel.id]?.first ?: app.mailClient.saved(panel.id))
            _mail.value = _mail.value - panel.id
            update { it.copy(panels = it.panels.filterNot { item -> item.id == panel.id }) }
        }
    }

    fun refreshMail(panelId: String, forceNew: Boolean = false) {
        viewModelScope.launch {
            runCatching {
                val old = app.mailClient.saved(panelId)
                if (forceNew && old != null) app.mailClient.delete(panelId, old)
                val identity = if (forceNew) app.mailClient.create(panelId) else app.mailClient.saved(panelId) ?: app.mailClient.create(panelId)
                _mail.value = _mail.value + (panelId to (identity to app.mailClient.messages(identity)))
            }
        }
    }
}
