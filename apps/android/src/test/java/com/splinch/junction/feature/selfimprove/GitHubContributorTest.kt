package com.splinch.junction.feature.selfimprove

import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class GitHubContributorTest {
    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `a missing token is rejected before any GitHub request`() = runTest {
        val result = GitHubContributor(token = "").verifyToken()

        assertTrue(result.isFailure)
        assertEquals("No GitHub token is stored.", result.exceptionOrNull()?.message)
    }

    @Test
    fun `proposal rejects protected workflow paths before writing`() = runTest {
        val result = GitHubContributor(token = "token", apiBase = apiBase()).proposeChange(
            changes = listOf(SourceChange(".github/workflows/android-build.yml", "contents")),
            commitMessage = "Change workflow",
            description = "Unsafe"
        )

        assertEquals("Junction cannot change workflows, signing material, or secret configuration.", (result as ContributionResult.Failed).reason)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `token verification checks both account and fixed Junction repository`() = runTest {
        server.enqueue(MockResponse().setBody("""{"login":"splinch"}"""))
        server.enqueue(MockResponse().setBody("""{"full_name":"SplinchGit/Junction"}"""))

        val result = GitHubContributor(token = "token", apiBase = apiBase()).verifyToken()

        assertEquals("splinch", result.getOrThrow())
        assertEquals("/user", server.takeRequest().path)
        assertEquals("/repos/SplinchGit/Junction", server.takeRequest().path)
    }

    @Test
    fun `source reader lists and reads only tracked safe files`() = runTest {
        server.enqueue(MockResponse().setBody("""
            {"tree":[
              {"path":"apps/android/src/main/java/Foo.kt","type":"blob"},
              {"path":"apps/android/debug.keystore","type":"blob"},
              {"path":"README.md","type":"blob"}
            ]}
        """.trimIndent()))
        server.enqueue(MockResponse().setBody("""{"encoding":"base64","content":"ZnVuIGdyZWV0KCkgPSAiaGki"}"""))
        val contributor = GitHubContributor(token = "token", apiBase = apiBase())

        val index = contributor.listSource("apps/android/src").getOrThrow()
        val source = contributor.readSource("apps/android/src/main/java/Foo.kt").getOrThrow()

        assertEquals(listOf("apps/android/src/main/java/Foo.kt"), index.paths)
        assertEquals("fun greet() = \"hi\"", source.content)
        assertEquals("/repos/SplinchGit/Junction/git/trees/main?recursive=1", server.takeRequest().path)
        assertEquals("/repos/SplinchGit/Junction/contents/apps/android/src/main/java/Foo.kt?ref=main", server.takeRequest().path)
    }

    @Test
    fun `source reader refuses signing material before a request`() = runTest {
        val result = GitHubContributor(token = "token", apiBase = apiBase()).readSource("apps/android/debug.keystore")

        assertTrue(result.isFailure)
        assertEquals(0, server.requestCount)
    }
    @Test
    fun `only Junction managed branches are eligible to merge`() = runTest {
        server.enqueue(MockResponse().setBody("""
            {"number":7,"html_url":"https://github.com/SplinchGit/Junction/pull/7","state":"open","merged":false,"mergeable":true,
             "head":{"ref":"feature/other","sha":"headsha"},"base":{"ref":"main"}}
        """.trimIndent()))
        server.enqueue(MockResponse().setBody("""{"check_runs":[{"status":"completed","conclusion":"success"}]}"""))

        val status = GitHubContributor(token = "token", httpClient = OkHttpClient(), apiBase = apiBase())
            .pullRequestStatus(7)
            .getOrThrow()

        assertFalse(status.isJunctionProposal)
        assertFalse(status.canMerge)
        assertTrue(status.detail.contains("not a Junction-managed branch"))
    }

    @Test
    fun `source operations can target an owner approved repository without changing the default`() = runTest {
        server.enqueue(MockResponse().setBody("""{"tree":[{"path":"README.md","type":"blob"}]}"""))
        val contributor = GitHubContributor(token = "token", apiBase = apiBase(), repositoryFullName = "owner/project")
        val index = contributor.listSource().getOrThrow()
        assertEquals("owner/project", index.repository)
        assertEquals("/repos/owner/project/git/trees/main?recursive=1", server.takeRequest().path)
    }
    private fun apiBase(): String = server.url("").toString().removeSuffix("/")
}
