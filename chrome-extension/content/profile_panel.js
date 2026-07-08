'use strict'

// ── 設定 ───────────────────────────────────────────────────────
const WEBAPP_BASE_DEFAULT = 'https://divizero.vercel.app'
const PIPELINE_CACHE_KEY = 'os2_pipeline_handles'

// ── 状態 ───────────────────────────────────────────────────────
let panelEl = null
let profileHandle = null
let scanDebounce = null
let lastUrl = location.href

// ── ページ判定 ─────────────────────────────────────────────────
function detectProfileHandle() {
  const path = location.pathname
  const m = path.match(/^\/([a-zA-Z0-9_]{1,15})(\/|$)/)
  if (!m) return null
  const reserved = new Set([
    'home', 'explore', 'notifications', 'messages', 'search',
    'i', 'settings', 'compose', 'hashtag', 'intent', 'login', 'signup',
  ])
  const candidate = m[1].toLowerCase()
  if (reserved.has(candidate)) return null
  return candidate
}

// ── ツイート解析 ───────────────────────────────────────────────
function isRetweet(article) {
  const ctx = article.querySelector('[data-testid="socialContext"]')
  return !!ctx && /retweet/i.test(ctx.textContent)
}

function getTweetUrl(article) {
  const timeEl = article.querySelector('time')
  if (!timeEl) return null
  const a = timeEl.closest('a')
  if (!a) return null
  const href = a.getAttribute('href') || ''
  if (!href.includes('/status/')) return null
  return 'https://x.com' + href
}

function getTweetText(article) {
  const el = article.querySelector('[data-testid="tweetText"]')
  return el ? el.innerText.trim().slice(0, 300) : ''
}

function getPostedAt(article) {
  const timeEl = article.querySelector('time')
  return timeEl ? (timeEl.getAttribute('datetime') || '') : ''
}

// ── OS② ツイート選択 ──────────────────────────────────────────
async function handleTweetSelect(article, handle, tweetUrl, btn) {
  const postText = getTweetText(article)
  const postedAt = getPostedAt(article)

  let displayName = handle
  try {
    const nameEl = document.querySelector('[data-testid="UserName"] span')
    if (nameEl) displayName = nameEl.textContent.trim() || handle
  } catch (_) {}

  btn.textContent = '⏳ 送信中...'
  btn.disabled = true

  const payload = {
    sourceContext: {
      platform: 'twitter',
      pageType: 'profile',
      url: location.href,
      collectedBy: 'chrome-extension',
      collectedAt: new Date().toISOString(),
    },
    account: {
      displayName,
      handle: '@' + handle,
      profileUrl: 'https://x.com/' + handle,
      channel: 'twitter',
    },
    postText,
    postUrl: tweetUrl,
    postedAt: postedAt || undefined,
  }

  const settings = await chrome.storage.local.get(['webappUrl'])
  const webappBase = (settings.webappUrl || WEBAPP_BASE_DEFAULT).replace(/\/$/, '')

  chrome.runtime.sendMessage({ type: 'enqueue', itemType: 'os2_touch', payload }, (resp) => {
    if (chrome.runtime.lastError || !resp?.ok) {
      btn.textContent = '⚠ エラー'
      btn.style.background = '#ef4444'
      setTimeout(() => {
        btn.textContent = 'OS② 選択'
        btn.style.background = ''
        btn.disabled = false
      }, 2000)
      return
    }
    btn.textContent = '✓ 選択済み'
    btn.classList.add('os2-btn-selected')
    btn.disabled = true
    article.classList.add('os2-tweet-selected')
    window.open(webappBase + '/', '_blank')
  })
}

// ── ボタン注入 ─────────────────────────────────────────────────
function injectButtons(handle) {
  const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'))

  for (const article of articles) {
    if (article.dataset.os2Injected) continue
    if (isRetweet(article)) continue

    const tweetUrl = getTweetUrl(article)
    if (!tweetUrl) continue
    if (!tweetUrl.toLowerCase().includes('/' + handle + '/status/')) continue

    article.dataset.os2Injected = '1'

    const wrapper = document.createElement('div')
    wrapper.className = 'os2-btn-wrapper'

    const btn = document.createElement('button')
    btn.className = 'os2-select-btn'
    btn.textContent = 'OS② 選択'
    btn.setAttribute('type', 'button')
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      handleTweetSelect(article, handle, tweetUrl, btn)
    })

    wrapper.appendChild(btn)

    const actionBar = article.querySelector('[role="group"]')
    if (actionBar) {
      actionBar.insertAdjacentElement('beforebegin', wrapper)
    } else {
      article.appendChild(wrapper)
    }
  }
}

// ── パイプライン確認 ───────────────────────────────────────────
async function updatePipelineBadge(handle) {
  if (!panelEl) return
  const stored = await chrome.storage.local.get([PIPELINE_CACHE_KEY])
  const handles = stored[PIPELINE_CACHE_KEY]?.handles || []
  const inPipeline = handles.includes(handle.toLowerCase())
  const badge = panelEl.querySelector('.os2-pipeline-badge')
  if (badge) badge.style.display = inPipeline ? 'inline-flex' : 'none'
}

// ── パネル UI ──────────────────────────────────────────────────
function showPanel(handle) {
  hidePanel()

  panelEl = document.createElement('div')
  panelEl.id = 'os2-panel'
  panelEl.innerHTML = `
    <div class="os2-panel-inner">
      <span class="os2-panel-icon">📋</span>
      <span class="os2-panel-label">OS② モード：<strong>@${handle}</strong></span>
      <span class="os2-pipeline-badge" style="display:none">パイプライン案件</span>
      <span class="os2-panel-hint">RTを除外済み。反応しやすい投稿の「OS② 選択」を押す →</span>
    </div>
  `
  document.body.appendChild(panelEl)
  updatePipelineBadge(handle)
}

function hidePanel() {
  if (panelEl) { panelEl.remove(); panelEl = null }
}

// ── スキャン ───────────────────────────────────────────────────
function resetInjectedTags() {
  document.querySelectorAll('article[data-os2-injected]').forEach(el => {
    delete el.dataset.os2Injected
  })
}

function scan() {
  const handle = detectProfileHandle()

  if (!handle) {
    if (profileHandle) {
      profileHandle = null
      hidePanel()
      resetInjectedTags()
    }
    return
  }

  if (handle !== profileHandle) {
    profileHandle = handle
    resetInjectedTags()
    showPanel(handle)
  }

  injectButtons(handle)
}

function scheduleScan() {
  clearTimeout(scanDebounce)
  scanDebounce = setTimeout(scan, 400)
}

function handleUrlChange() {
  const url = location.href
  if (url === lastUrl) return
  lastUrl = url
  scheduleScan()
}

// ── SPA ナビゲーション対応 ─────────────────────────────────────
const _origPushState = history.pushState
history.pushState = function (...args) {
  _origPushState.apply(this, args)
  setTimeout(handleUrlChange, 150)
}
window.addEventListener('popstate', () => setTimeout(handleUrlChange, 150))

const domObserver = new MutationObserver(scheduleScan)
domObserver.observe(document.body, { childList: true, subtree: true })

scheduleScan()
