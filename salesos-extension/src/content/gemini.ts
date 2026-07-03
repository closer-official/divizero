import type { GeminiAborted, GeminiCaptured, GeminiPrepare } from '../shared/protocol'

interface SessionState {
  draftText: string
  stepLabel: string
  copyFallback: boolean
  draftLength: number
}

let host: HTMLDivElement | null = null
let shadow: ShadowRoot | null = null
let session: SessionState | null = null
// Module-level refs so prepare() can access them after ensurePanel() creates them
let draftElement: HTMLDivElement | null = null
let metaElement: HTMLDivElement | null = null

const GLOBAL_FLAG = '__salesosGeminiInitialized'

if ((globalThis as typeof globalThis & Record<string, unknown>)[GLOBAL_FLAG]) {
  // Already initialized in this execution world.
} else {
  ;(globalThis as typeof globalThis & Record<string, unknown>)[GLOBAL_FLAG] = true

function ensurePanel() {
  if (host && shadow) return shadow

  host = document.createElement('div')
  host.id = 'salesos-gemini-panel'
  shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .panel {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        width: 320px;
        padding: 16px;
        border-radius: 18px;
        background: rgba(20, 25, 33, 0.96);
        color: #f5f7fb;
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
      }
      h2 {
        margin: 0 0 10px;
        font-size: 14px;
      }
      p {
        margin: 0 0 12px;
        color: #d7deea;
      }
      .draft {
        max-height: 140px;
        overflow: auto;
        margin: 0 0 10px;
        padding: 10px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.08);
        white-space: pre-wrap;
        word-break: break-word;
        color: #f1f6ff;
      }
      .meta {
        margin: -4px 0 10px;
        color: #9fb0c5;
        font-size: 12px;
      }
      .placeholder {
        color: #9fb0c5;
      }
      .status {
        min-height: 18px;
        margin-bottom: 10px;
        color: #ffca80;
      }
      .actions {
        display: grid;
        gap: 8px;
      }
      button {
        border: 0;
        border-radius: 999px;
        padding: 10px 12px;
        font: inherit;
        cursor: pointer;
      }
      .primary {
        background: #96f0c8;
        color: #0d2418;
        font-weight: 700;
      }
      .secondary {
        background: #243041;
        color: #f5f7fb;
      }
      .danger {
        background: #6f2530;
        color: #fff1f3;
      }
      .copy {
        display: none;
        background: #355d8b;
        color: #f4f8ff;
      }
    </style>
    <div class="panel">
      <h2 id="title">SalesOS Assistant</h2>
      <p>① 入力欄を確認（下書き挿入済み。空ならCtrl+Vで貼り付け）→ ② 送信を押す → ③ 出力のコピーボタンを押す → ④ 下の【取込】を押す</p>
      <div id="meta" class="meta"></div>
      <div id="draft" class="draft"></div>
      <div id="status" class="status"></div>
      <div class="actions">
        <button id="import" class="primary" type="button">取込</button>
        <button id="copy" class="copy" type="button">下書きをコピー</button>
        <button id="skip" class="secondary" type="button">この件をスキップ</button>
        <button id="abort" class="danger" type="button">中止</button>
      </div>
    </div>
  `

  const importButton = shadow.getElementById('import') as HTMLButtonElement
  const copyButton = shadow.getElementById('copy') as HTMLButtonElement
  const skipButton = shadow.getElementById('skip') as HTMLButtonElement
  const abortButton = shadow.getElementById('abort') as HTMLButtonElement
  // Assign to module-level so prepare() can access them
  draftElement = shadow.getElementById('draft') as HTMLDivElement
  metaElement = shadow.getElementById('meta') as HTMLDivElement

  importButton.addEventListener('click', async () => {
    if (!session) return
    const status = getStatusElement()
    try {
      const clipboardText = await navigator.clipboard.readText()
      const normalize = (s: string) => s.replace(/\r\n/g, '\n').trim()
      if (!clipboardText.trim() || normalize(clipboardText) === normalize(session.draftText)) {
        status.textContent = '出力のコピーボタンを押してから取込してください'
        return
      }
      const payload: GeminiCaptured = { cmd: 'GEMINI_CAPTURED', clipboardText }
      await chrome.runtime.sendMessage(payload)
      status.textContent = '取込待ちに進みました'
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'クリップボードを読めませんでした'
    }
  })

  copyButton.addEventListener('click', async () => {
    if (!session) return
    try {
      await navigator.clipboard.writeText(session.draftText)
      getStatusElement().textContent = '下書きをコピーしました。Gemini入力欄でCtrl+Vしてください'
    } catch (error) {
      getStatusElement().textContent = error instanceof Error ? error.message : 'コピーに失敗しました'
    }
  })

  skipButton.addEventListener('click', async () => {
    const payload: GeminiAborted = { cmd: 'GEMINI_ABORTED', reason: 'skip' }
    await chrome.runtime.sendMessage(payload)
  })

  abortButton.addEventListener('click', async () => {
    const payload: GeminiAborted = { cmd: 'GEMINI_ABORTED', reason: 'abort' }
    await chrome.runtime.sendMessage(payload)
  })

  document.documentElement.appendChild(host)
  return shadow
}

function getStatusElement(): HTMLDivElement {
  return ensurePanel().getElementById('status') as HTMLDivElement
}

function setTitle(stepLabel: string): void {
  ;(ensurePanel().getElementById('title') as HTMLHeadingElement).textContent = stepLabel
}

function setCopyFallback(visible: boolean): void {
  const button = ensurePanel().getElementById('copy') as HTMLButtonElement
  button.style.display = visible ? 'block' : 'none'
  button.textContent = visible ? '下書きをコピー（Ctrl+V用）' : '下書きをコピー'
}

function focusComposer(): HTMLElement | null {
  // Try Gemini-specific rich-textarea first
  const richTextArea = document.querySelector<HTMLElement>('rich-textarea div[contenteditable="true"]')
  if (richTextArea) {
    const rect = richTextArea.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      richTextArea.focus()
      return richTextArea
    }
  }

  // Try role="textbox" contenteditable (Gemini may use this)
  for (const el of document.querySelectorAll<HTMLElement>('[role="textbox"][contenteditable="true"]')) {
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      el.focus()
      return el
    }
  }

  // Fallback: any visible contenteditable / textarea / input
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('div[contenteditable="true"], textarea, input[type="text"]'),
  )
  const composer = candidates.find(element => {
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden'
  }) ?? candidates.at(-1) ?? null
  composer?.focus()
  return composer
}

function insertDraft(draftText: string): boolean {
  const composer = focusComposer()
  if (!composer) return false
  try {
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      const start = composer.selectionStart ?? composer.value.length
      const end = composer.selectionEnd ?? composer.value.length
      composer.setRangeText(draftText, start, end, 'end')
      composer.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
      return true
    }

    const selection = window.getSelection()
    if (!selection) return document.execCommand('insertText', false, draftText)

    const range = document.createRange()
    range.selectNodeContents(composer)
    selection.removeAllRanges()
    selection.addRange(range)

    const inserted = document.execCommand('insertText', false, draftText)
    if (inserted) {
      composer.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: draftText, inputType: 'insertText' }))
    }
    return inserted
  } catch {
    return false
  }
}

async function prepare(message: GeminiPrepare): Promise<void> {
  session = {
    draftText: message.draftText,
    stepLabel: message.stepLabel,
    copyFallback: false,
    draftLength: message.draftLength ?? message.draftText.length,
  }
  // setTitle calls ensurePanel(), which assigns draftElement and metaElement
  setTitle(message.stepLabel)
  draftElement!.textContent = message.draftText.trim()
    ? message.draftText
    : '下書きが空です。divizero 側のプロンプト読み込みを確認して、もう一度実行してください。'
  draftElement!.classList.toggle('placeholder', !message.draftText.trim())
  metaElement!.textContent = `下書き文字数: ${session.draftLength}`
  getStatusElement().textContent = ''
  setCopyFallback(false)

  try {
    await navigator.clipboard.writeText(message.draftText)
  } catch {
    session.copyFallback = true
    setCopyFallback(true)
    getStatusElement().textContent = 'Ctrl+V用の自動コピーに失敗しました。必要なら【コピー】を押してください'
  }

  // Retry insertDraft since Gemini's SPA may not have rendered the input yet
  let inserted = false
  for (let attempt = 0; attempt < 6 && !inserted; attempt++) {
    if (attempt > 0) {
      getStatusElement().textContent = `入力欄を探しています... (${attempt}/5)`
      await new Promise(r => setTimeout(r, 1000))
    }
    inserted = insertDraft(message.draftText)
  }

  if (inserted) {
    getStatusElement().textContent = '下書きを準備しました。Gemini で送信してください'
  } else if (!session.copyFallback) {
    getStatusElement().textContent = '入力欄へ自動挿入できませんでした。右下の【下書きをコピー】を押して貼り付けてください'
  }
}

chrome.runtime.onMessage.addListener((message: GeminiPrepare, _sender, sendResponse) => {
  if (message.cmd !== 'GEMINI_PREPARE') return false
  void prepare(message)
    .then(() => sendResponse({ ok: true }))
    .catch(error => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'prepare failed' }))
  return true
})
}
