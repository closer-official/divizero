'use strict'

// S1接触ボタンを全 X ページのツイートに注入する
// profile_panel.js（プロフィール専用）とは別に動作

const S1_SCAN_DEBOUNCE = 500
const S1_PIPELINE_CACHE_KEY = 'os2_pipeline_handles'

let s1ScanTimer = null
let s1LastUrl = location.href
let s1FloatingPanel = null
let s1PipelineHandles = null
let s1PendingBar = null
let s1PendingExpireTimer = null
let s1PendingSendListener = null
let s1PendingRecorded = false
let s1PendingActive = false

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

function s1RemovePendingBar() {
  if (s1PendingExpireTimer) {
    clearTimeout(s1PendingExpireTimer)
    s1PendingExpireTimer = null
  }
  if (s1PendingSendListener) {
    document.removeEventListener('click', s1PendingSendListener, true)
    s1PendingSendListener = null
  }
  if (s1PendingBar) {
    s1PendingBar.remove()
    s1PendingBar = null
  }
}

function s1ShowPendingBar(onRecord, onSkip) {
  s1RemovePendingBar()
  s1PendingRecorded = false
  s1PendingActive = true

  const bar = document.createElement('div')
  s1PendingBar = bar
  bar.id = 's1-pending-bar'
  Object.assign(bar.style, {
    position: 'fixed',
    left: '16px',
    right: '16px',
    bottom: '16px',
    zIndex: '999999',
    background: '#111827',
    color: '#fff',
    borderRadius: '14px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.28)',
    padding: '12px 14px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  })

  const label = document.createElement('div')
  label.textContent = '✍ 返信を送信したら'
  Object.assign(label.style, {
    flex: '1 1 auto',
    minWidth: '180px',
    fontSize: '12px',
    fontWeight: '700',
  })

  const recordBtn = document.createElement('button')
  recordBtn.type = 'button'
  recordBtn.textContent = '送信済みとして記録する'
  Object.assign(recordBtn.style, {
    background: '#16a34a',
    color: '#fff',
    border: 'none',
    borderRadius: '10px',
    padding: '8px 12px',
    fontSize: '12px',
    fontWeight: '700',
    cursor: 'pointer',
  })

  const skipBtn = document.createElement('button')
  skipBtn.type = 'button'
  skipBtn.textContent = '記録しない'
  Object.assign(skipBtn.style, {
    background: '#374151',
    color: '#fff',
    border: 'none',
    borderRadius: '10px',
    padding: '8px 12px',
    fontSize: '12px',
    fontWeight: '700',
    cursor: 'pointer',
  })

  const status = document.createElement('div')
  status.textContent = '送信検知が使えない場合は、ここから手動で記録できます。'
  Object.assign(status.style, {
    flexBasis: '100%',
    fontSize: '11px',
    color: '#d1d5db',
  })

  const finish = async (recorded) => {
    if (!s1PendingActive) return
    s1PendingActive = false
    s1RemovePendingBar()
    if (recorded && typeof onRecord === 'function') {
      s1PendingRecorded = true
      await onRecord()
      s1Toast('送信を検知しました。タッチを記録します。', false)
    } else if (!recorded && typeof onSkip === 'function') {
      onSkip()
    }
  }

  recordBtn.addEventListener('click', () => { void finish(true) })
  skipBtn.addEventListener('click', () => { void finish(false) })

  bar.appendChild(label)
  bar.appendChild(recordBtn)
  bar.appendChild(skipBtn)
  bar.appendChild(status)
  document.body.appendChild(bar)

  s1PendingSendListener = (e) => {
    const btn = e.target?.closest?.('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]')
    if (!btn || !s1PendingActive) return
    setTimeout(() => {
      if (s1PendingActive && !s1PendingRecorded) {
        void finish(true)
      }
    }, 800)
  }
  document.addEventListener('click', s1PendingSendListener, true)

  s1PendingExpireTimer = setTimeout(() => {
    if (!s1PendingActive) return
    s1PendingActive = false
    s1RemovePendingBar()
    try { chrome.runtime.sendMessage({ type: 's1_touch_cancelled' }) } catch (_) {}
    s1Toast('送信が確認できなかったため記録をスキップしました。', true)
  }, 10 * 60 * 1000)
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

  s1ShowPendingBar(
    () => {
      try {
        chrome.runtime.sendMessage({ type: 's1_touch_sent', sentText, aiSuggestedText })
      } catch (_) {}
    },
    () => {
      try {
        chrome.runtime.sendMessage({ type: 's1_touch_cancelled' })
      } catch (_) {}
    },
  )
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
    const hasBtn = !!article.querySelector('.s1-touch-btn')
    if (article.dataset.s1Injected && hasBtn) continue
    if (article.dataset.s1Injected && !hasBtn) {
      delete article.dataset.s1Injected
    }
    if (hasBtn) { article.dataset.s1Injected = '1'; continue }
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

    const tweetText = s1GetTweetText(article)
    const sendStart = (force) => {
      btn.textContent = '⏳ 取得中...'
      btn.disabled = true

      chrome.runtime.sendMessage(
        { type: 's1_touch_start', handle: '@' + authorHandle, tweetUrl, tweetText, force: !!force },
        (resp) => {
          if (chrome.runtime.lastError || !resp?.ok) {
            if (resp?.code === 'CONTEXT_EXISTS') {
              const ok = window.confirm(`前回の ${resp.prevHandle || '未完了の接触'} への接触が未完了です。破棄してこのツイートで続行しますか？`)
              if (ok) {
                sendStart(true)
                return
              }
              btn.textContent = '💬 S1接触'
              btn.disabled = false
              return
            }
            const msg = resp?.message || 'エラーが発生しました'
            s1Toast(msg, true)
            btn.textContent = '💬 S1接触'
            btn.disabled = false
            return
          }
          if (resp.mode === 'api_success') {
            // API成功 → ボタンは ab_ready で更新される。ここでは一時表示のみ
            btn.textContent = '✓ AI生成中...'
            btn.style.background = '#ede9fe'
            btn.style.color = '#6d28d9'
            btn.style.borderColor = '#c4b5fd'
            // A/Bパネルが表示されたらボタンを戻す（s1_ab_readyで処理済み）
          } else {
            btn.textContent = '✓ Gemini起動中'
            btn.style.background = '#d1fae5'
            btn.style.color = '#065f46'
            btn.style.borderColor = '#6ee7b7'
            if (resp.accountName) {
              const hasTweet = !!(tweetText && tweetText.trim())
              const hint = hasTweet
                ? 'Geminiでそのまま送信してください（スクショ追加は任意）。'
                : 'スクショ追加後、送信して【取込】を押してください。'
              const prefix = resp.mode === 'gemini_fallback' ? '⚠ APIエラー → ' : ''
              s1Toast(`${prefix}「${resp.accountName}」のプロンプトをGeminiに送りました。${hint}`, false)
            }
          }
        },
      )
    }

    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      sendStart(false)
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
    s1Toast(message.message, !message.isWarning)
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

setTimeout(s1InjectButtons, 800)
setInterval(s1InjectButtons, 3000)

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') s1InjectButtons()
})

s1ScheduleScan()
