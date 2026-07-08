'use strict'

// S1接触ボタンを全 X ページのツイートに注入する
// profile_panel.js（プロフィール専用）とは別に動作

const S1_SCAN_DEBOUNCE = 500
const S1_PIPELINE_CACHE_KEY = 'os2_pipeline_handles'

let s1ScanTimer = null
let s1LastUrl = location.href
let s1FloatingPanel = null
let s1PipelineHandles = null

// ── ツイート情報抽出 ──────────────────────────────────────────

function s1GetTweetUrl(article) {
  const a = article.querySelector('time')?.closest('a')
  if (!a) return null
  const href = a.getAttribute('href') || ''
  if (!href.includes('/status/')) return null
  return 'https://x.com' + href
}

function s1GetTweetAuthor(article) {
  const a = article.querySelector('time')?.closest('a')
  if (!a) return null
  const href = a.getAttribute('href') || ''
  const parts = href.split('/status/')
  if (parts.length < 2) return null
  return parts[0].replace(/^\//, '').toLowerCase()
}

function s1GetTweetText(article) {
  const el = article.querySelector('[data-testid="tweetText"]')
  return el ? el.innerText.trim().slice(0, 300) : ''
}

function s1IsRetweet(article) {
  const ctx = article.querySelector('[data-testid="socialContext"]')
  return !!ctx && /retweet/i.test(ctx.textContent)
}

// ── テキスト注入（返信欄） ────────────────────────────────────

function s1InjectText(el, text) {
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
  return false
}

function s1LoadPipelineHandles() {
  try {
    chrome.storage.local.get([S1_PIPELINE_CACHE_KEY], (r) => {
      const entry = r?.[S1_PIPELINE_CACHE_KEY]
      s1PipelineHandles = Array.isArray(entry?.handles) ? entry.handles : null
      document.querySelectorAll('article[data-s1-injected]').forEach(el => {
        delete el.dataset.s1Injected
      })
      s1ScheduleScan()
    })
  } catch (_) {}
}

// ── トースト ──────────────────────────────────────────────────

function s1Toast(msg, isError) {
  const existing = document.getElementById('s1-scanner-toast')
  if (existing) existing.remove()
  const div = document.createElement('div')
  div.id = 's1-scanner-toast'
  div.textContent = msg
  Object.assign(div.style, {
    position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
    zIndex: '999999', background: isError ? '#dc2626' : '#065f46', color: '#fff',
    padding: '10px 18px', borderRadius: '10px', fontSize: '12px', fontWeight: '600',
    maxWidth: '440px', textAlign: 'center', lineHeight: '1.5',
    boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  })
  document.body.appendChild(div)
  setTimeout(() => { if (div.parentNode) div.remove() }, 6000)
}

// ── A/B 返信パネル ────────────────────────────────────────────

function s1HidePanel() {
  if (s1FloatingPanel) { s1FloatingPanel.remove(); s1FloatingPanel = null }
}

async function s1SendReply(tweetUrl, sentText, aiSuggestedText) {
  // 該当ツイートの返信ボタンを押す
  const articles = document.querySelectorAll('article[data-testid="tweet"]')
  let targetArticle = null
  for (const art of articles) {
    if (s1GetTweetUrl(art) === tweetUrl) { targetArticle = art; break }
  }

  if (targetArticle) {
    const replyBtn = targetArticle.querySelector('[data-testid="reply"]')
    if (replyBtn) {
      replyBtn.click()
      // 返信テキストエリアが現れるのを待つ
      await new Promise(r => setTimeout(r, 900))
      const box = document.querySelector('[data-testid="tweetTextarea_0"]')
      const target = box?.querySelector('[contenteditable="true"]') || box
      if (target) {
        s1InjectText(target, sentText)
        s1Toast('返信欄に入力しました。確認後、送信ボタンを押してください。', false)
      } else {
        await navigator.clipboard.writeText(sentText).catch(() => {})
        s1Toast('返信欄が見つかりませんでした。クリップボードにコピーしました。', false)
      }
    } else {
      await navigator.clipboard.writeText(sentText).catch(() => {})
      s1Toast('返信ボタンが見つかりませんでした。クリップボードにコピーしました。', false)
    }
  } else {
    await navigator.clipboard.writeText(sentText).catch(() => {})
    s1Toast('テキストをクリップボードにコピーしました。返信欄に貼り付けてください。', false)
  }

  chrome.runtime.sendMessage({ type: 's1_touch_sent', sentText, aiSuggestedText })
  s1HidePanel()
}

function s1ShowAbPanel(tweetUrl, optionA, optionB, accountName) {
  s1HidePanel()

  s1FloatingPanel = document.createElement('div')
  s1FloatingPanel.id = 's1-ab-panel'
  s1FloatingPanel.innerHTML = `
    <div class="s1-ab-header">
      💬 S1接触 A/B選択 <span class="s1-ab-account" id="s1-ab-account"></span>
      <button class="s1-ab-close">✕</button>
    </div>
    <div class="s1-ab-option">
      <div class="s1-ab-label">案A <span class="s1-ab-judge" id="s1-judge-a"></span></div>
      <textarea class="s1-ab-text" id="s1-text-a" rows="3"></textarea>
      <button class="s1-ab-send-btn" data-option="a">A で返信</button>
    </div>
    <div class="s1-ab-option">
      <div class="s1-ab-label">案B <span class="s1-ab-judge" id="s1-judge-b"></span></div>
      <textarea class="s1-ab-text" id="s1-text-b" rows="3"></textarea>
      <button class="s1-ab-send-btn" data-option="b">B で返信</button>
    </div>
    <div class="s1-ab-hint">テキストは編集可能です。「返信」後、Xの送信ボタンを押してください。</div>
  `

  const accountEl = s1FloatingPanel.querySelector('#s1-ab-account')
  if (accountEl) accountEl.textContent = '@' + (accountName || '')
  const judgeAEl = s1FloatingPanel.querySelector('#s1-judge-a')
  const judgeBEl = s1FloatingPanel.querySelector('#s1-judge-b')
  if (judgeAEl) judgeAEl.textContent = optionA.judge || ''
  if (judgeBEl) judgeBEl.textContent = optionB.judge || ''
  s1FloatingPanel.querySelector('#s1-text-a').value = optionA.text || ''
  s1FloatingPanel.querySelector('#s1-text-b').value = optionB.text || ''

  s1FloatingPanel.querySelector('.s1-ab-close').addEventListener('click', s1HidePanel)

  s1FloatingPanel.querySelector('[data-option="a"]').addEventListener('click', async () => {
    const text = s1FloatingPanel.querySelector('#s1-text-a').value.trim()
    const aiText = `案A: ${optionA.text}\n\n案B: ${optionB.text}`
    await s1SendReply(tweetUrl, text, aiText)
  })

  s1FloatingPanel.querySelector('[data-option="b"]').addEventListener('click', async () => {
    const text = s1FloatingPanel.querySelector('#s1-text-b').value.trim()
    const aiText = `案A: ${optionA.text}\n\n案B: ${optionB.text}`
    await s1SendReply(tweetUrl, text, aiText)
  })

  document.body.appendChild(s1FloatingPanel)
}

// ── ボタン注入 ─────────────────────────────────────────────────

function s1InjectButtons() {
  const articles = document.querySelectorAll('article[data-testid="tweet"]')
  for (const article of articles) {
    if (article.dataset.s1Injected) continue
    if (s1IsRetweet(article)) continue

    const tweetUrl = s1GetTweetUrl(article)
    if (!tweetUrl) continue

    const authorHandle = s1GetTweetAuthor(article)
    if (!authorHandle) continue
    if (Array.isArray(s1PipelineHandles) && !s1PipelineHandles.includes(authorHandle)) continue

    article.dataset.s1Injected = '1'

    const btn = document.createElement('button')
    btn.className = 's1-touch-btn'
    btn.textContent = '💬 S1接触'
    btn.setAttribute('type', 'button')

    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()

      btn.textContent = '⏳ 取得中...'
      btn.disabled = true

      const tweetText = s1GetTweetText(article)

      chrome.runtime.sendMessage(
        { type: 's1_touch_start', handle: '@' + authorHandle, tweetUrl, tweetText },
        (resp) => {
          if (chrome.runtime.lastError || !resp?.ok) {
            const msg = resp?.message || 'エラーが発生しました'
            s1Toast(msg, true)
            btn.textContent = '💬 S1接触'
            btn.disabled = false
            return
          }
          btn.textContent = '✓ Gemini起動中'
          btn.style.background = '#d1fae5'
          btn.style.color = '#065f46'
          btn.style.borderColor = '#6ee7b7'
          if (resp.accountName) {
            s1Toast(`「${resp.accountName}」のプロンプトをGeminiに送りました。スクショ追加後、送信して【取込】を押してください。`, false)
          }
        },
      )
    })

    // 既存の os2-btn-wrapper があれば追加、なければ新規作成
    let wrapper = article.querySelector('.os2-btn-wrapper')
    if (wrapper) {
      wrapper.appendChild(btn)
    } else {
      wrapper = document.createElement('div')
      wrapper.className = 'os2-btn-wrapper'
      wrapper.appendChild(btn)
      const actionBar = article.querySelector('[role="group"]')
      if (actionBar) {
        actionBar.insertAdjacentElement('beforebegin', wrapper)
      } else {
        article.appendChild(wrapper)
      }
    }
  }
}

// ── background からのメッセージ ───────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 's1_ab_ready') {
    s1ShowAbPanel(message.tweetUrl, message.optionA, message.optionB, message.accountName)
    return false
  }
  if (message.type === 's1_error') {
    s1Toast(message.message, true)
    return false
  }
  return false
})

// ── スキャン・SPA対応 ──────────────────────────────────────────

function s1ScheduleScan() {
  clearTimeout(s1ScanTimer)
  s1ScanTimer = setTimeout(s1InjectButtons, S1_SCAN_DEBOUNCE)
}

function s1HandleUrlChange() {
  const url = location.href
  if (url === s1LastUrl) return
  s1LastUrl = url
  s1HidePanel()
  document.querySelectorAll('article[data-s1-injected]').forEach(el => {
    delete el.dataset.s1Injected
  })
  s1ScheduleScan()
}

const _s1PushState = history.pushState
history.pushState = function (...args) {
  _s1PushState.apply(this, args)
  setTimeout(s1HandleUrlChange, 150)
}
window.addEventListener('popstate', () => setTimeout(s1HandleUrlChange, 150))

const s1Observer = new MutationObserver(s1ScheduleScan)
s1Observer.observe(document.body, { childList: true, subtree: true })

s1LoadPipelineHandles()

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[S1_PIPELINE_CACHE_KEY]) return
  s1LoadPipelineHandles()
})

s1ScheduleScan()
