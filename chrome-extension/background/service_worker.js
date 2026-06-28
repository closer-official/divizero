'use strict'

const QUEUE_KEY = 'os_ext_queue'
const VERSION = '1.0.0'
const DEFAULT_WEBAPP_URL = 'https://divizero.vercel.app'

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

async function getWebappUrl() {
  const result = await chrome.storage.local.get(['webappUrl'])
  return (result.webappUrl || DEFAULT_WEBAPP_URL).replace(/\/$/, '')
}

async function openOrFocusWebapp() {
  const webappUrl = await getWebappUrl()
  const allTabs = await chrome.tabs.query({})
  const existing = allTabs.find(tab => tab.url && tab.url.startsWith(webappUrl))
  if (existing && existing.id != null) {
    await chrome.tabs.update(existing.id, { active: true })
    if (existing.windowId != null) {
      await chrome.windows.update(existing.windowId, { focused: true })
    }
    return
  }
  await chrome.tabs.create({ url: webappUrl })
}

// ── コンテンツスクリプトからの受信（enqueue）──────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'enqueue') return false

  console.log('[OS Ext BG] enqueue received, itemType:', message.itemType,
    'accounts:', message.payload?.accounts?.length ?? '?')

  const item = {
    id: genId(),
    type: message.itemType,
    status: 'pending',
    payload: message.payload,
    enqueuedAt: new Date().toISOString(),
  }

  chrome.storage.local.get([QUEUE_KEY], result => {
    const queue = result[QUEUE_KEY] || []
    queue.push(item)
    chrome.storage.local.set({ [QUEUE_KEY]: queue }, () => {
      console.log('[OS Ext BG] saved to storage, queue length:', queue.length, 'item id:', item.id)
      openOrFocusWebapp()
      sendResponse({ ok: true, id: item.id })
    })
  })

  return true // async response
})

// ── webappからの外部メッセージ（externally_connectable）────────

chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {

  if (message.type === 'ping') {
    sendResponse({ version: VERSION })
    return
  }

  if (message.type === 'get_queue') {
    chrome.storage.local.get([QUEUE_KEY], result => {
      const items = result[QUEUE_KEY] || []
      console.log('[OS Ext BG] get_queue responded, items:', items.length)
      sendResponse({ items })
    })
    return true
  }

  if (message.type === 'update_status') {
    chrome.storage.local.get([QUEUE_KEY], result => {
      const queue = (result[QUEUE_KEY] || []).map(item => {
        if (item.id !== message.id) return item
        return {
          ...item,
          status: message.status,
          processedAt: message.processedAt || new Date().toISOString(),
        }
      })
      chrome.storage.local.set({ [QUEUE_KEY]: queue }, () => {
        sendResponse({ ok: true })
      })
    })
    return true
  }

  if (message.type === 'clear_history') {
    chrome.storage.local.get([QUEUE_KEY], result => {
      const queue = (result[QUEUE_KEY] || []).filter(item => item.status === 'pending')
      chrome.storage.local.set({ [QUEUE_KEY]: queue }, () => {
        sendResponse({ ok: true })
      })
    })
    return true
  }
})
