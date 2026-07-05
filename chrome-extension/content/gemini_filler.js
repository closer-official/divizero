'use strict'

const STORAGE_KEY = 'os2_gemini_prompt'
const MAX_AGE_MS = 5 * 60 * 1000 // 5分以内のものだけ使う

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

  // 方法1: execCommand（React contenteditable に最も効果的）
  if (document.execCommand) {
    try {
      const ok = document.execCommand('insertText', false, text)
      if (ok) return true
    } catch (_) {}
  }

  // 方法2: ClipboardEvent のシミュレーション
  try {
    const dt = new DataTransfer()
    dt.setData('text/plain', text)
    el.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: dt, bubbles: true, cancelable: true,
    }))
    return true
  } catch (_) {}

  // 方法3: textContent を直接書き換えて InputEvent を発火
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

// ── 完了通知バナー ─────────────────────────────────────────────
function showBanner() {
  const div = document.createElement('div')
  div.id = 'os2-gemini-notice'
  div.textContent = '✓ OS②プロンプトを自動入力しました。投稿スクショを追加して送信してください。'
  Object.assign(div.style, {
    position: 'fixed', top: '16px', right: '16px', zIndex: '999999',
    background: '#4f46e5', color: '#fff', padding: '12px 18px',
    borderRadius: '12px', fontSize: '13px', fontWeight: '600',
    boxShadow: '0 4px 20px rgba(79,70,229,0.4)', maxWidth: '340px',
    lineHeight: '1.5', cursor: 'pointer',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  })
  div.addEventListener('click', () => div.remove())
  document.body.appendChild(div)
  setTimeout(() => { if (div.parentNode) div.remove() }, 6000)
}

// ── エラーバナー ───────────────────────────────────────────────
function showError(msg) {
  const div = document.createElement('div')
  div.textContent = '⚠ ' + msg
  Object.assign(div.style, {
    position: 'fixed', top: '16px', right: '16px', zIndex: '999999',
    background: '#dc2626', color: '#fff', padding: '10px 16px',
    borderRadius: '10px', fontSize: '13px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  })
  document.body.appendChild(div)
  setTimeout(() => { if (div.parentNode) div.remove() }, 4000)
}

// ── メインフロー ───────────────────────────────────────────────
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
  // 使い終わったら即削除（同じタブで再度開かれても再注入しない）
  chrome.storage.local.remove(STORAGE_KEY)

  const el = await waitForInput(12000)
  if (!el) {
    showError('入力エリアが見つかりませんでした。手動で貼り付けてください。')
    return
  }

  const ok = injectText(el, text)
  if (ok) {
    showBanner()
  } else {
    showError('テキスト挿入に失敗しました。手動で貼り付けてください。')
  }
}

// Gemini は SPA なのでページ遷移後も再チェックする
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(tryFill, 1200))
} else {
  setTimeout(tryFill, 1200)
}
