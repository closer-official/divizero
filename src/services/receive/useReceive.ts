import { useState, useEffect, useCallback, useMemo } from 'react'
import { ReceiveService } from './ReceiveService'
import type { ExtQueueItem, ExtQueueItemStatus, OS0QueueItem } from './types'

export function useReceive() {
  const service = useMemo(() => new ReceiveService(), [])
  const [queue, setQueue] = useState<ExtQueueItem[]>([])
  const [connected, setConnected] = useState(false)

  const refresh = useCallback(async () => {
    if (!service.isAvailable()) {
      setConnected(false)
      return
    }
    try {
      const items = await service.fetchQueue()
      setQueue(items)
      setConnected(true)
    } catch {
      setConnected(false)
    }
  }, [service])

  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
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

  return {
    queue,
    pending,
    history,
    os0Pending,
    os0History,
    connected,
    refresh,
    markCompleted,
    markDismissed,
    restore,
    clearHistory,
  }
}
