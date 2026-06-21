package com.allowance.app

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper

class ServerDiscovery(context: Context) {

    companion object {
        private const val SERVICE_TYPE = "_allowance._tcp."
        private const val TIMEOUT_MS = 10_000L
    }

    private val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val handler = Handler(Looper.getMainLooper())
    private var isDiscovering = false
    private var timeoutRunnable: Runnable? = null

    private var discoveryListener: NsdManager.DiscoveryListener? = null

    fun discover(onFound: (String) -> Unit, onTimeout: () -> Unit) {
        if (isDiscovering) return

        val timeout = Runnable {
            stop()
            onTimeout()
        }
        timeoutRunnable = timeout
        handler.postDelayed(timeout, TIMEOUT_MS)

        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {
                isDiscovering = true
            }

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                nsdManager.resolveService(serviceInfo, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(si: NsdServiceInfo, errorCode: Int) {
                        // Ignore resolve failures — wait for another service or timeout
                    }

                    override fun onServiceResolved(si: NsdServiceInfo) {
                        val host = si.host?.hostAddress ?: return
                        val port = si.port
                        val url = "http://$host:$port"
                        handler.post {
                            handler.removeCallbacks(timeout)
                            stop()
                            onFound(url)
                        }
                    }
                })
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo) {}
            override fun onDiscoveryStopped(serviceType: String) {
                isDiscovering = false
            }
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                isDiscovering = false
                handler.post {
                    handler.removeCallbacks(timeout)
                    onTimeout()
                }
            }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                isDiscovering = false
            }
        }

        discoveryListener = listener
        nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
    }

    fun stop() {
        timeoutRunnable?.let { handler.removeCallbacks(it) }
        timeoutRunnable = null
        if (isDiscovering) {
            discoveryListener?.let {
                try {
                    nsdManager.stopServiceDiscovery(it)
                } catch (_: IllegalArgumentException) {
                    // Already stopped
                }
            }
        }
        discoveryListener = null
        isDiscovering = false
    }
}
