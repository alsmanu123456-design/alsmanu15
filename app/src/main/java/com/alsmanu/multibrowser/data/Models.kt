package com.alsmanu.multibrowser.data

import kotlinx.serialization.Serializable
import java.util.UUID

@Serializable
enum class PanelType { BROWSER, TEMP_MAIL }

@Serializable
data class Panel(
    val id: String = UUID.randomUUID().toString(),
    val contextId: String = "profile-${UUID.randomUUID()}",
    val type: PanelType = PanelType.BROWSER,
    val title: String = "صفحة جديدة",
    val url: String = "https://www.google.com",
    val hidden: Boolean = false,
)

@Serializable
data class AppState(
    val panels: List<Panel> = defaultPanels(),
    val floatingLayout: Boolean = false,
    val darkTheme: Boolean = true,
    val accent: String = "blue",
) {
    companion object {
        fun defaultPanels() = List(3) { index ->
            Panel(title = "المتصفح ${index + 1}")
        }
    }
}

fun normalizeAddress(input: String): String {
    val value = input.trim()
    if (value.isBlank()) return "https://www.google.com"
    if (value.startsWith("http://") || value.startsWith("https://")) return value
    val looksLikeHost = value.contains('.') && !value.contains(' ')
    return if (looksLikeHost) "https://$value"
    else "https://www.google.com/search?q=${java.net.URLEncoder.encode(value, Charsets.UTF_8.name())}"
}
