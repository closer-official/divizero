'use strict'

// Relay between extension background (chrome.tabs.sendMessage) and extensionBridge (window.postMessage)

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'webapp_bridge') return false

  const requestId = 'wab_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)
  let done = false

  const cleanup = () => window.removeEventListener('message', listener)

  const listener = (event) => {
    if (event.source !== window) return
    if (!event.data || event.data.source !== 'salesos-app') return
    if (event.data.requestId !== requestId) return
    if (done) return
    done = true
    cleanup()
    sendResponse({ ok: true, responseType: event.data.type, payload: event.data.payload })
  }

  window.addEventListener('message', listener)

  window.postMessage(
    { source: 'salesos-ext', type: message.bridgeType, requestId, payload: message.payload || {} },
    location.origin,
  )

  const timeoutMs = (typeof message.timeoutMs === 'number' && message.timeoutMs > 0)
    ? message.timeoutMs
    : 12000

  setTimeout(() => {
    if (!done) {
      done = true
      cleanup()
      sendResponse({ ok: false, error: 'timeout' })
    }
  }, timeoutMs)

  return true
})
