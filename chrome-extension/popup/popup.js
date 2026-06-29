'use strict'

const PROMPT_CACHE_KEY = 'os0_prompt_cache'
const DEFAULT_URL = 'https://divizero.vercel.app'

async function init() {
  const stored = await chrome.storage.local.get(['webappUrl', 'maxAccounts', 'aiTarget', PROMPT_CACHE_KEY])

  document.getElementById('webappUrl').value = stored.webappUrl || DEFAULT_URL
  document.getElementById('maxAccounts').value = stored.maxAccounts || 20
  document.getElementById('aiTarget').value = stored.aiTarget || 'gemini'

  const cache = stored[PROMPT_CACHE_KEY]
  const note = document.getElementById('cacheNote')
  if (cache && cache.cachedAt) {
    const mins = Math.round((Date.now() - cache.cachedAt) / 60000)
    note.textContent = `プロンプトキャッシュ: ${mins < 60 ? mins + '分前' : Math.round(mins / 60) + '時間前'}に取得済`
  } else {
    note.textContent = 'プロンプトは初回ボタン押下時に取得されます'
  }
}

document.getElementById('saveBtn').addEventListener('click', async () => {
  const webappUrl = document.getElementById('webappUrl').value.trim()
  const maxAccounts = parseInt(document.getElementById('maxAccounts').value, 10)
  const aiTarget = document.getElementById('aiTarget').value

  await chrome.storage.local.set({
    webappUrl: webappUrl || DEFAULT_URL,
    maxAccounts: maxAccounts || 20,
    aiTarget,
    // URLが変わったらプロンプトキャッシュを無効化
    ...(webappUrl ? { [PROMPT_CACHE_KEY]: null } : {}),
  })

  const msg = document.getElementById('msg')
  msg.textContent = '保存しました'
  setTimeout(() => { msg.textContent = '' }, 2000)
})

init()
