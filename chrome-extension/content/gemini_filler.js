'use strict'

const STORAGE_KEY = 'os2_gemini_prompt'
const S1_TOUCH_KEY = 's1_touch_context'
const MAX_AGE_MS = 5 * 60 * 1000

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
  const existing = document.getElementById('s1-gemini-panel')
  if (existing) existing.remove()

  const panel = document.createElement('div')
  panel.id = 's1-gemini-panel'
  Object.assign(panel.style, {
    position: 'fixed', bottom: '20px', right: '20px', zIndex: '999999',
    background: '#fff', border: '2px solid #059669', borderRadius: '14px',
    boxShadow: '0 6px 24px rgba(5,150,105,0.25)', padding: '14px 16px',
    maxWidth: '320px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  })

  panel.innerHTML = `
    <div style="font-size:13px;font-weight:700;color:#065f46;margin-bottom:6px">
      💬 S1接触 — @${ctx.handle || ''}
    </div>
    <div style="font-size:11px;color:#374151;line-height:1.6;margin-bottom:10px">
      ① プロンプト挿入済み<br>
      ② スクショを追加して送信<br>
      ③ AIの出力を<strong>全選択→コピー</strong>（Ctrl+A → Ctrl+C）<br>
      ④ 下の【取込】を押す
    </div>
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

  panel.querySelector('#s1-capture-btn').addEventListener('click', async () => {
    const btn = panel.querySelector('#s1-capture-btn')
    const status = panel.querySelector('#s1-status')
    btn.textContent = '読み取り中...'
    btn.disabled = true
    try {
      const text = await navigator.clipboard.readText()
      if (!text || text.trim().length < 10) {
        status.textContent = 'クリップボードが空です。AIの出力をコピーしてから押してください。'
        btn.textContent = '📋 取込'
        btn.disabled = false
        return
      }
      status.textContent = '送信中...'
      chrome.runtime.sendMessage({ type: 's1_gemini_captured', clipboardText: text })
      panel.remove()
    } catch (_) {
      status.textContent = 'クリップボード読み取りに失敗しました。ページをリロードして再試行してください。'
      btn.textContent = '📋 取込'
      btn.disabled = false
    }
  })

  panel.querySelector('#s1-cancel-btn').addEventListener('click', () => {
    chrome.storage.local.remove(S1_TOUCH_KEY)
    chrome.runtime.sendMessage({ type: 's1_touch_cancelled' }).catch(() => {})
    panel.remove()
  })
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
  if (Date.now() - ctx.setAt > 30 * 60 * 1000) {
    chrome.storage.local.remove(S1_TOUCH_KEY)
    return
  }

  const el = await waitForInput(12000)
  if (!el) {
    showError('入力エリアが見つかりませんでした。手動で貼り付けてください。')
  } else {
    injectText(el, ctx.promptText)
  }

  showS1CapturePanel(ctx)
}

// ── エントリーポイント ─────────────────────────────────────────
async function main() {
  await tryFillS1()
  if (!document.getElementById('s1-gemini-panel')) {
    await tryFill()
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(main, 1200))
} else {
  setTimeout(main, 1200)
}
