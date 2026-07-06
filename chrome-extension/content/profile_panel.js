'use strict'

// ── 設定 ───────────────────────────────────────────────────────
const WEBAPP_BASE_DEFAULT = 'https://divizero.vercel.app'
const PIPELINE_CACHE_KEY = 'os2_pipeline_handles'

// ── 状態 ───────────────────────────────────────────────────────
let panelEl = null
let profileHandle = null
let scanDebounce = null
let lastUrl = location.href
let abPanelEl = null // S1 A/B 選択パネル

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

// ── DOM ユーティリティ ─────────────────────────────────────────
function waitForElement(selector, timeoutMs) {
  return new Promise(resolve => {
    const found = document.querySelector(selector)
    if (found) { resolve(found); return }
    const obs = new MutationObserver(() => {
      const el = document.querySelector(selector)
      if (el) { obs.disconnect(); resolve(el) }
    })
    obs.observe(document.body, { childList: true, subtree: true })
    setTimeout(() => { obs.disconnect(); resolve(null) }, timeoutMs || 5000)
  })
}

function injectText(el, text) {
  try { el.focus() } catch (_) {}
  if (document.execCommand) {
    try { if (document.execCommand('insertText', false, text)) return true } catch (_) {}
  }
  try {
    const dt = new DataTransfer()
    dt.setData('text/plain', text)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    return true
  } catch (_) {}
  try {
    if (el.contentEditable === 'true') {
      el.textContent = text
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }))
    } else {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      if (setter) setter.call(el, text)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    return true
  } catch (_) {}
  return false
}

// ── OS② ツイート選択（既存フロー） ────────────────────────────
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

// ── S1接触 ────────────────────────────────────────────────────
async function handleS1TouchClick(article, handle, tweetUrl, btn) {
  const tweetText = getTweetText(article)

  btn.textContent = '⏳ 取得中...'
  btn.disabled = true

  chrome.runtime.sendMessage(
    { type: 's1_touch_start', handle: '@' + handle, tweetUrl, tweetText },
    (resp) => {
      if (chrome.runtime.lastError || !resp?.ok) {
        const msg = resp?.message || 'エラーが発生しました'
        showS1Toast(msg, true)
        btn.textContent = '💬 S1接触'
        btn.disabled = false
        return
      }
      btn.textContent = '✓ Gemini起動中'
      btn.style.background = '#d1fae5'
      btn.style.color = '#065f46'
      btn.style.borderColor = '#6ee7b7'
      // アカウント名を表示
      if (resp.accountName) {
        showS1Toast(`「${resp.accountName}」のプロンプトをGeminiに送りました。スクショを追加して送信後、【取込】を押してください。`, false)
      }
    },
  )
}

// ── S1 トースト ────────────────────────────────────────────────
function showS1Toast(msg, isError) {
  const existing = document.getElementById('s1-toast')
  if (existing) existing.remove()

  const div = document.createElement('div')
  div.id = 's1-toast'
  div.textContent = msg
  Object.assign(div.style, {
    position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
    zIndex: '999999', background: isError ? '#dc2626' : '#065f46', color: '#fff',
    padding: '10px 18px', borderRadius: '10px', fontSize: '12px',
    fontWeight: '600', maxWidth: '420px', textAlign: 'center',
    boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    lineHeight: '1.5',
  })
  document.body.appendChild(div)
  setTimeout(() => { if (div.parentNode) div.remove() }, 6000)
}

// ── S1 A/B 選択パネル ─────────────────────────────────────────
function hideAbPanel() {
  if (abPanelEl) { abPanelEl.remove(); abPanelEl = null }
}

async function sendSelectedReply(article, tweetUrl, sentText, aiSuggestedText) {
  // X の返信ボタンをクリックして返信欄を開く
  const replyBtn = article.querySelector('[data-testid="reply"]')
  if (replyBtn) {
    replyBtn.click()
    const replyBox = await waitForElement(
      '[data-testid="tweetTextarea_0"], [data-testid="tweetTextarea_0_label"]',
      5000,
    )
    const target = replyBox?.querySelector('[contenteditable="true"]') || replyBox
    if (target) {
      injectText(target, sentText)
      showS1Toast('返信欄にテキストを入力しました。確認して送信ボタンを押してください。', false)
    } else {
      await navigator.clipboard.writeText(sentText).catch(() => {})
      showS1Toast('返信欄が見つかりませんでした。クリップボードにコピーしました。Ctrl+V で貼り付けてください。', false)
    }
  } else {
    await navigator.clipboard.writeText(sentText).catch(() => {})
    showS1Toast('返信ボタンが見つかりませんでした。クリップボードにコピーしました。', false)
  }

  // タッチを記録
  chrome.runtime.sendMessage({ type: 's1_touch_sent', sentText, aiSuggestedText })
  hideAbPanel()
}

function showAbPanel(tweetUrl, optionA, optionB, accountName) {
  hideAbPanel()

  // 対象ツイートの article を探す
  let targetArticle = null
  const articles = document.querySelectorAll('article[data-testid="tweet"]')
  for (const art of articles) {
    const url = getTweetUrl(art)
    if (url === tweetUrl) { targetArticle = art; break }
  }

  abPanelEl = document.createElement('div')
  abPanelEl.id = 's1-ab-panel'
  abPanelEl.innerHTML = `
    <div class="s1-ab-header">
      💬 S1接触 A/B選択 <span class="s1-ab-account">@${accountName || ''}</span>
      <button class="s1-ab-close">✕</button>
    </div>
    <div class="s1-ab-option">
      <div class="s1-ab-label">案A <span class="s1-ab-judge">${optionA.judge || ''}</span></div>
      <textarea class="s1-ab-text" id="s1-text-a" rows="3">${optionA.text}</textarea>
      <button class="s1-ab-send-btn" data-option="a">A で返信</button>
    </div>
    <div class="s1-ab-option">
      <div class="s1-ab-label">案B <span class="s1-ab-judge">${optionB.judge || ''}</span></div>
      <textarea class="s1-ab-text" id="s1-text-b" rows="3">${optionB.text}</textarea>
      <button class="s1-ab-send-btn" data-option="b">B で返信</button>
    </div>
    <div class="s1-ab-hint">テキストは編集可能です。送信後、Xの送信ボタンを押してください。</div>
  `

  abPanelEl.querySelector('.s1-ab-close').addEventListener('click', hideAbPanel)

  abPanelEl.querySelector('[data-option="a"]').addEventListener('click', async () => {
    const text = abPanelEl.querySelector('#s1-text-a').value.trim()
    const aiText = `案A: ${optionA.text}\n\n案B: ${optionB.text}`
    await sendSelectedReply(targetArticle || document.body, tweetUrl, text, aiText)
  })

  abPanelEl.querySelector('[data-option="b"]').addEventListener('click', async () => {
    const text = abPanelEl.querySelector('#s1-text-b').value.trim()
    const aiText = `案A: ${optionA.text}\n\n案B: ${optionB.text}`
    await sendSelectedReply(targetArticle || document.body, tweetUrl, text, aiText)
  })

  document.body.appendChild(abPanelEl)
}

// background からのメッセージを受信
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 's1_ab_ready') {
    showAbPanel(message.tweetUrl, message.optionA, message.optionB, message.accountName)
    return false
  }
  if (message.type === 's1_error') {
    showS1Toast(message.message, true)
    return false
  }
  return false
})

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

    // OS② ボタン
    const os2Btn = document.createElement('button')
    os2Btn.className = 'os2-select-btn'
    os2Btn.textContent = 'OS② 選択'
    os2Btn.setAttribute('type', 'button')
    os2Btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation()
      handleTweetSelect(article, handle, tweetUrl, os2Btn)
    })

    // S1接触 ボタン
    const s1Btn = document.createElement('button')
    s1Btn.className = 's1-touch-btn'
    s1Btn.textContent = '💬 S1接触'
    s1Btn.setAttribute('type', 'button')
    s1Btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation()
      handleS1TouchClick(article, handle, tweetUrl, s1Btn)
    })

    wrapper.appendChild(os2Btn)
    wrapper.appendChild(s1Btn)

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
      <span class="os2-panel-label">OS② / S1接触 モード：<strong>@${handle}</strong></span>
      <span class="os2-pipeline-badge" style="display:none">パイプライン案件</span>
      <span class="os2-panel-hint">「OS② 選択」→ 行動判定キュー / 「💬 S1接触」→ タッチプロンプト生成</span>
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
  hideAbPanel()
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
