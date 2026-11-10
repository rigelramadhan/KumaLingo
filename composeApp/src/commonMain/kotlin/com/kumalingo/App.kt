package com.kumalingo

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontFamily
import org.jetbrains.compose.resources.Font
import com.kumalingo.resources.Res
import com.kumalingo.resources.kumalingo_sc_regular

@Composable
fun NotebookApp(client: NotebookClient) {
    val state by client.state.collectAsState()
    val font = if (state.status == "ready") FontFamily(Font(Res.font.kumalingo_sc_regular)) else FontFamily.Default
    MaterialTheme(colors = lightColors(primary = Color(0xFFE96D63), background = Color(0xFFFAF8F5), onBackground = Color(0xFF342E2B), onSurface = Color(0xFF342E2B)), typography = Typography(defaultFontFamily = font)) {
        if (state.status == "ready") NotebookScreen(client, state) else LoginScreen(client, state)
    }
}

@Composable
private fun LoginScreen(client: NotebookClient, state: ClientState) {
        Box(Modifier.fillMaxSize().background(MaterialTheme.colors.background).padding(24.dp), contentAlignment = Alignment.Center) {
            Surface(shape = RoundedCornerShape(24.dp), color = Color.White, modifier = Modifier.widthIn(max = 460.dp)) {
                Column(Modifier.padding(40.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                    Text("KumaLingo", color = MaterialTheme.colors.primary, fontSize = 30.sp)
                    Text("A little space for your Mandarin.", style = MaterialTheme.typography.h5)
                    Text("Keep the words you discover, understand their meaning, and make them your own.", color = Color(0xFF66615D))
                    Divider()
                    Text("Your private notebook", style = MaterialTheme.typography.subtitle1)
                    Text("Sign in with your invited Google account to continue.")
                    if (state.status == "loading") LinearProgressIndicator(Modifier.fillMaxWidth())
                    Button(onClick = { client.dispatch(Command("sign-in")) }, enabled = state.status in listOf("signedOut", "blocked") && !state.busy, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                        Text(if (state.busy) "Connecting…" else "Continue with Google")
                    }
                    if (state.status == "unconfigured") Text("Sign-in is temporarily unavailable.", style = MaterialTheme.typography.caption)
                    state.error?.let { Text(it, color = MaterialTheme.colors.error) }
                }
            }
        }
}
