package com.alsmanu.multibrowser

import android.app.Application
import com.alsmanu.multibrowser.browser.BrowserEngine
import com.alsmanu.multibrowser.data.PanelStore
import com.alsmanu.multibrowser.mail.MailClient

class MultiBrowserApplication : Application() {
    val panelStore by lazy { PanelStore(this) }
    val browserEngine by lazy { BrowserEngine(this) }
    val mailClient by lazy { MailClient(this) }
}
