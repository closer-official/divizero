'use strict'

const QUEUE_KEY = 'os_ext_queue'
const DEFAULT_WEBAPP_URL = 'https://divizero.vercel.app'

const dot = document.getElementById('dot')
const pendingCount = document.getElementById('pendingCount')
const webappUrlInput = document.getElementById('webappUrl')
const saveBtn = document.getElementById('saveBtn')
const openBtn = document.getElementById('openBtn')
const msg = document.getElementById('msg')

function showMsg(text, color) {
  msg.textContent = text
  msg.style.color = color || '#22c55e'
  setTimeout(() => { msg.textContent = '' }, 2000)
}

async function init() {
  const stored = await chrome.storage.local.get([QUEUE_KEY, 'webappUrl'])
  const queue = stored[QUEUE_KEY] || []
  const url = stored.webappUrl || DEFAULT_WEBAPP_URL

  webappUrlInput.value = url

  const pending = queue.filter(item => item.status === 'pending').length
  pendingCount.textContent = String(pending)

  if (pending > 0) {
    dot.classList.add('active')
  }
}

saveBtn.addEventListener('click', async () => {
  const url = webappUrlInput.value.trim()
  if (!url) return
  await chrome.storage.local.set({ webappUrl: url })
  showMsg('保存しました', '#22c55e')
})

openBtn.addEventListener('click', async () => {
  const stored = await chrome.storage.local.get(['webappUrl'])
  const url = (stored.webappUrl || DEFAULT_WEBAPP_URL).replace(/\/$/, '')
  const allTabs = await chrome.tabs.query({})
  const existing = allTabs.find(tab => tab.url && tab.url.startsWith(url))
  if (existing && existing.id != null) {
    await chrome.tabs.update(existing.id, { active: true })
    if (existing.windowId != null) {
      await chrome.windows.update(existing.windowId, { focused: true })
    }
  } else {
    await chrome.tabs.create({ url })
  }
  window.close()
})

init()
