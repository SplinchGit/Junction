package com.splinch.junction.feature.chat.ui

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import java.net.URI

/** Only HTTP(S) inline citations become links; code and all other text remain literal. */
internal fun citationText(source: String): AnnotatedString = buildAnnotatedString {
    var i = 0
    while (i < source.length) {
        if (source[i] == '`' || (source.startsWith("~~~", i) && (i == 0 || source[i - 1] == '\n'))) {
            val marker = source[i].toString().repeat(source.substring(i).takeWhile { it == source[i] }.length)
            val end = source.indexOf(marker, i + marker.length)
            val next = if (end < 0) source.length else end + marker.length
            append(source.substring(i, next)); i = next; continue
        }
        if (source[i] == '[' && (i == 0 || (source[i - 1] != '\\' && source[i - 1] != '!'))) {
            val labelEnd = source.indexOf("](", i + 1)
            if (labelEnd >= 0 && '\n' !in source.substring(i, labelEnd)) {
                var end = labelEnd + 2
                var depth = 1
                while (end < source.length && depth > 0 && source[end] != '\n') {
                    if (source[end] == '(') depth++
                    if (source[end] == ')') depth--
                    end++
                }
                if (depth == 0) {
                    val target = source.substring(labelEnd + 2, end - 1)
                    val uri = runCatching { URI(target) }.getOrNull()
                    if (uri != null && uri.scheme?.lowercase() in setOf("https", "http") && !uri.host.isNullOrBlank() && uri.userInfo == null) {
                        withLink(LinkAnnotation.Url(target, TextLinkStyles(style = SpanStyle(textDecoration = TextDecoration.Underline)))) {
                            append(source.substring(i + 1, labelEnd))
                        }
                        i = end; continue
                    }
                }
            }
        }
        append(source[i]); i++
    }
}
