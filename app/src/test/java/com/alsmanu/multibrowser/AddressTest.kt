package com.alsmanu.multibrowser

import com.alsmanu.multibrowser.data.normalizeAddress
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AddressTest {
    @Test fun keepsHttpsUrls() = assertEquals("https://example.com/a", normalizeAddress("https://example.com/a"))
    @Test fun addsHttpsToHosts() = assertEquals("https://example.com", normalizeAddress("example.com"))
    @Test fun turnsTextIntoSearch() = assertTrue(normalizeAddress("بحث جديد").startsWith("https://www.google.com/search?q="))
    @Test fun blankOpensHome() = assertEquals("https://www.google.com", normalizeAddress("  "))
}
