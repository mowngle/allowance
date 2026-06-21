package com.allowance.app

import android.annotation.SuppressLint
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
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

        webView = view.findViewById<WebView>(R.id.webView).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setSupportMultipleWindows(false)

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

    fun canGoBack(): Boolean = webView?.canGoBack() == true

    fun goBack() { webView?.goBack() }

    override fun onDestroyView() {
        webView?.destroy()
        webView = null
        super.onDestroyView()
    }
}
