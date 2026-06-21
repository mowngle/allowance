package com.allowance.app

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.fragment.app.Fragment

class DiscoveryFragment : Fragment() {

    private var discovery: ServerDiscovery? = null

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View = inflater.inflate(R.layout.fragment_discovery, container, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        val spinner = view.findViewById<ProgressBar>(R.id.spinner)
        val statusText = view.findViewById<TextView>(R.id.statusText)
        val retryButton = view.findViewById<Button>(R.id.retryButton)
        val manualLabel = view.findViewById<TextView>(R.id.manualLabel)
        val manualInput = view.findViewById<EditText>(R.id.manualInput)
        val connectButton = view.findViewById<Button>(R.id.connectButton)

        retryButton.setOnClickListener {
            spinner.visibility = View.VISIBLE
            statusText.text = getString(R.string.discovery_searching)
            retryButton.visibility = View.GONE
            manualLabel.visibility = View.GONE
            manualInput.visibility = View.GONE
            connectButton.visibility = View.GONE
            startDiscovery()
        }

        connectButton.setOnClickListener {
            val input = manualInput.text.toString().trim()
            if (input.isEmpty()) {
                Toast.makeText(requireContext(), "Please enter a server address", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val url = if (input.startsWith("http")) input else "http://$input"
            Toast.makeText(requireContext(), "Connecting to $url", Toast.LENGTH_SHORT).show()
            (activity as? MainActivity)?.showWebView(url)
        }

        startDiscovery()
    }

    private fun startDiscovery() {
        discovery?.stop()
        discovery = ServerDiscovery().apply {
            discover(
                onFound = { url ->
                    (activity as? MainActivity)?.showWebView(url)
                },
                onTimeout = {
                    view?.let { v ->
                        v.findViewById<ProgressBar>(R.id.spinner).visibility = View.GONE
                        v.findViewById<TextView>(R.id.statusText).text =
                            getString(R.string.discovery_failed)
                        v.findViewById<Button>(R.id.retryButton).visibility = View.VISIBLE
                        v.findViewById<TextView>(R.id.manualLabel).visibility = View.VISIBLE
                        v.findViewById<EditText>(R.id.manualInput).visibility = View.VISIBLE
                        v.findViewById<Button>(R.id.connectButton).visibility = View.VISIBLE
                    }
                }
            )
        }
    }

    override fun onDestroyView() {
        discovery?.stop()
        discovery = null
        super.onDestroyView()
    }
}
