import type { ExtQueueItem, ExtQueueItemStatus, GeminiPromptMeta } from './types'

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
      return false
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const _chrome = (window as any).chrome
    const hasSendMessage = typeof _chrome?.runtime?.sendMessage === 'function'
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
          reject(new Error(err))
        } else {
          resolve(response)
        }
      })
    })
  }

  async fetchQueue(): Promise<ExtQueueItem[]> {
    const res = await this.sendMessage<{ items: ExtQueueItem[] }>({ type: 'get_queue' })
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

  async ping(): Promise<string | null> {
    try {
      const res = await this.sendMessage<{ version: string }>({ type: 'ping' })
      return res.version
    } catch {
      return null
    }
  }

  async setGeminiPrompt(text: string, meta?: GeminiPromptMeta | null): Promise<void> {
    await this.sendMessage({ type: 'set_gemini_prompt', text, meta })
  }

  async setPipelineHandles(handles: string[]): Promise<void> {
    await this.sendMessage({ type: 'set_pipeline_handles', handles })
  }
}
