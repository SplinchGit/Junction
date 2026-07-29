package com.splinch.junction.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// Modest bump over Material3 stock sizes (bodyLarge 16sp -> 17sp, etc.) so text
// fields and body copy don't read as cramped — OutlinedTextField's default
// content text style comes from bodyLarge, so this alone enlarges every text
// field in the app.
val JunctionTypography = Typography(
    bodyLarge = TextStyle(fontSize = 17.sp, lineHeight = 24.sp, fontWeight = FontWeight.Normal),
    bodyMedium = TextStyle(fontSize = 15.sp, lineHeight = 22.sp, fontWeight = FontWeight.Normal),
    bodySmall = TextStyle(fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Normal),
    labelLarge = TextStyle(fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium),
    labelMedium = TextStyle(fontSize = 13.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium),
    labelSmall = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium),
    titleLarge = TextStyle(fontSize = 24.sp, lineHeight = 30.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontSize = 18.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold),
    titleSmall = TextStyle(fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium)
)
