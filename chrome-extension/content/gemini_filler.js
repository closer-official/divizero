'use strict'

const STORAGE_KEY = 'os2_gemini_prompt'
const S1_TOUCH_KEY = 's1_touch_context'
const S1_AUTO_CAPTURE_KEY = 's1_auto_capture_enabled'
const MAX_AGE_MS = 5 * 60 * 1000
const GEMINI_RESPONSE_SELECTORS = [
  'model-response',
  '[data-test-id="model-response"]',
  '.model-response-text',
  'message-content',
]
let lastHandledS1SetAt = 0
let s1AutoCaptureEnabled = true
let s1GeminiPanelEl = null
let s1AutoCaptureObserver = null
let s1AutoCaptureTimer = null
let s1AutoCaptureSession = 0
let s1AutoCaptureBaseline = null
let s1AutoCaptureCandidate = null
let s1AutoCaptureStableCount = 0
let s1AutoCaptureInFlight = false

// ── Gemini の入力エリアを待つ ──────────────────────────────────
function waitForInput(maxWait) {
  const selectors = [
    'div[contenteditable="true"]',
    'rich-textarea div[contenteditable="true"]',
    'p[contenteditable="true"]',
    'textarea',
  ]
  return new Promise((resolve) => {
    const start = Date.now()
    const check = () => {
      for (const sel of selectors) {
        const el = document.querySelector(sel)
        if (el) { resolve(el); return }
      }
      if (Date.now() - start > (maxWait || 12000)) { resolve(null); return }
      setTimeout(check, 350)
    }
    check()
  })
}

// ── テキストを挿入する ─────────────────────────────────────────
function injectText(el, text) {
  try { el.focus() } catch (_) {}

  if (document.execCommand) {
    try {
      const ok = document.execCommand('insertText', false, text)
      if (ok) return true
    } catch (_) {}
  }

  try {
    const dt = new DataTransfer()
    dt.setData('text/plain', text)
    el.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: dt, bubbles: true, cancelable: true,
    }))
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

function loadAutoCaptureSetting() {
  try {
    chrome.storage.local.get([S1_AUTO_CAPTURE_KEY], (r) => {
      s1AutoCaptureEnabled = r?.[S1_AUTO_CAPTURE_KEY] !== false
      if (s1GeminiPanelEl) {
        const toggle = s1GeminiPanelEl.querySelector('#s1-auto-capture')
        if (toggle) toggle.checked = s1AutoCaptureEnabled
      }
      if (s1AutoCaptureEnabled && s1GeminiPanelEl) {
        startS1AutoCaptureWatch()
      } else if (!s1AutoCaptureEnabled) {
        stopS1AutoCaptureWatch()
      }
    })
  } catch (_) {}
}

function setAutoCaptureEnabled(enabled) {
  s1AutoCaptureEnabled = !!enabled
  chrome.storage.local.set({ [S1_AUTO_CAPTURE_KEY]: s1AutoCaptureEnabled })
  if (s1GeminiPanelEl) {
    const toggle = s1GeminiPanelEl.querySelector('#s1-auto-capture')
    if (toggle) toggle.checked = s1AutoCaptureEnabled
  }
  if (s1AutoCaptureEnabled) {
    startS1AutoCaptureWatch()
  } else {
    stopS1AutoCaptureWatch()
  }
}

function extractLastModelResponse(marker) {
  for (const sel of GEMINI_RESPONSE_SELECTORS) {
    const nodes = Array.from(document.querySelectorAll(sel))
    for (let i = nodes.length - 1; i >= 0; i--) {
      const text = (nodes[i].innerText || '').trim()
      if (text && (!marker || text.includes(marker))) {
        return text
      }
    }
  }

  if (marker) {
    const body = document.body?.innerText || ''
    const lastIdx = body.lastIndexOf(marker)
    if (lastIdx !== -1) {
      return body.slice(Math.max(0, lastIdx - 200), Math.min(body.length, lastIdx + 20000)).trim()
    }
  }

  return null
}

function stopS1AutoCaptureWatch() {
  s1AutoCaptureSession++
  if (s1AutoCaptureObserver) {
    s1AutoCaptureObserver.disconnect()
    s1AutoCaptureObserver = null
  }
  if (s1AutoCaptureTimer) {
    clearInterval(s1AutoCaptureTimer)
    s1AutoCaptureTimer = null
  }
  s1AutoCaptureBaseline = null
  s1AutoCaptureCandidate = null
  s1AutoCaptureStableCount = 0
  s1AutoCaptureInFlight = false
}

function closeS1CapturePanel() {
  stopS1AutoCaptureWatch()
  if (s1GeminiPanelEl) {
    s1GeminiPanelEl.remove()
    s1GeminiPanelEl = null
  }
}

function startS1AutoCaptureWatch() {
  stopS1AutoCaptureWatch()
  if (!s1AutoCaptureEnabled || !s1GeminiPanelEl) return

  const session = ++s1AutoCaptureSession
  s1AutoCaptureBaseline = extractLastModelResponse('TOUCH_END')

  const tick = () => {
    if (session !== s1AutoCaptureSession || !s1GeminiPanelEl || !s1AutoCaptureEnabled || s1AutoCaptureInFlight) return

    const current = extractLastModelResponse('TOUCH_END')
    if (!current) {
      s1AutoCaptureCandidate = null
      s1AutoCaptureStableCount = 0
      return
    }

    if (s1AutoCaptureBaseline !== null && current === s1AutoCaptureBaseline) {
      s1AutoCaptureCandidate = current
      s1AutoCaptureStableCount = 0
      return
    }

    if (current === s1AutoCaptureCandidate) {
      s1AutoCaptureStableCount += 1
    } else {
      s1AutoCaptureCandidate = current
      s1AutoCaptureStableCount = 1
    }

    if (s1AutoCaptureStableCount < 2) return
    void captureS1Output(current, true)
  }

  s1AutoCaptureObserver = new MutationObserver(() => { void tick() })
  s1AutoCaptureObserver.observe(document.body, { childList: true, subtree: true, characterData: true })
  s1AutoCaptureTimer = setInterval(() => { void tick() }, 1000)
  void tick()
}

function sendCapturedOutput(text) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ type: 's1_gemini_captured', clipboardText: text }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        resolve(resp)
      })
    } catch (err) {
      reject(err)
    }
  })
}

async function captureS1Output(text, isAuto = false, sourceLabel = 'クリップボードから読み取りました。') {
  if (s1AutoCaptureInFlight) return
  s1AutoCaptureInFlight = true
  stopS1AutoCaptureWatch()

  const panel = s1GeminiPanelEl
  if (!panel) {
    s1AutoCaptureInFlight = false
    return
  }

  const status = panel.querySelector('#s1-status')
  const btn = panel.querySelector('#s1-capture-btn')
  if (btn) btn.disabled = true

  try {
    if (status) {
      status.textContent = isAuto
        ? '✓ 自動取込しました。Xに戻ります…'
        : sourceLabel
    }
    await sendCapturedOutput(text)
    setTimeout(() => {
      closeS1CapturePanel()
    }, isAuto ? 350 : 0)
  } catch (_) {
    if (status) {
      status.textContent = 'クリップボード読み取りに失敗しました。ページをリロードして再試行してください。'
    }
    if (btn) {
      btn.textContent = '📋 取込'
      btn.disabled = false
    }
    s1AutoCaptureInFlight = false
    if (s1GeminiPanelEl && isAuto) {
      startS1AutoCaptureWatch()
    }
  } finally {
    if (!isAuto) s1AutoCaptureInFlight = false
  }
}

async function handleManualCapture(panel) {
  const btn = panel.querySelector('#s1-capture-btn')
  const status = panel.querySelector('#s1-status')
  if (btn) {
    btn.textContent = '読み取り中...'
    btn.disabled = true
  }

  const domText = extractLastModelResponse('TOUCH_START')
  if (domText && domText.trim().length >= 10) {
    await captureS1Output(domText.trim(), false, 'DOMから読み取りました。')
    return
  }

  try {
    const text = await navigator.clipboard.readText()
    if (!text || text.trim().length < 10) {
      if (status) {
        status.textContent = 'クリップボードが空です。AIの応答を待ってから押してください。'
      }
      if (btn) {
        btn.textContent = '📋 取込'
        btn.disabled = false
      }
      return
    }
    await captureS1Output(text.trim(), false, 'クリップボードから読み取りました。')
  } catch (_) {
    if (status) {
      status.textContent = 'クリップボード読み取りに失敗しました。ページをリロードして再試行してください。'
    }
    if (btn) {
      btn.textContent = '📋 取込'
      btn.disabled = false
    }
  }
}

// ── バナー系 ───────────────────────────────────────────────────
function showBanner(msg, color) {
  const div = document.createElement('div')
  div.textContent = msg
  Object.assign(div.style, {
    position: 'fixed', top: '16px', right: '16px', zIndex: '999999',
    background: color || '#4f46e5', color: '#fff', padding: '12px 18px',
    borderRadius: '12px', fontSize: '13px', fontWeight: '600',
    boxShadow: '0 4px 20px rgba(0,0,0,0.25)', maxWidth: '340px',
    lineHeight: '1.5', cursor: 'pointer',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  })
  div.addEventListener('click', () => div.remove())
  document.body.appendChild(div)
  setTimeout(() => { if (div.parentNode) div.remove() }, 8000)
}

function showError(msg) {
  showBanner('⚠ ' + msg, '#dc2626')
}

// ── OS② 通常フロー ─────────────────────────────────────────────
async function tryFill() {
  let stored
  try {
    stored = await chrome.storage.local.get([STORAGE_KEY])
  } catch (_) {
    return
  }

  const entry = stored[STORAGE_KEY]
  if (!entry || !entry.text) return
  if (Date.now() - entry.setAt > MAX_AGE_MS) {
    chrome.storage.local.remove(STORAGE_KEY)
    return
  }

  const text = entry.text
  chrome.storage.local.remove(STORAGE_KEY)

  const el = await waitForInput(12000)
  if (!el) {
    showError('入力エリアが見つかりませんでした。手動で貼り付けてください。')
    return
  }

  const ok = injectText(el, text)
  if (ok) {
    showBanner('✓ OS②プロンプトを自動入力しました。投稿スクショを追加して送信してください。')
  } else {
    showError('テキスト挿入に失敗しました。手動で貼り付けてください。')
  }
}

// ── S1 タッチ — 取込パネル ─────────────────────────────────────
function showS1CapturePanel(ctx) {
  closeS1CapturePanel()

  const panel = document.createElement('div')
  s1GeminiPanelEl = panel
  panel.id = 's1-gemini-panel'
  Object.assign(panel.style, {
    position: 'fixed', bottom: '20px', right: '20px', zIndex: '999999',
    background: '#fff', border: '2px solid #059669', borderRadius: '14px',
    boxShadow: '0 6px 24px rgba(5,150,105,0.25)', padding: '14px 16px',
    maxWidth: '320px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  })

  panel.innerHTML = `
    <div style="font-size:13px;font-weight:700;color:#065f46;margin-bottom:6px">
      💬 S1接触 — <span id="s1-panel-handle"></span>
    </div>
    <div style="font-size:11px;color:#374151;line-height:1.6;margin-bottom:10px">
      ① プロンプト挿入済み<br>
      ② スクショを追加して送信<br>
      ③ 応答が完了したら下の【取込】を押す（コピー不要）<br>
      ④ 必要なら自動取込をONにする
    </div>
    <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:#374151;margin-bottom:10px;cursor:pointer">
      <input type="checkbox" id="s1-auto-capture" />
      応答完了で自動取込
    </label>
    <div style="display:flex;gap:8px">
      <button id="s1-capture-btn" style="flex:1;background:#059669;color:#fff;border:none;border-radius:8px;padding:8px 0;font-size:13px;font-weight:700;cursor:pointer">
        📋 取込
      </button>
      <button id="s1-cancel-btn" style="background:#f3f4f6;color:#374151;border:none;border-radius:8px;padding:8px 12px;font-size:12px;cursor:pointer">
        中止
      </button>
    </div>
    <div id="s1-status" style="font-size:11px;color:#6b7280;margin-top:6px"></div>
  `

  document.body.appendChild(panel)
  const handleEl = panel.querySelector('#s1-panel-handle')
  if (handleEl) {
    const handle = ctx.handle || ''
    handleEl.textContent = handle.startsWith('@') ? handle : '@' + handle
  }
  const autoCaptureToggle = panel.querySelector('#s1-auto-capture')
  if (autoCaptureToggle) {
    autoCaptureToggle.checked = s1AutoCaptureEnabled
    autoCaptureToggle.addEventListener('change', (e) => {
      setAutoCaptureEnabled(!!e.target.checked)
    })
  }

  panel.querySelector('#s1-capture-btn').addEventListener('click', async () => {
    await handleManualCapture(panel)
  })

  panel.querySelector('#s1-cancel-btn').addEventListener('click', () => {
    chrome.storage.local.remove(S1_TOUCH_KEY)
    chrome.runtime.sendMessage({ type: 's1_touch_cancelled' }).catch(() => {})
    closeS1CapturePanel()
  })

  startS1AutoCaptureWatch()
}

// ── S1 タッチフロー ────────────────────────────────────────────
async function tryFillS1() {
  let stored
  try {
    stored = await chrome.storage.local.get([S1_TOUCH_KEY])
  } catch (_) {
    return
  }

  const ctx = stored[S1_TOUCH_KEY]
  if (!ctx || !ctx.promptText) return
  if (ctx.setAt && ctx.setAt === lastHandledS1SetAt) return
  if (Date.now() - ctx.setAt > 30 * 60 * 1000) {
    chrome.storage.local.remove(S1_TOUCH_KEY)
    return
  }

  lastHandledS1SetAt = ctx.setAt

  const el = await waitForInput(12000)
  if (!el) {
    showError('入力エリアが見つかりませんでした。手動で貼り付けてください。')
  } else {
    injectText(el, ctx.promptText)
  }

  showS1CapturePanel(ctx)
}

function handleS1ContextChange() {
  tryFillS1()
}

// ── エントリーポイント ─────────────────────────────────────────
async function main() {
  await tryFillS1()
  if (!document.getElementById('s1-gemini-panel')) {
    await tryFill()
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  if (changes[S1_TOUCH_KEY]?.newValue && changes[S1_TOUCH_KEY].newValue.promptText && !changes[S1_TOUCH_KEY].newValue.capturedRaw) {
    handleS1ContextChange(changes[S1_TOUCH_KEY].newValue)
  }
  if (changes[STORAGE_KEY]?.newValue && changes[STORAGE_KEY].newValue.text) {
    tryFill()
  }
  if (changes[S1_AUTO_CAPTURE_KEY]) {
    s1AutoCaptureEnabled = changes[S1_AUTO_CAPTURE_KEY].newValue !== false
    if (!s1AutoCaptureEnabled) {
      stopS1AutoCaptureWatch()
    } else if (s1GeminiPanelEl) {
      startS1AutoCaptureWatch()
    }
    const toggle = s1GeminiPanelEl?.querySelector('#s1-auto-capture')
    if (toggle) toggle.checked = s1AutoCaptureEnabled
  }
})

loadAutoCaptureSetting()

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(main, 1200))
} else {
  setTimeout(main, 1200)
}
