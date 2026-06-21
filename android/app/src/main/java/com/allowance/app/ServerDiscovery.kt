package com.allowance.app

import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket

class ServerDiscovery {

    companion object {
        private const val BEACON_PORT = 41234
        private const val TIMEOUT_MS = 10_000L
    }

    private val handler = Handler(Looper.getMainLooper())
    private var timeoutRunnable: Runnable? = null
    private var socket: DatagramSocket? = null
    private var listenerThread: Thread? = null
    private var stopped = false

    fun discover(onFound: (String) -> Unit, onTimeout: () -> Unit) {
        stopped = false

        val timeout = Runnable {
            stop()
            onTimeout()
        }
        timeoutRunnable = timeout
        handler.postDelayed(timeout, TIMEOUT_MS)

        listenerThread = Thread listener@{
            try {
                val sock = DatagramSocket(BEACON_PORT)
                sock.soTimeout = (TIMEOUT_MS + 1_000).toInt()
                socket = sock

                val buf = ByteArray(512)
                val packet = DatagramPacket(buf, buf.size)

                while (!stopped) {
                    try {
                        sock.receive(packet)
                        val json = String(packet.data, 0, packet.length)
                        val obj = JSONObject(json)
                        if (obj.optString("service") == "allowance") {
                            val port = obj.getInt("port")
                            val host = packet.address.hostAddress
                            val url = "http://$host:$port"
                            handler.post {
                                handler.removeCallbacks(timeout)
                                stop()
                                onFound(url)
                            }
                            return@listener
                        }
                    } catch (_: java.net.SocketTimeoutException) {
                        break
                    }
                }
            } catch (_: Exception) {
                // Socket closed or other error — timeout will handle it
            }
        }.also { it.isDaemon = true; it.start() }
    }

    fun stop() {
        stopped = true
        timeoutRunnable?.let { handler.removeCallbacks(it) }
        timeoutRunnable = null
        try { socket?.close() } catch (_: Exception) {}
        socket = null
        listenerThread = null
    }
}
