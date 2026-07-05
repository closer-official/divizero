import { useState, useEffect, useCallback, useMemo } from 'react'
import { ReceiveService } from './ReceiveService'
import type { ExtQueueItem, ExtQueueItemStatus, OS0QueueItem, OS2TouchPayload } from './types'

export type OS2TouchQueueItem = ExtQueueItem & {
  type: 'os2_touch'
  payload: OS2TouchPayload
}

const POLL_INTERVAL_MS = 3000

export function useReceive() {
  const service = useMemo(() => new ReceiveService(), [])
  const [queue, setQueue] = useState<ExtQueueItem[]>([])
  const [connected, setConnected] = useState(false)

  const refresh = useCallback(async () => {
    const available = service.isAvailable()
    console.log('[OS Ext Hook] refresh called, isAvailable:', available)
    if (!available) {
      setConnected(false)
      return
    }
    try {
      const items = await service.fetchQueue()
      setQueue(items)
      setConnected(true)
    } catch (err) {
      console.warn('[OS Ext Hook] fetchQueue failed:', err)
      setConnected(false)
    }
  }, [service])

  useEffect(() => {
    refresh()

    // タブがフォーカスされた時（別アプリ→Chromeへ戻った時）
    window.addEventListener('focus', refresh)

    // タブが表示状態になった時（別タブ→このタブへ切り替えた時）
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[OS Ext Hook] visibilitychange → visible, refreshing')
        refresh()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    // id_shim.js が注入完了した時（拡張機能インストール後の初回ロードで遅れる場合の対策）
    const onExtReady = () => {
      console.log('[OS Ext Hook] os_ext_ready event received, refreshing')
      refresh()
    }
    window.addEventListener('os_ext_ready', onExtReady)

    // 定期ポーリング（tab.update での切り替えは focus/visibilitychange が発火しない場合がある）
    const poll = setInterval(refresh, POLL_INTERVAL_MS)

    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('os_ext_ready', onExtReady)
      clearInterval(poll)
    }
  }, [refresh])

  const applyStatusLocally = (id: string, status: ExtQueueItemStatus) => {
    setQueue(prev =>
      prev.map(item =>
        item.id === id
          ? { ...item, status, processedAt: new Date().toISOString() }
          : item
      )
    )
  }

  const markCompleted = useCallback(async (id: string) => {
    await service.updateStatus(id, 'completed')
    applyStatusLocally(id, 'completed')
  }, [service])

  const markDismissed = useCallback(async (id: string) => {
    await service.updateStatus(id, 'dismissed')
    applyStatusLocally(id, 'dismissed')
  }, [service])

  const restore = useCallback(async (id: string) => {
    await service.updateStatus(id, 'pending')
    setQueue(prev =>
      prev.map(item =>
        item.id === id
          ? { ...item, status: 'pending' as const, processedAt: undefined }
          : item
      )
    )
  }, [service])

  const clearHistory = useCallback(async () => {
    await service.clearHistory()
    setQueue(prev => prev.filter(item => item.status === 'pending'))
  }, [service])

  const pending    = queue.filter(i => i.status === 'pending')
  const history    = queue.filter(i => i.status !== 'pending')
  const os0Pending = pending.filter(i => i.type === 'os0_candidates') as OS0QueueItem[]
  const os0History = history.filter(i => i.type === 'os0_candidates') as OS0QueueItem[]
  const os2Pending = pending.filter(i => i.type === 'os2_touch') as OS2TouchQueueItem[]
  const os2History = history.filter(i => i.type === 'os2_touch') as OS2TouchQueueItem[]

  const setGeminiPrompt = useCallback(async (text: string) => {
    await service.setGeminiPrompt(text)
  }, [service])

  const setPipelineHandles = useCallback(async (handles: string[]) => {
    await service.setPipelineHandles(handles)
  }, [service])

  return {
    queue,
    pending,
    history,
    os0Pending,
    os0History,
    os2Pending,
    os2History,
    connected,
    refresh,
    markCompleted,
    markDismissed,
    restore,
    clearHistory,
    setGeminiPrompt,
    setPipelineHandles,
  }
}
