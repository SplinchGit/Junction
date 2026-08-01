package com.splinch.junction.feature.update

import java.io.IOException
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Version tracking, which is the part an owner has to be able to trust.
 *
 * Two ways this goes wrong and neither is visible from the outside: comparing the wrong
 * field, so no published build ever looks newer and the app never offers an update; and
 * reporting "up to date" when the check actually failed, which leaves someone sitting on
 * an old build convinced it is the current one.
 */
class UpdateCheckerTest {

    private fun checkerReturning(code: Int, body: String): UpdateChecker =
        UpdateChecker(
            OkHttpClient.Builder().addInterceptor { chain ->
                Response.Builder()
                    .request(chain.request())
                    .protocol(Protocol.HTTP_1_1)
                    .code(code)
                    .message("stubbed")
                    .body(body.toResponseBody("application/json".toMediaType()))
                    .build()
            }.build()
        )

    private fun checkerThatCannotConnect(): UpdateChecker =
        UpdateChecker(
            OkHttpClient.Builder().addInterceptor { throw IOException("no route to host") }.build()
        )

    private fun manifest(versionCode: Int, versionName: String = "0.5.0") = """
        {
          "versionCode": $versionCode,
          "versionName": "$versionName",
          "pageUrl": "https://splinchgit.github.io/Junction/",
          "apkUrl": "https://splinchgit.github.io/Junction/junction-debug.apk",
          "sha256Url": "https://splinchgit.github.io/Junction/junction-debug.apk.sha256"
        }
    """.trimIndent()

    @Test
    fun `a newer published build is offered`() = runTest {
        val result = checkerReturning(200, manifest(versionCode = 64)).check(currentVersionCode = 63)

        assertTrue(result is UpdateCheck.Available)
        val update = (result as UpdateCheck.Available).update
        assertEquals(64, update.versionCode)
        assertEquals("https://splinchgit.github.io/Junction/junction-debug.apk", update.apkUrl)
        assertEquals("https://splinchgit.github.io/Junction/junction-debug.apk.sha256", update.sha256Url)
    }

    @Test
    fun `the same build is not an update`() = runTest {
        val result = checkerReturning(200, manifest(versionCode = 63)).check(currentVersionCode = 63)

        assertEquals(UpdateCheck.UpToDate(63), result)
    }

    @Test
    fun `an older published build is not offered`() = runTest {
        // Can happen if a build is rolled back. Offering it would be a downgrade, which
        // Android refuses anyway.
        val result = checkerReturning(200, manifest(versionCode = 60)).check(currentVersionCode = 63)

        assertEquals(UpdateCheck.UpToDate(60), result)
    }

    @Test
    fun `version codes are compared, not version names`() = runTest {
        // versionName is a hand-edited string that has read "0.5.0" for hundreds of
        // builds. Comparing it meant no published build ever looked newer.
        val result = checkerReturning(200, manifest(versionCode = 70, versionName = "0.5.0"))
            .check(currentVersionCode = 69)

        assertTrue(result is UpdateCheck.Available)
    }

    @Test
    fun `a build with no name still gets a usable label`() = runTest {
        val body = """{"versionCode": 64, "apkUrl": "https://x/a.apk", "sha256Url": "https://x/a.sha256"}"""

        val result = checkerReturning(200, body).check(currentVersionCode = 63)

        assertEquals("build 64", (result as UpdateCheck.Available).update.version)
    }

    @Test
    fun `an unreachable manifest is a failure, not a clean bill of health`() = runTest {
        val result = checkerThatCannotConnect().check(currentVersionCode = 63)

        assertTrue("a network failure must never read as up to date", result is UpdateCheck.Failed)
    }

    @Test
    fun `an HTTP error is a failure`() = runTest {
        val result = checkerReturning(404, "not found").check(currentVersionCode = 63)

        assertTrue(result is UpdateCheck.Failed)
        assertTrue((result as UpdateCheck.Failed).reason.contains("404"))
    }

    @Test
    fun `a manifest that isn't JSON is a failure`() = runTest {
        val result = checkerReturning(200, "<html>404</html>").check(currentVersionCode = 63)

        // GitHub Pages serves an HTML error page for a missing file, so this is the shape
        // a mis-deployed manifest actually arrives in.
        assertTrue(result is UpdateCheck.Failed)
    }

    @Test
    fun `a manifest with no version code is a failure`() = runTest {
        val result = checkerReturning(200, """{"versionName": "0.5.0"}""").check(currentVersionCode = 63)

        assertTrue(result is UpdateCheck.Failed)
    }

    @Test
    fun `a plain-HTTP asset url is refused`() = runTest {
        val body = """
            {"versionCode": 64, "apkUrl": "http://splinchgit.github.io/Junction/junction-debug.apk",
             "sha256Url": "http://splinchgit.github.io/Junction/junction-debug.apk.sha256"}
        """.trimIndent()

        val result = checkerReturning(200, body).check(currentVersionCode = 63)

        // Downgraded to the release page rather than fetched: an APK over plain HTTP is
        // an APK anyone on the path can replace.
        val update = (result as UpdateCheck.Available).update
        assertNull(update.apkUrl)
        assertNull(update.sha256Url)
    }

    @Test
    fun `the background check still collapses to a nullable update`() = runTest {
        // What MainActivity's silent check uses; it must agree with check().
        val offered = checkerReturning(200, manifest(64)).checkForUpdate(currentVersionCode = 63)
        val none = checkerReturning(200, manifest(63)).checkForUpdate(currentVersionCode = 63)

        assertEquals(64, offered?.versionCode)
        assertNull(none)
    }
}
