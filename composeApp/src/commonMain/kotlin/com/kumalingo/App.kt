package com.kumalingo

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun App() {
    MaterialTheme(colors = lightColors(primary = Color(0xFFE96D63), background = Color(0xFFFAF8F5))) {
        Box(Modifier.fillMaxSize().background(MaterialTheme.colors.background).padding(24.dp), contentAlignment = Alignment.Center) {
            Surface(shape = RoundedCornerShape(24.dp), color = Color.White, modifier = Modifier.widthIn(max = 460.dp)) {
                Column(Modifier.padding(40.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                    Text("KumaLingo", color = MaterialTheme.colors.primary, fontSize = 30.sp)
                    Text("A little space for your Mandarin.", style = MaterialTheme.typography.h5)
                    Text("Keep the words you discover, understand their meaning, and make them your own.", color = Color(0xFF66615D))
                    Divider()
                    Text("Your private notebook", style = MaterialTheme.typography.subtitle1)
                    Text("Sign in with your invited Google account to continue.")
                    Button(onClick = {}, enabled = false, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                        Text("Continue with Google")
                    }
                    Text("Sign-in is temporarily unavailable.", style = MaterialTheme.typography.caption)
                }
            }
        }
    }
}
