package com.allowance.app

import android.annotation.SuppressLint
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.fragment.app.Fragment

class WebViewFragment : Fragment() {

    companion object {
        private const val ARG_URL = "url"

        fun newInstance(url: String): WebViewFragment {
            return WebViewFragment().apply {
                arguments = Bundle().apply { putString(ARG_URL, url) }
            }
        }
    }

    private var webView: WebView? = null
    private var serverOrigin: String = ""

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View {
        val view = inflater.inflate(R.layout.fragment_webview, container, false)
        val url = arguments?.getString(ARG_URL) ?: return view
        val uri = Uri.parse(url)
        serverOrigin = "${uri.scheme}://${uri.host}:${uri.port}"

        // The device-claim session lives in a persistent cookie. WebView keeps
        // cookies in an in-memory store and only writes them to disk on flush();
        // on Fire tablets the app process is routinely killed when backgrounded,
        // so without an explicit flush the session cookie is lost and every
        // relaunch lands back on /claim. Accept cookies and flush them below.
        CookieManager.getInstance().setAcceptCookie(true)

        webView = view.findViewById<WebView>(R.id.webView).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setSupportMultipleWindows(false)

            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

            setOnLongClickListener { true }
            isLongClickable = false

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView, request: WebResourceRequest
                ): Boolean {
                    val reqUri = request.url
                    val reqOrigin = "${reqUri.scheme}://${reqUri.host}:${reqUri.port}"
                    return reqOrigin != serverOrigin
                }

                override fun onPageFinished(view: WebView, url: String) {
                    // Persist any cookie just set (e.g. the session cookie after
                    // claiming) so it survives the app process being killed.
                    CookieManager.getInstance().flush()
                }

                override fun onReceivedError(
                    view: WebView, request: WebResourceRequest, error: WebResourceError
                ) {
                    if (request.isForMainFrame) {
                        (activity as? MainActivity)?.showDiscovery()
                    }
                }
            }

            loadUrl(url)
        }

        return view
    }

    override fun onPause() {
        super.onPause()
        // Safety net: write cookies to disk before the app can be backgrounded
        // and its process reclaimed.
        CookieManager.getInstance().flush()
    }

    fun canGoBack(): Boolean = webView?.canGoBack() == true

    fun goBack() { webView?.goBack() }

    override fun onDestroyView() {
        webView?.destroy()
        webView = null
        super.onDestroyView()
    }
}
