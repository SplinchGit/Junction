package com.splinch.junction.feature.mafioso.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.splinch.junction.feature.mafioso.billing.MafiosoBillingBridge

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun MafiosoScreen(url: String, modifier: Modifier = Modifier) {
    var webView by remember { mutableStateOf<WebView?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var billingBridge by remember { mutableStateOf<MafiosoBillingBridge?>(null) }

    if (!url.startsWith("https://")) {
        Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(
                text = "Mafioso is waiting for its AWS deployment.",
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.padding(24.dp)
            )
        }
        return
    }

    val trustedHost = remember(url) { Uri.parse(url).host.orEmpty().lowercase() }

    BackHandler(enabled = webView?.canGoBack() == true) { webView?.goBack() }

    Box(modifier = modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { context ->
                WebView(context).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.allowFileAccess = false
                    settings.allowContentAccess = false
                    settings.javaScriptCanOpenWindowsAutomatically = false
                    settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                    settings.setSupportMultipleWindows(false)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        settings.safeBrowsingEnabled = true
                    }
                    CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
                    val activity = context as? android.app.Activity
                    if (activity != null) {
                        billingBridge = MafiosoBillingBridge(activity, this, trustedHost)
                        addJavascriptInterface(billingBridge!!, "MafiosoBilling")
                    }
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                            val destination = request?.url ?: return true
                            val isTrusted = destination.scheme == "https" && destination.host?.lowercase() == trustedHost
                            if (isTrusted) return false

                            if (destination.scheme == "https") {
                                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, destination)) }
                            }
                            return true
                        }

                        override fun onPageStarted(view: WebView?, pageUrl: String?, favicon: Bitmap?) {
                            loading = true
                            error = null
                        }

                        override fun onPageFinished(view: WebView?, pageUrl: String?) {
                            loading = false
                        }

                        override fun onReceivedError(
                            view: WebView?,
                            request: WebResourceRequest?,
                            resourceError: WebResourceError?
                        ) {
                            if (request?.isForMainFrame == true) {
                                loading = false
                                error = resourceError?.description?.toString() ?: "Mafioso could not load."
                            }
                        }
                    }
                    webChromeClient = object : android.webkit.WebChromeClient() {
                        override fun onPermissionRequest(request: PermissionRequest?) {
                            request?.deny()
                        }
                    }
                    loadUrl(url)
                    webView = this
                }
            },
            update = { view ->
                if (view.url != url && !view.canGoBack()) view.loadUrl(url)
            }
        )

        if (loading) {
            CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
        }
        error?.let { message ->
            Column(modifier = Modifier.align(Alignment.Center).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(text = message, color = MaterialTheme.colorScheme.error)
                Spacer(modifier = Modifier.height(12.dp))
                Button(onClick = { error = null; loading = true; webView?.reload() }) { Text("Try again") }
            }
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            billingBridge?.close()
            billingBridge = null
            webView?.stopLoading()
            webView?.destroy()
            webView = null
        }
    }
}
