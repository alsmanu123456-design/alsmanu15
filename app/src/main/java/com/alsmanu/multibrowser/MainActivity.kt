package com.alsmanu.multibrowser

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.unit.LayoutDirection.Rtl
import androidx.compose.ui.platform.LocalLayoutDirection
import com.alsmanu.multibrowser.ui.MultiBrowserScreen

class MainActivity : ComponentActivity() {
    private val viewModel by viewModels<MainViewModel>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val state by viewModel.state.collectAsState()
            val mail by viewModel.mail.collectAsState()
            CompositionLocalProvider(LocalLayoutDirection provides Rtl) {
                MultiBrowserScreen(viewModel, state, mail)
            }
        }
    }
}
