package com.alsmanu.multibrowser.browser

import android.content.Context
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoRuntimeSettings
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSessionSettings

class BrowserEngine(context: Context) {
    val runtime: GeckoRuntime = GeckoRuntime.create(
        context,
        GeckoRuntimeSettings.Builder()
            .remoteDebuggingEnabled(false)
            .consoleOutput(false)
            .build(),
    )

    private val sessions = mutableMapOf<String, GeckoSession>()

    fun session(panelId: String, contextId: String): GeckoSession = sessions.getOrPut(panelId) {
        GeckoSession(
            GeckoSessionSettings.Builder()
                .contextId(contextId)
                .allowJavascript(true)
                .suspendMediaWhenInactive(true)
                .build(),
        ).also { it.open(runtime) }
    }

    fun close(panelId: String) {
        sessions.remove(panelId)?.close()
    }

    fun clear(panelId: String, contextId: String, onCleared: () -> Unit) {
        close(panelId)
        runtime.storageController.clearDataForSessionContext(contextId)
        onCleared()
    }

    fun pauseExcept(panelId: String?) {
        sessions.forEach { (id, session) -> session.setActive(id == panelId) }
    }
}
