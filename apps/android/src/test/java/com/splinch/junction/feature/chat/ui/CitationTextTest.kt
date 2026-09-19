package com.splinch.junction.feature.chat.ui

import org.junit.Assert.*
import org.junit.Test

class CitationTextTest {
    @Test fun linksHaveReadableLabelsAndSafeTargets() {
        val result = citationText("See [source](https://example.org/page) now")
        assertEquals("See source now", result.text)
        assertEquals("https://example.org/page", result.getLinkAnnotations(4, 10).single().item.let { (it as androidx.compose.ui.text.LinkAnnotation.Url).url })
    }
    @Test fun codeAndUnsafeLinksStayLiteral() {
        val source = "`[code](https://example.org)` [bad](javascript:alert)\n```\n[x](https://example.org)\n```"
        val result = citationText(source)
        assertEquals(source, result.text)
        assertTrue(result.getLinkAnnotations(0, result.length).isEmpty())
    }
    @Test fun balancedParenthesesAndMultipleCitations() {
        val result = citationText("[one](https://example.org/a_(b)) [two](http://example.org)")
        assertEquals("one two", result.text)
        assertEquals(2, result.getLinkAnnotations(0, result.length).size)
    }
}
