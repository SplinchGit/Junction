package com.splinch.junction.feature.calculator

import com.splinch.junction.data.preference.UserPrefsRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

data class Listing(
    val title: String,
    val price: Double,
    val currency: String,
    val condition: String,
    val itemWebUrl: String,
    val seller: String
)

data class BuildCategoryRequest(
    val options: List<String>,
    val rank: Map<String, Double>? = null
)

data class SuggestBuildRequest(
    val categories: Map<String, BuildCategoryRequest>,
    val comparableQuery: String,
    val fallbackSalePrice: Double,
    val feePct: Double
)

data class BuildPick(
    val option: String,
    val price: Double,
    val itemWebUrl: String,
    val title: String
)

data class RecommendedSalePrice(
    val value: Double,
    val source: String,
    val sampleSize: Int
)

data class SuggestedBuild(
    val picks: Map<String, BuildPick>,
    val totalCost: Double,
    val recommendedSalePrice: RecommendedSalePrice,
    val feePct: Double,
    val feeAmount: Double,
    val netProfit: Double,
    val margin: Double,
    val roi: Double
)

/**
 * Talks to the PC-side build-calculator daemon (services/build-calculator) over LAN.
 * Mirrors RealtimeSdpService's shape: reads its target endpoint from prefs on every
 * call (the backend URL changes between USB tethering and hotspot setups), OkHttp on
 * Dispatchers.IO, org.json for bodies -- same stack the rest of the app uses.
 */
class CalculatorClient(
    private val prefs: UserPrefsRepository,
    private val httpClient: OkHttpClient = OkHttpClient()
) {
    private suspend fun baseUrl(): Result<String> {
        val url = prefs.calculatorBackendUrlFlow.first().trim().trimEnd('/')
        if (url.isBlank()) {
            return Result.failure(IllegalStateException("Build calculator backend URL is not configured"))
        }
        return Result.success(url)
    }

    suspend fun checkHealth(): Result<Boolean> = withContext(Dispatchers.IO) {
        val base = baseUrl().getOrElse { return@withContext Result.failure(it) }
        runCatching {
            val request = Request.Builder().url("$base/health").get().build()
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw IllegalStateException("Health check failed: ${response.code}")
                val json = JSONObject(response.body?.string().orEmpty())
                json.optBoolean("ebayConfigured", false)
            }
        }
    }

    suspend fun searchListings(query: String, limit: Int = 20): Result<List<Listing>> =
        withContext(Dispatchers.IO) {
            val base = baseUrl().getOrElse { return@withContext Result.failure(it) }
            runCatching {
                val payload = JSONObject().put("query", query).put("limit", limit)
                val body = payload.toString().toRequestBody("application/json".toMediaType())
                val request = Request.Builder().url("$base/price/search").post(body).build()
                httpClient.newCall(request).execute().use { response ->
                    val text = response.body?.string().orEmpty()
                    if (!response.isSuccessful) {
                        val error = runCatching { JSONObject(text).optString("error") }.getOrNull()
                        throw IllegalStateException(error?.takeIf { it.isNotBlank() } ?: "Search failed: ${response.code}")
                    }
                    val listingsJson = JSONObject(text).getJSONArray("listings")
                    parseListings(listingsJson)
                }
            }
        }

    suspend fun suggestBuild(request: SuggestBuildRequest): Result<SuggestedBuild> =
        withContext(Dispatchers.IO) {
            val base = baseUrl().getOrElse { return@withContext Result.failure(it) }
            runCatching {
                val categoriesJson = JSONObject()
                request.categories.forEach { (name, category) ->
                    val categoryJson = JSONObject()
                    categoryJson.put("options", JSONArray(category.options))
                    category.rank?.let { rank ->
                        val rankJson = JSONObject()
                        rank.forEach { (option, value) -> rankJson.put(option, value) }
                        categoryJson.put("rank", rankJson)
                    }
                    categoriesJson.put(name, categoryJson)
                }
                val payload = JSONObject()
                    .put("categories", categoriesJson)
                    .put("comparableQuery", request.comparableQuery)
                    .put("fallbackSalePrice", request.fallbackSalePrice)
                    .put("feePct", request.feePct)

                val body = payload.toString().toRequestBody("application/json".toMediaType())
                val httpRequest = Request.Builder().url("$base/suggest/build").post(body).build()
                httpClient.newCall(httpRequest).execute().use { response ->
                    val text = response.body?.string().orEmpty()
                    if (!response.isSuccessful) {
                        val error = runCatching { JSONObject(text).optString("error") }.getOrNull()
                        throw IllegalStateException(error?.takeIf { it.isNotBlank() } ?: "Suggestion failed: ${response.code}")
                    }
                    parseSuggestedBuild(JSONObject(text))
                }
            }
        }

    private fun parseListings(array: JSONArray): List<Listing> {
        return (0 until array.length()).map { i ->
            val obj = array.getJSONObject(i)
            Listing(
                title = obj.optString("title"),
                price = obj.optDouble("price", 0.0),
                currency = obj.optString("currency"),
                condition = obj.optString("condition"),
                itemWebUrl = obj.optString("itemWebUrl"),
                seller = obj.optString("seller")
            )
        }
    }

    private fun parseSuggestedBuild(json: JSONObject): SuggestedBuild {
        val picksJson = json.getJSONObject("picks")
        val picks = picksJson.keys().asSequence().associateWith { key ->
            val pickJson = picksJson.getJSONObject(key)
            BuildPick(
                option = pickJson.optString("option"),
                price = pickJson.optDouble("price", 0.0),
                itemWebUrl = pickJson.optString("itemWebUrl"),
                title = pickJson.optString("title")
            )
        }
        val saleJson = json.getJSONObject("recommendedSalePrice")
        return SuggestedBuild(
            picks = picks,
            totalCost = json.optDouble("totalCost", 0.0),
            recommendedSalePrice = RecommendedSalePrice(
                value = saleJson.optDouble("value", 0.0),
                source = saleJson.optString("source"),
                sampleSize = saleJson.optInt("sampleSize", 0)
            ),
            feePct = json.optDouble("feePct", 0.0),
            feeAmount = json.optDouble("feeAmount", 0.0),
            netProfit = json.optDouble("netProfit", 0.0),
            margin = json.optDouble("margin", 0.0),
            roi = json.optDouble("roi", 0.0)
        )
    }
}
