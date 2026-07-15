package com.alsmanu.multibrowser.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private val Context.dataStore by preferencesDataStore("multi_browser")

class PanelStore(private val context: Context) {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val stateKey = stringPreferencesKey("app_state_v1")

    val state: Flow<AppState> = context.dataStore.data
        .map { values ->
            values[stateKey]?.let { runCatching { json.decodeFromString<AppState>(it) }.getOrNull() }
                ?: AppState()
        }
        .catch { emit(AppState()) }

    suspend fun save(state: AppState) {
        context.dataStore.edit { it[stateKey] = json.encodeToString(state) }
    }
}
