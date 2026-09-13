package com.splinch.junction.feature.mafioso.billing

import android.app.Activity
import android.net.Uri
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import org.json.JSONObject

/** Narrow Play Billing bridge exposed only by the Mafioso WebView. The server grants points. */
class MafiosoBillingBridge(
    private val activity: Activity,
    private val webView: WebView,
    private val trustedHost: String,
) {
    private val products = setOf(
        "mafioso_points_100", "mafioso_points_550", "mafioso_points_1200",
        "mafioso_points_2600", "mafioso_points_7000",
    )
    private val billingClient = BillingClient.newBuilder(activity)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .setListener { result, purchases ->
            if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                purchases.orEmpty().forEach(::dispatchPurchase)
            } else if (result.responseCode == BillingClient.BillingResponseCode.USER_CANCELED) {
                dispatch("cancelled", null, null, "Purchase cancelled")
            } else {
                dispatch("error", null, null, result.debugMessage)
            }
        }.build()

    init { connectAndRecover() }

    @JavascriptInterface
    fun purchase(productId: String) {
        if (!trustedPage() || productId !in products) return
        activity.runOnUiThread {
            ensureConnected {
                val query = QueryProductDetailsParams.newBuilder().setProductList(
                    listOf(QueryProductDetailsParams.Product.newBuilder().setProductId(productId).setProductType(BillingClient.ProductType.INAPP).build())
                ).build()
                billingClient.queryProductDetailsAsync(query) { result, details ->
                    val product = details.productDetailsList.firstOrNull()
                    if (result.responseCode != BillingClient.BillingResponseCode.OK || product == null) {
                        dispatch("error", productId, null, result.debugMessage.ifBlank { "Product is unavailable" }); return@queryProductDetailsAsync
                    }
                    val params = BillingFlowParams.newBuilder().setProductDetailsParamsList(
                        listOf(BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(product).build())
                    ).build()
                    billingClient.launchBillingFlow(activity, params)
                }
            }
        }
    }

    fun close() { billingClient.endConnection() }

    private fun connectAndRecover() = ensureConnected {
        billingClient.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build()) { result, purchases ->
            if (result.responseCode == BillingClient.BillingResponseCode.OK) purchases.forEach(::dispatchPurchase)
        }
    }

    private fun ensureConnected(block: () -> Unit) {
        if (billingClient.isReady) { block(); return }
        billingClient.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) block() else dispatch("error", null, null, result.debugMessage)
            }
            override fun onBillingServiceDisconnected() = Unit
        })
    }

    private fun dispatchPurchase(purchase: com.android.billingclient.api.Purchase) {
        val product = purchase.products.firstOrNull { it in products } ?: return
        when (purchase.purchaseState) {
            com.android.billingclient.api.Purchase.PurchaseState.PURCHASED -> dispatch("purchased", product, purchase.purchaseToken, null)
            com.android.billingclient.api.Purchase.PurchaseState.PENDING -> dispatch("pending", product, purchase.purchaseToken, "Purchase is pending")
            else -> dispatch("cancelled", product, null, "Purchase was not completed")
        }
    }

    private fun trustedPage(): Boolean {
        val uri = runCatching { Uri.parse(webView.url) }.getOrNull() ?: return false
        return uri.scheme == "https" && uri.host?.lowercase() == trustedHost
    }

    private fun dispatch(status: String, productId: String?, token: String?, message: String?) {
        if (!trustedPage()) return
        val payload = JSONObject().apply {
            put("status", status); put("productId", productId); put("purchaseToken", token); put("message", message)
        }.toString()
        webView.post { if (trustedPage()) webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('mafioso-billing',{detail:$payload}));", null) }
    }
}
