import type { BridgeRelay, DivizeroPingReport } from '../shared/protocol'

interface BridgeEnvelope<T = unknown> {
  source: 'salesos-ext' | 'salesos-app'
  type: string
  requestId: string
  payload: T
}

const GLOBAL_FLAG = '__salesosDivizeroInitialized'

if ((globalThis as typeof globalThis & Record<string, unknown>)[GLOBAL_FLAG]) {
  // Already initialized in this execution world.
} else {
  ;(globalThis as typeof globalThis & Record<string, unknown>)[GLOBAL_FLAG] = true

function makeRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function bridgeRequest(type: string, payload: unknown, timeoutMs = 10_000): Promise<unknown> {
  const requestId = makeRequestId()

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('BRIDGE_TIMEOUT'))
    }, timeoutMs)

    const onMessage = (event: MessageEvent<BridgeEnvelope>) => {
      if (event.source !== window) return
      if (event.origin !== location.origin) return
      if (event.data?.source !== 'salesos-app') return
      if (event.data.requestId !== requestId) return
      cleanup()
      resolve(event.data.payload)
    }

    const cleanup = () => {
      window.clearTimeout(timeout)
      window.removeEventListener('message', onMessage)
    }

    window.addEventListener('message', onMessage)
    const envelope: BridgeEnvelope = {
      source: 'salesos-ext',
      type,
      requestId,
      payload,
    }
    window.postMessage(envelope, location.origin)
  })
}

async function reportPing(): Promise<void> {
  try {
    const response = (await bridgeRequest('APP_PING', {})) as { version?: string } | undefined
    const report: DivizeroPingReport = {
      cmd: 'DIVIZERO_PING_REPORT',
      ok: true,
      version: response?.version,
    }
    await chrome.runtime.sendMessage(report)
  } catch (error) {
    const report: DivizeroPingReport = {
      cmd: 'DIVIZERO_PING_REPORT',
      ok: false,
      error: error instanceof Error ? error.message : 'APP_PING failed',
    }
    await chrome.runtime.sendMessage(report)
  }
}

void reportPing()

chrome.runtime.onMessage.addListener((message: BridgeRelay, _sender, sendResponse) => {
  if (message.cmd !== 'BRIDGE') return false

  void bridgeRequest(message.type, message.payload)
    .then(payload => sendResponse(payload))
    .catch(error => {
      sendResponse({
        ok: false,
        code: error instanceof Error ? error.message : 'BRIDGE_TIMEOUT',
      })
    })

  return true
})
}
