package com.alsmanu.multibrowser.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CleaningServices
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.alsmanu.multibrowser.MainViewModel
import com.alsmanu.multibrowser.MultiBrowserApplication
import com.alsmanu.multibrowser.data.Panel
import com.alsmanu.multibrowser.data.PanelType
import com.alsmanu.multibrowser.data.normalizeAddress
import com.alsmanu.multibrowser.mail.MailIdentity
import com.alsmanu.multibrowser.mail.MailMessage
import org.mozilla.geckoview.GeckoView

private val Navy = Color(0xFF0F172A)
private val Blue = Color(0xFF2563EB)
private val Cloud = Color(0xFFF8FAFC)
private val Slate = Color(0xFF64748B)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MultiBrowserScreen(viewModel: MainViewModel, state: com.alsmanu.multibrowser.data.AppState, mail: Map<String, Pair<MailIdentity, List<MailMessage>>>) {
    var addMenu by remember { mutableStateOf(false) }
    val visible = state.panels.filterNot { it.hidden }
    MaterialTheme(colorScheme = if (state.darkTheme) darkScheme() else lightScheme()) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Column { Text("Multi Browser"); Text("${visible.size} صفحات معزولة", style = MaterialTheme.typography.labelSmall) } },
                    actions = {
                        IconButton(onClick = viewModel::toggleLayout) { Icon(Icons.Default.GridView, "تبديل التخطيط") }
                        IconButton(onClick = viewModel::toggleTheme) { Icon(if (state.darkTheme) Icons.Default.LightMode else Icons.Default.DarkMode, "تبديل السمة") }
                        Box {
                            IconButton(onClick = { addMenu = true }) { Icon(Icons.Default.Add, "إضافة لوحة") }
                            DropdownMenu(expanded = addMenu, onDismissRequest = { addMenu = false }) {
                                DropdownMenuItem(text = { Text("متصفح معزول") }, leadingIcon = { Icon(Icons.Default.Public, null) }, onClick = { viewModel.add(PanelType.BROWSER); addMenu = false })
                                DropdownMenuItem(text = { Text("بريد مؤقت") }, leadingIcon = { Icon(Icons.Default.Email, null) }, onClick = { viewModel.add(PanelType.TEMP_MAIL); addMenu = false })
                            }
                        }
                    },
                )
            },
        ) { padding ->
            Column(Modifier.fillMaxSize().padding(padding).padding(8.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (visible.isEmpty()) EmptyState { viewModel.add(PanelType.BROWSER) }
                else visible.forEach { panel ->
                    Card(Modifier.fillMaxWidth().height(380.dp)) {
                        when (panel.type) {
                            PanelType.BROWSER -> BrowserPanel(panel, viewModel)
                            PanelType.TEMP_MAIL -> MailPanel(panel, mail[panel.id], viewModel)
                        }
                    }
                }
                val hidden = state.panels.filter { it.hidden }
                if (hidden.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    hidden.forEach { TextButton(onClick = { viewModel.restore(it.id) }) { Text("استعادة ${it.title}") } }
                }
            }
        }
    }
}

@Composable
private fun BrowserPanel(panel: Panel, viewModel: MainViewModel) {
    val app = LocalContext.current.applicationContext as MultiBrowserApplication
    val session = remember(panel.id) { app.browserEngine.session(panel.id, panel.contextId) }
    var address by remember(panel.id) { mutableStateOf(panel.url) }
    var menu by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }

    LaunchedEffect(panel.id) { session.loadUri(panel.url) }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = session::goBack, modifier = Modifier.size(40.dp)) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "رجوع") }
            IconButton(onClick = session::goForward, modifier = Modifier.size(40.dp)) { Icon(Icons.AutoMirrored.Filled.ArrowForward, "تقدم") }
            TextField(
                value = address,
                onValueChange = { address = it },
                singleLine = true,
                modifier = Modifier.weight(1f),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { val url = normalizeAddress(address); address = url; session.loadUri(url); viewModel.updatePage(panel.id, url) }),
                placeholder = { Text("رابط أو بحث") },
            )
            IconButton(onClick = session::reload, modifier = Modifier.size(40.dp)) { Icon(Icons.Default.Refresh, "تحديث") }
            Box {
                IconButton(onClick = { menu = true }, modifier = Modifier.size(40.dp)) { Icon(Icons.Default.MoreVert, "خيارات") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text("إخفاء") }, leadingIcon = { Icon(Icons.Default.VisibilityOff, null) }, onClick = { viewModel.hide(panel.id); menu = false })
                    DropdownMenuItem(text = { Text("مسح بيانات الصفحة") }, leadingIcon = { Icon(Icons.Default.CleaningServices, null) }, onClick = { viewModel.clearBrowser(panel); menu = false })
                    DropdownMenuItem(text = { Text("حذف نهائي") }, leadingIcon = { Icon(Icons.Default.Delete, null) }, onClick = { confirmDelete = true; menu = false })
                }
            }
        }
        AndroidView(
            factory = { context -> GeckoView(context).apply { setSession(session) } },
            modifier = Modifier.fillMaxSize(),
        )
    }
    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false },
        title = { Text("حذف الصفحة؟") },
        text = { Text("سيتم مسح الكوكيز والتخزين وتسجيل الدخول الخاص بهذه الصفحة وحدها نهائيًا.") },
        confirmButton = { TextButton(onClick = { viewModel.remove(panel); confirmDelete = false }) { Text("حذف") } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("إلغاء") } },
    )
}

@Composable
private fun MailPanel(panel: Panel, data: Pair<MailIdentity, List<MailMessage>>?, viewModel: MainViewModel) {
    val context = LocalContext.current
    LaunchedEffect(panel.id) { if (data == null) viewModel.refreshMail(panel.id) }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer).padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.Email, null)
            Text(data?.first?.address ?: "جاري إنشاء البريد...", Modifier.weight(1f).padding(horizontal = 8.dp), maxLines = 1)
            IconButton(onClick = { data?.first?.address?.let { copy(context, it) } }) { Icon(Icons.Default.ContentCopy, "نسخ العنوان") }
            IconButton(onClick = { viewModel.refreshMail(panel.id) }) { Icon(Icons.Default.Refresh, "تحديث") }
            IconButton(onClick = { viewModel.hide(panel.id) }) { Icon(Icons.Default.VisibilityOff, "إخفاء") }
            IconButton(onClick = { viewModel.remove(panel) }) { Icon(Icons.Default.Close, "حذف") }
        }
        if (data == null) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("يتم تجهيز صندوق مستقل وآمن") }
        else if (data.second.isEmpty()) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("لا توجد رسائل بعد") }
        else LazyColumn { items(data.second, key = { it.id }) { message ->
            Column(Modifier.fillMaxWidth().clickable { }.padding(12.dp)) {
                Text(message.subject.ifBlank { "بدون عنوان" }, style = MaterialTheme.typography.titleSmall)
                Text(message.from.address, color = Slate, style = MaterialTheme.typography.bodySmall)
                Text(message.intro, maxLines = 2, style = MaterialTheme.typography.bodySmall)
            }
        } }
        Button(onClick = { viewModel.refreshMail(panel.id, forceNew = true) }, Modifier.fillMaxWidth().padding(8.dp)) { Text("إنشاء بريد نظيف جديد") }
    }
}

@Composable private fun EmptyState(onAdd: () -> Unit) = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Column(horizontalAlignment = Alignment.CenterHorizontally) { Icon(Icons.Default.Public, null, Modifier.size(48.dp)); Spacer(Modifier.height(12.dp)); Text("لا توجد صفحات ظاهرة"); Button(onClick = onAdd) { Text("إضافة متصفح") } } }
private fun copy(context: Context, value: String) = (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("email", value))
private fun darkScheme() = androidx.compose.material3.darkColorScheme(primary = Blue, background = Navy, surface = Navy, onPrimary = Cloud, onBackground = Cloud, onSurface = Cloud)
private fun lightScheme() = androidx.compose.material3.lightColorScheme(primary = Blue, background = Cloud, surface = Cloud, onPrimary = Cloud, onBackground = Navy, onSurface = Navy)
