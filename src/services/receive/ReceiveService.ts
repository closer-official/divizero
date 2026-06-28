import type { ExtQueueItem, ExtQueueItemStatus } from './types'

declare global {
  interface Window {
    __OS_EXT_ID?: string
  }
}

export class ReceiveService {
  private getExtId(): string | undefined {
    // window.__OS_EXT_ID（旧方式）またはDOM属性（CSP対応方式）から取得
    return (
      window.__OS_EXT_ID ||
      document.documentElement.getAttribute('data-os-ext-id') ||
      undefined
    )
  }

  isAvailable(): boolean {
    const extId = this.getExtId()
    if (!extId) {
      console.log('[OS Ext RS] isAvailable=false: extId not found (data-os-ext-id attr:', document.documentElement.getAttribute('data-os-ext-id'), ')')
      return false
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const _chrome = (window as any).chrome
    const hasSendMessage = typeof _chrome?.runtime?.sendMessage === 'function'
    if (!hasSendMessage) {
      console.log('[OS Ext RS] isAvailable=false: chrome.runtime.sendMessage unavailable',
        'chrome:', typeof _chrome, 'runtime:', typeof _chrome?.runtime)
    } else {
      console.log('[OS Ext RS] isAvailable=true, extId:', extId)
    }
    return hasSendMessage
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sendMessage<T>(message: object): Promise<T> {
    return new Promise((resolve, reject) => {
      const extId = this.getExtId()
      if (!extId) { reject(new Error('Extension ID not found')); return }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _chrome = (window as any).chrome
      if (!_chrome?.runtime?.sendMessage) { reject(new Error('Chrome API unavailable')); return }

      _chrome.runtime.sendMessage(extId, message, (response: T) => {
        if (_chrome.runtime.lastError) {
          const err = _chrome.runtime.lastError.message || 'Unknown chrome error'
          console.warn('[OS Ext RS] sendMessage error:', err, 'type:', (message as any).type)
          reject(new Error(err))
        } else {
          resolve(response)
        }
      })
    })
  }

  async fetchQueue(): Promise<ExtQueueItem[]> {
    console.log('[OS Ext RS] fetchQueue start')
    const res = await this.sendMessage<{ items: ExtQueueItem[] }>({ type: 'get_queue' })
    console.log('[OS Ext RS] fetchQueue result, items:', res.items?.length ?? 0)
    return res.items ?? []
  }

  async updateStatus(id: string, status: ExtQueueItemStatus): Promise<void> {
    await this.sendMessage({
      type: 'update_status',
      id,
      status,
      processedAt: new Date().toISOString(),
    })
  }

  async clearHistory(): Promise<void> {
    await this.sendMessage({ type: 'clear_history' })
  }

  async ping(): Promise<string | null> {
    try {
      const res = await this.sendMessage<{ version: string }>({ type: 'ping' })
      return res.version
    } catch {
      return null
    }
  }
}
