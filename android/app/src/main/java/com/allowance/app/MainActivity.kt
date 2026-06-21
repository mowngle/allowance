package com.allowance.app

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        if (savedInstanceState == null) {
            showDiscovery()
        }
    }

    fun showDiscovery() {
        supportFragmentManager.beginTransaction()
            .replace(R.id.container, DiscoveryFragment())
            .commit()
    }

    fun showWebView(url: String) {
        supportFragmentManager.beginTransaction()
            .replace(R.id.container, WebViewFragment.newInstance(url))
            .commit()
    }

    @Deprecated("Use the new onBackPressed dispatcher", ReplaceWith("onBackPressedDispatcher"))
    override fun onBackPressed() {
        val webViewFragment = supportFragmentManager.findFragmentById(R.id.container)
        if (webViewFragment is WebViewFragment && webViewFragment.canGoBack()) {
            webViewFragment.goBack()
        }
        // At webview root or on discovery screen: do nothing (don't exit app)
    }
}
