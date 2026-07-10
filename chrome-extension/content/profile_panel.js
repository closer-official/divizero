'use strict'

// NOTE: twitter_scraper.js と同一スコープで動くため変数名・関数名を os2_ プレフィックスで衝突回避

const WEBAPP_BASE_DEFAULT = 'https://divizero.vercel.app'
const PIPELINE_CACHE_KEY = 'os2_pipeline_handles'

let os2PanelEl = null
let os2ProfileHandle = null
let os2ScanDebounce = null   // ← scanDebounce から改名
let os2LastUrl = location.href  // ← lastUrl から改名

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

function os2IsRetweet(article) {
  const ctx = article.querySelector('[data-testid="socialContext"]')
  return !!ctx && /retweet/i.test(ctx.textContent)
}

function os2GetTweetUrl(article) {
  const timeEl = article.querySelector('time')
  if (!timeEl) return null
  const a = timeEl.closest('a')
  if (!a) return null
  const href = a.getAttribute('href') || ''
  if (!href.includes('/status/')) return null
  return 'https://x.com' + href
}

function os2GetTweetText(article) {
  const el = article.querySelector('[data-testid="tweetText"]')
  return el ? el.innerText.trim().slice(0, 300) : ''
}

function os2GetPostedAt(article) {
  const timeEl = article.querySelector('time')
  return timeEl ? (timeEl.getAttribute('datetime') || '') : ''
}

function os2HandleTweetSelect(article, handle, tweetUrl, btn) {
  const postText = os2GetTweetText(article)
  const postedAt = os2GetPostedAt(article)

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

  const resetBtn = () => {
    btn.textContent = 'OS② 選択'
    btn.style.background = ''
    btn.disabled = false
  }

  try {
    chrome.runtime.sendMessage({ type: 'enqueue', itemType: 'os2_touch', payload }, (resp) => {
      if (chrome.runtime.lastError || !resp?.ok) {
        btn.textContent = '⚠ エラー'
        btn.style.background = '#ef4444'
        setTimeout(resetBtn, 2000)
        return
      }
      btn.textContent = '✓ 選択済み'
      btn.classList.add('os2-btn-selected')
      btn.disabled = true
      article.classList.add('os2-tweet-selected')
    })
  } catch (_) {
    btn.textContent = '⚠ ページを再読込してください'
    btn.style.background = '#ef4444'
    setTimeout(resetBtn, 3000)
  }
}

function os2InjectButtons(handle) {
  const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'))

  for (const article of articles) {
    const hasBtn = !!article.querySelector('.os2-select-btn')
    if (article.dataset.os2Injected && hasBtn) continue
    if (article.dataset.os2Injected && !hasBtn) {
      delete article.dataset.os2Injected
    }
    if (hasBtn) { article.dataset.os2Injected = '1'; continue }
    if (os2IsRetweet(article)) continue

    const tweetUrl = os2GetTweetUrl(article)
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
      os2HandleTweetSelect(article, handle, tweetUrl, btn)
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

async function os2UpdatePipelineBadge(handle) {
  if (!os2PanelEl) return
  try {
    const stored = await chrome.storage.local.get([PIPELINE_CACHE_KEY])
    const handles = stored[PIPELINE_CACHE_KEY]?.handles || []
    const inPipeline = handles.includes(handle.toLowerCase())
    const badge = os2PanelEl.querySelector('.os2-pipeline-badge')
    if (badge) badge.style.display = inPipeline ? 'inline-flex' : 'none'
  } catch (_) {}
}

function os2ShowPanel(handle) {
  os2HidePanel()

  os2PanelEl = document.createElement('div')
  os2PanelEl.id = 'os2-panel'
  os2PanelEl.innerHTML = `
    <div class="os2-panel-inner">
      <span class="os2-panel-icon">📋</span>
      <span class="os2-panel-label">OS② モード：<strong>@${handle}</strong></span>
      <span class="os2-pipeline-badge" style="display:none">パイプライン案件</span>
      <span class="os2-panel-hint">RTを除外済み。反応しやすい投稿の「OS② 選択」を押す →</span>
    </div>
  `
  document.body.appendChild(os2PanelEl)
  os2UpdatePipelineBadge(handle)
}

function os2HidePanel() {
  if (os2PanelEl) { os2PanelEl.remove(); os2PanelEl = null }
}

function os2ResetInjectedTags() {
  document.querySelectorAll('article[data-os2-injected]').forEach(el => {
    delete el.dataset.os2Injected
  })
}

function os2Scan() {
  const handle = detectProfileHandle()

  if (!handle) {
    if (os2ProfileHandle) {
      os2ProfileHandle = null
      os2HidePanel()
      os2ResetInjectedTags()
    }
    return
  }

  if (handle !== os2ProfileHandle) {
    os2ProfileHandle = handle
    os2ResetInjectedTags()
    os2ShowPanel(handle)
  }

  os2InjectButtons(handle)
}

function os2ScheduleScan() {
  clearTimeout(os2ScanDebounce)
  os2ScanDebounce = setTimeout(os2Scan, 400)
}

function os2HandleUrlChange() {
  const url = location.href
  if (url === os2LastUrl) return
  os2LastUrl = url
  os2ScheduleScan()
}

const _os2PushState = history.pushState   // ← _origPushState から改名
history.pushState = function (...args) {
  _os2PushState.apply(this, args)
  setTimeout(os2HandleUrlChange, 150)
}
window.addEventListener('popstate', () => setTimeout(os2HandleUrlChange, 150))

const os2DomObserver = new MutationObserver(os2ScheduleScan)  // ← domObserver から改名
os2DomObserver.observe(document.body, { childList: true, subtree: true })

// デバウンスをバイパスして確実にスキャンを実行（初回・定期・タブ復帰）
setTimeout(os2Scan, 800)    // 初回: ページ読み込み後800msで強制スキャン
setInterval(os2Scan, 3000)  // 定期: 3秒ごとに確実にスキャン（DOMが多忙でもスキップしない）

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') os2Scan()  // タブ復帰時も直接スキャン
})

os2ScheduleScan()  // MutationObserver 用の初期デバウンスは維持
