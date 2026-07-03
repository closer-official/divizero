import type { PopupCommand, PopupResponse, RunState } from '../shared/protocol'

const PHASE_LABELS: Record<RunState['phase'], string> = {
  IDLE: '待機',
  OS0_CAPTURE: 'OS⓪ 取得',
  OS0_GEMINI: 'OS⓪ Gemini待ち',
  OS0_IMPORT: 'OS⓪ 取込',
  OS1_NAV: 'OS① 遷移待ち',
  OS1_CAPTURE: 'OS① 取得',
  OS1_GEMINI: 'OS① Gemini待ち',
  OS1_IMPORT: 'OS① 取込',
  PAUSED: '一時停止',
  DONE: '完了',
  ERROR: 'エラー',
}

const app = document.getElementById('app') as HTMLDivElement

app.innerHTML = `
  <style>
    body {
      margin: 0;
      background: #f4f0e8;
      color: #1d1f22;
      font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: 360px;
      padding: 16px;
      box-sizing: border-box;
    }
    .card {
      background: #fffaf3;
      border: 1px solid #dfd6c9;
      border-radius: 18px;
      padding: 14px;
      box-shadow: 0 12px 28px rgba(61, 43, 17, 0.08);
    }
    h1 {
      margin: 0 0 12px;
      font-size: 16px;
    }
    .meta {
      margin: 8px 0;
      color: #665c4d;
    }
    .row {
      display: grid;
      gap: 8px;
      margin-top: 12px;
    }
    .row input {
      border: 1px solid #cabda8;
      border-radius: 10px;
      padding: 9px 10px;
      font: inherit;
      background: #fff;
    }
    .buttons {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-top: 12px;
    }
    button {
      border: 0;
      border-radius: 999px;
      padding: 10px 12px;
      font: inherit;
      cursor: pointer;
    }
    .primary { background: #2d6a4f; color: #f4fff6; }
    .secondary { background: #e8dcc9; color: #3f3325; }
    .danger { background: #8b3a3a; color: #fff5f5; }
    .ghost { background: #d9ecff; color: #0f426a; }
    ul {
      margin: 10px 0 0;
      padding-left: 18px;
    }
    #message {
      min-height: 20px;
      margin-top: 10px;
      color: #7b3829;
    }
  </style>
  <section class="card">
    <h1>SalesOS Assistant</h1>
    <div id="phase" class="meta">状態: 読み込み中</div>
    <div id="progress" class="meta"></div>
    <div id="stats" class="meta"></div>
    <div id="connection" class="meta"></div>
    <div class="row">
      <label for="limitN">上限N（1〜30）</label>
      <input id="limitN" type="number" min="1" max="30" value="10" />
    </div>
    <div class="buttons">
      <button id="start" class="primary" type="button">OS①まで実行</button>
      <button id="pause" class="secondary" type="button">一時停止</button>
      <button id="resume" class="ghost" type="button">再開</button>
      <button id="abort" class="danger" type="button">中止</button>
    </div>
    <button id="startFromQueue" class="ghost" type="button" style="width:100%; margin-top:8px;">OS⓪スキップ → OS①処理（スクリーニング消化）</button>
    <button id="refresh" class="secondary" type="button" style="width:100%; margin-top:8px;">前回結果を見る</button>
    <div id="message"></div>
    <ul id="errors"></ul>
  </section>
`

const limitInput = document.getElementById('limitN') as HTMLInputElement
const phaseEl = document.getElementById('phase') as HTMLDivElement
const progressEl = document.getElementById('progress') as HTMLDivElement
const statsEl = document.getElementById('stats') as HTMLDivElement
const connectionEl = document.getElementById('connection') as HTMLDivElement
const messageEl = document.getElementById('message') as HTMLDivElement
const errorsEl = document.getElementById('errors') as HTMLUListElement
const startButton = document.getElementById('start') as HTMLButtonElement

async function sendCommand(message: PopupCommand): Promise<PopupResponse> {
  return chrome.runtime.sendMessage(message) as Promise<PopupResponse>
}

function isXUrl(url: string | undefined): boolean {
  return Boolean(url && /^https:\/\/(x|twitter)\.com\//.test(url))
}

async function getActiveTabIsX(): Promise<boolean> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return isXUrl(tab?.url)
}

function render(response: PopupResponse, activeTabIsX: boolean): void {
  const { runState, connection } = response
  const baseMessage = response.ok ? runState.message || '' : response.message
  const warningMessage = '⚠️ Xの検索結果かフォロワー一覧を開いてから実行してください'

  phaseEl.textContent = `状態: ${PHASE_LABELS[runState.phase]}`
  progressEl.textContent = `進捗: ${Math.min(runState.currentIndex, runState.queue.length)}/${runState.queue.length}`
  statsEl.textContent = `OS0取得 ${runState.stats.os0Captured} / OS0通過 ${runState.stats.os0Passed} / OS1完了 ${runState.stats.os1Done} / OS1失敗 ${runState.stats.os1Failed}`
  connectionEl.textContent =
    connection.status === 'connected'
      ? `divizero接続: OK (${connection.version || 'version unknown'})`
      : connection.status === 'error'
        ? `divizero接続: エラー (${connection.error || 'unknown'})`
        : 'divizero接続: 未確認'
  startButton.disabled = !activeTabIsX
  messageEl.textContent =
    activeTabIsX
      ? baseMessage
      : baseMessage
        ? `${warningMessage} / ${baseMessage}`
        : warningMessage
  errorsEl.innerHTML = ''
  for (const error of runState.errors.slice(-3).reverse()) {
    const item = document.createElement('li')
    item.textContent = `[${error.phase}] ${error.message}`
    errorsEl.appendChild(item)
  }
}

async function refresh(): Promise<void> {
  const [response, activeTabIsX] = await Promise.all([
    sendCommand({ cmd: 'POPUP_STATUS' }),
    getActiveTabIsX(),
  ])
  render(response, activeTabIsX)
}

document.getElementById('start')!.addEventListener('click', async () => {
  const response = await sendCommand({ cmd: 'POPUP_START', limitN: Number(limitInput.value) || 10 })
  render(response, await getActiveTabIsX())
})

document.getElementById('pause')!.addEventListener('click', async () => {
  const response = await sendCommand({ cmd: 'POPUP_PAUSE' })
  render(response, await getActiveTabIsX())
})

document.getElementById('resume')!.addEventListener('click', async () => {
  const response = await sendCommand({ cmd: 'POPUP_RESUME' })
  render(response, await getActiveTabIsX())
})

document.getElementById('abort')!.addEventListener('click', async () => {
  const response = await sendCommand({ cmd: 'POPUP_ABORT' })
  render(response, await getActiveTabIsX())
})

document.getElementById('startFromQueue')!.addEventListener('click', async () => {
  const response = await sendCommand({ cmd: 'POPUP_START_FROM_QUEUE', limitN: Number(limitInput.value) || 10 })
  render(response, await getActiveTabIsX())
})

document.getElementById('refresh')!.addEventListener('click', refresh)

void refresh()
window.setInterval(() => void refresh(), 1000)
