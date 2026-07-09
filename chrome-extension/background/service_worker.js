'use strict'

const QUEUE_KEY = 'os_ext_queue'
const S1_TOUCH_KEY = 's1_touch_context'
const OS0_CONTEXT_KEY = 'os0_context'
const OS0_PROMPT_CACHE_KEY = 'os0_prompt_cache'
const OS0_PROMPT_FILE = '/prompts/OS0_X_一次選別_v2.md'
const OS0_PROMPT_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const VERSION = '2.1.0'
const DEFAULT_WEBAPP_URL = 'https://divizero.vercel.app'
const GEMINI_URL = 'https://gemini.google.com/app'

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

async function getWebappUrl() {
  const result = await chrome.storage.local.get(['webappUrl'])
  return (result.webappUrl || DEFAULT_WEBAPP_URL).replace(/\/$/, '')
}

async function fetchOS0Prompt(webappBase) {
  const cached = await chrome.storage.local.get([OS0_PROMPT_CACHE_KEY])
  const cache = cached[OS0_PROMPT_CACHE_KEY]
  if (cache && cache.text && (Date.now() - cache.cachedAt) < OS0_PROMPT_CACHE_TTL_MS) {
    return cache.text
  }
  const url = webappBase + OS0_PROMPT_FILE
  const res = await fetch(url)
  if (!res.ok) throw new Error(`OS0プロンプト取得失敗 (${res.status})`)
  const text = await res.text()
  await chrome.storage.local.set({ [OS0_PROMPT_CACHE_KEY]: { text, cachedAt: Date.now() } })
  return text
}

function buildOS0Prompt(promptText, accountsSection, excludedHandles) {
  const excludedList = (excludedHandles || []).filter(Boolean)
  const splitMarker = '\n\n【除外済みアカウント'
  const splitPoint = promptText.indexOf(splitMarker)
  if (splitPoint !== -1) {
    const beforeExcluded = promptText.slice(0, splitPoint)
    const excludedPart = promptText.slice(splitPoint)
    return beforeExcluded + '\n\n' + accountsSection + excludedPart + (excludedList.length > 0 ? '\n' + excludedList.join('\n') : '')
  }
  const excludedSection = `\n\n【除外済みアカウント（再判定不要）】\n以下のアカウントは過去に接触済み・SKIP・除外済みです。▼判定一覧に含まれていた場合は無条件で✕（除外済み）としてください：${excludedList.length > 0 ? '\n' + excludedList.join('\n') : ''}`
  return promptText + excludedSection + '\n\n' + accountsSection
}

async function prepareOS0PromptPayload({ accountsSection, sourceContext }) {
  const webappBase = await getWebappUrl()
  const promptText = await fetchOS0Prompt(webappBase)

  let excludedHandles = []
  let excludedApplied = false
  let excludedCount = 0

  try {
    const webappTabId = await findExistingWebappTabId()
    if (webappTabId != null) {
      await repairWebappBridgeIfNeeded(webappTabId)
      const bridgeResp = await callWebAppBridge(webappTabId, 'GET_EXCLUDED', { channel: 'twitter' })
      if (bridgeResp?.ok && Array.isArray(bridgeResp.payload?.handles)) {
        excludedHandles = bridgeResp.payload.handles.filter(h => typeof h === 'string')
        excludedApplied = true
        excludedCount = excludedHandles.length
      }
    }
  } catch (err) {
    console.warn('[OS0] excluded list unavailable, continuing without it:', err?.message || err)
  }

  const fullPrompt = buildOS0Prompt(promptText, accountsSection, excludedHandles)
  return {
    promptText: fullPrompt,
    excludedApplied,
    excludedCount,
    sourceContext,
  }
}

// ── ウェブアプリタブを開く or フォーカス ──────────────────────

async function openOrFocusWebapp() {
  const webappUrl = await getWebappUrl()
  const allTabs = await chrome.tabs.query({})
  const existing = allTabs.find(tab => tab.url && tab.url.startsWith(webappUrl))
  if (existing && existing.id != null) {
    await chrome.tabs.update(existing.id, { active: true })
    if (existing.windowId != null) {
      await chrome.windows.update(existing.windowId, { focused: true })
    }
    return
  }
  await chrome.tabs.create({ url: webappUrl })
}

// タブが完全ロードされるまで待つ
function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      reject(new Error('Tab load timeout'))
    }, timeoutMs || 30000)

    const listener = (id, info) => {
      if (id !== tabId || info.status !== 'complete') return
      clearTimeout(timer)
      chrome.tabs.onUpdated.removeListener(listener)
      setTimeout(() => resolve(tabId), 600) // content scripts need a moment
    }
    chrome.tabs.onUpdated.addListener(listener)
  })
}

// ウェブアプリのタブ ID を取得（ない場合は開いて待つ）
async function findOrOpenWebappTabId() {
  const webappUrl = await getWebappUrl()
  const allTabs = await chrome.tabs.query({})
  const existing = allTabs.find(tab => tab.url && tab.url.startsWith(webappUrl))

  if (existing && existing.id != null) {
    if (existing.status === 'complete') return existing.id
    return await waitForTabComplete(existing.id)
  }

  const newTab = await chrome.tabs.create({ url: webappUrl })
  return await waitForTabComplete(newTab.id)
}

async function findExistingWebappTabId() {
  const webappUrl = await getWebappUrl()
  const allTabs = await chrome.tabs.query({})
  const existing = allTabs.find(tab => tab.url && tab.url.startsWith(webappUrl))
  return existing && existing.id != null ? existing.id : null
}

// ── webapp_bridge.js 経由でウェブアプリの extensionBridge を呼ぶ ──

function callWebAppBridge(tabId, bridgeType, payload) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: 'webapp_bridge', bridgeType, payload: payload || {} },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else {
          resolve(response)
        }
      },
    )
  })
}

// webapp_bridge.js が orphaned になっていたら再注入して修復する
function repairWebappBridgeIfNeeded(tabId) {
  return new Promise(resolve => {
    // type が 'webapp_bridge' でないメッセージを送ると false が返る（bridge 生存確認）
    // 返答がなく "Receiving end does not exist" なら orphaned → 再注入
    chrome.tabs.sendMessage(tabId, { type: '__bridge_probe__' }, () => {
      const errMsg = (chrome.runtime.lastError || {}).message || ''
      if (!errMsg.includes('Receiving end does not exist')) {
        resolve() // bridge は生きている（または別のエラー）
        return
      }
      // orphaned → webapp_bridge.js を再注入
      chrome.scripting.executeScript(
        { target: { tabId }, files: ['content/webapp_bridge.js'] },
        () => setTimeout(resolve, 700),
      )
    })
  })
}

// ── Gemini タブを開く or フォーカス ──────────────────────────

async function openOrFocusGemini() {
  const allTabs = await chrome.tabs.query({})
  const existing = allTabs.find(tab => tab.url && tab.url.startsWith('https://gemini.google.com'))
  if (existing && existing.id != null) {
    await chrome.tabs.update(existing.id, { active: true })
    if (existing.windowId != null) await chrome.windows.update(existing.windowId, { focused: true })
    return existing.id
  }
  const tab = await chrome.tabs.create({ url: GEMINI_URL })
  return tab.id
}

// ── タッチ出力の A/B パース（フォールバック専用。正規実装は src/utils/touchPrompt.ts）─────────

function parseTouchOutputBasic(raw) {
  const block = raw.match(/={1,3}TOUCH_START={1,3}([\s\S]*?)={1,3}TOUCH_END={1,3}/)?.[1]
  if (!block) return null

  const pick = (label) => {
    const m = block.match(new RegExp(label + '\\s*[:：]\\s*(.+)'))
    return m ? m[1].trim() : ''
  }

  const pickUntil = (label, stopLabel) => {
    const m = block.match(new RegExp(label + '\\s*[:：]\\s*([\\s\\S]+?)(?=\\n' + stopLabel + '|$)'))
    return m ? m[1].trim() : ''
  }

  const textA = pickUntil('提案文A', '仮判定A')
  const textB = pickUntil('提案文B', '仮判定B')
  const judgeA = pick('仮判定A')
  const judgeB = pick('仮判定B')

  if (!textA && !textB) return null

  return {
    optionA: { text: textA || '（案Aが取得できませんでした）', judge: judgeA },
    optionB: { text: textB || '（案Bが取得できませんでした）', judge: judgeB },
    raw,
  }
}

async function parseTouchOutputViaBridge(clipboardText, ctx) {
  const webappTabId = ctx.webappTabId || (await findOrOpenWebappTabId())
  await repairWebappBridgeIfNeeded(webappTabId)

  let bridgeResp
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      bridgeResp = await callWebAppBridge(webappTabId, 'PARSE_TOUCH_OUTPUT', { raw: clipboardText })
      break
    } catch (err) {
      if (attempt < 2) await new Promise(r => setTimeout(r, 1200))
      else throw err
    }
  }

  if (!bridgeResp?.ok) return null

  const payload = bridgeResp.payload || {}
  if (payload.ok === false) {
    return { ok: false }
  }
  if (payload.ok && payload.optionA && payload.optionB) {
    return {
      ok: true,
      optionA: payload.optionA,
      optionB: payload.optionB,
    }
  }
  return null
}

// ── webapp タブへ Extension ID を注入 ─────────────────────────

const WEBAPP_ORIGINS = ['https://divizero.vercel.app', 'http://localhost:5173']

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return
  if (!tab.url || !WEBAPP_ORIGINS.some(o => tab.url.startsWith(o))) return

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (id) => {
        if (!window.__OS_EXT_ID) {
          Object.defineProperty(window, '__OS_EXT_ID', {
            value: id,
            writable: false,
            configurable: false,
            enumerable: false,
          })
        }
        window.dispatchEvent(new CustomEvent('os_ext_ready', { detail: { id } }))
      },
      args: [chrome.runtime.id],
    })
  } catch (_) {}
})

// ── コンテンツスクリプトからの受信 ───────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ── OS② enqueue（既存） ──────────────────────────────────────
  if (message.type === 'enqueue') {
    console.log('[OS Ext BG] enqueue received, itemType:', message.itemType)

    const item = {
      id: genId(),
      type: message.itemType,
      status: 'pending',
      payload: message.payload,
      enqueuedAt: new Date().toISOString(),
    }

    chrome.storage.local.get([QUEUE_KEY], result => {
      const queue = result[QUEUE_KEY] || []
      queue.push(item)
      chrome.storage.local.set({ [QUEUE_KEY]: queue }, () => {
        openOrFocusWebapp()
        sendResponse({ ok: true, id: item.id })
      })
    })

    return true
  }

  // ── OS⓪ prompt build only ─────────────────────────────────────
  if (message.type === 'os0_prepare_prompt') {
    handleOS0PreparePrompt(message, sender.tab?.id, sendResponse)
    return true
  }

  // ── OS⓪ start ────────────────────────────────────────────────
  if (message.type === 'os0_start') {
    handleOS0Start(message, sender.tab?.id, sendResponse)
    return true
  }

  // ── S1接触 開始 ───────────────────────────────────────────────
  if (message.type === 's1_touch_start') {
    const xTabId = sender.tab?.id
    const { handle, tweetUrl, tweetText } = message
    handleS1TouchStart({ handle, tweetUrl, tweetText, xTabId }, sendResponse)
    return true
  }

  // ── Gemini 出力取込 ───────────────────────────────────────────
  if (message.type === 'os0_gemini_captured') {
    handleOS0Captured(message.rawText, sender.tab?.id)
    return false
  }
  if (message.type === 's1_gemini_captured') {
    handleS1GeminiCaptured(message.clipboardText, sender.tab?.id)
    return false
  }

  // ── 送信完了・記録 ────────────────────────────────────────────
  if (message.type === 's1_touch_sent') {
    handleS1TouchSent(message)
    return false
  }

  // ── キャンセル ────────────────────────────────────────────────
  if (message.type === 's1_touch_cancelled') {
    chrome.storage.local.remove(S1_TOUCH_KEY)
    return false
  }

  return false
})

// ── S1接触 フロー ─────────────────────────────────────────────

async function handleS1TouchStart(params, sendResponse) {
  const { handle, tweetUrl, tweetText, xTabId, force } = params

  try {
    if (!force) {
      const stored = await chrome.storage.local.get([S1_TOUCH_KEY])
      const prev = stored[S1_TOUCH_KEY]
      if (prev && prev.setAt && Date.now() - prev.setAt < 30 * 60 * 1000) {
        sendResponse({ ok: false, code: 'CONTEXT_EXISTS', prevHandle: prev.handle || prev.accountName || '@unknown' })
        return
      }
    }

    // 1. ウェブアプリのタブを取得
    const webappTabId = await findOrOpenWebappTabId()

    // 1b. webapp_bridge.js が orphaned なら自動修復
    await repairWebappBridgeIfNeeded(webappTabId)

    // 2. タッチプロンプトを取得
    let bridgeResp
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        bridgeResp = await callWebAppBridge(webappTabId, 'GET_TOUCH_PROMPT', { handle })
        break
      } catch (err) {
        if (attempt < 2) await new Promise(r => setTimeout(r, 1200))
        else throw err
      }
    }

    if (!bridgeResp?.ok || !bridgeResp.payload?.found) {
      // パイプラインにない
      const msg = bridgeResp?.payload?.found === false
        ? `@${handle} はパイプライン未登録です。OS①でスクリーニング後に追加してください。`
        : 'プロンプト取得に失敗しました。ウェブアプリが開いているか確認してください。'

      // X タブに通知
      if (xTabId) {
        try { chrome.tabs.sendMessage(xTabId, { type: 's1_error', message: msg }) } catch (_) {}
      }
      sendResponse({ ok: false, message: msg })
      return
    }

    const { promptText, pipelineItemId, accountName } = bridgeResp.payload

    // 3. ストレージに保存
    const ctx = {
      handle,
      tweetUrl,
      tweetText,
      pipelineItemId,
      accountName,
      promptText,
      xTabId,
      webappTabId,
      setAt: Date.now(),
    }
    await chrome.storage.local.set({ [S1_TOUCH_KEY]: ctx })

    // 4. Gemini を開く
    await openOrFocusGemini()

    sendResponse({ ok: true, accountName })
  } catch (err) {
    console.error('[S1 Touch] handleS1TouchStart error:', err)
    sendResponse({ ok: false, message: err.message || 'エラーが発生しました' })
  }
}

async function handleOS0PreparePrompt(message, _senderTabId, sendResponse) {
  try {
    const accountsSection = typeof message.accountsSection === 'string' ? message.accountsSection : ''
    const sourceContext = message.sourceContext || {}
    if (!accountsSection || !sourceContext) {
      sendResponse({ ok: false, message: 'invalid_payload' })
      return
    }
    const payload = await prepareOS0PromptPayload({ accountsSection, sourceContext })
    sendResponse({
      ok: true,
      promptText: payload.promptText,
      excludedApplied: payload.excludedApplied,
      excludedCount: payload.excludedCount,
    })
  } catch (err) {
    console.error('[OS0] prepare prompt failed:', err)
    sendResponse({ ok: false, message: err?.message || 'prompt_build_failed' })
  }
}

async function handleOS0Start(message, senderTabId, sendResponse) {
  try {
    const accountsSection = typeof message.accountsSection === 'string' ? message.accountsSection : ''
    const accountCount = Number(message.accountCount) || 0
    const sourceContext = message.sourceContext || {}
    if (!accountsSection || !sourceContext) {
      sendResponse({ ok: false, message: 'invalid_payload' })
      return
    }

    const payload = await prepareOS0PromptPayload({ accountsSection, sourceContext })
    const ctx = {
      promptText: payload.promptText,
      channel: 'twitter',
      accountCount,
      sourceContext,
      xTabId: senderTabId,
      setAt: Date.now(),
      excludedApplied: payload.excludedApplied,
      excludedCount: payload.excludedCount,
    }
    await chrome.storage.local.set({ [OS0_CONTEXT_KEY]: ctx })
    await openOrFocusGemini()

    sendResponse({
      ok: true,
      accountCount,
      excludedApplied: payload.excludedApplied,
      excludedCount: payload.excludedCount,
    })
  } catch (err) {
    console.error('[OS0] start failed:', err)
    sendResponse({ ok: false, message: err?.message || 'prompt_build_failed' })
  }
}

async function handleOS0Captured(rawText, geminiTabId) {
  const stored = await chrome.storage.local.get([OS0_CONTEXT_KEY])
  const ctx = stored[OS0_CONTEXT_KEY]
  if (!ctx) {
    console.warn('[OS0] gemini_captured but no context')
    return
  }

  let result = null
  try {
    const webappTabId = await findOrOpenWebappTabId()
    await repairWebappBridgeIfNeeded(webappTabId)
    const bridgeResp = await callWebAppBridge(webappTabId, 'OS0_IMPORT', {
      aiOutput: rawText,
      channel: ctx.channel || 'twitter',
      sourceContext: ctx.sourceContext,
    })
    result = bridgeResp?.payload || null
  } catch (err) {
    console.error('[OS0] import failed:', err)
    result = { ok: false, missing: ['webapp_bridge_failed'] }
  }

  if (geminiTabId) {
    try {
      chrome.tabs.sendMessage(geminiTabId, { type: 'os0_import_result', result })
    } catch (_) {}
  }

  if (result?.ok) {
    await chrome.storage.local.remove(OS0_CONTEXT_KEY)
  }
}

async function handleS1GeminiCaptured(clipboardText, geminiTabId) {
  const stored = await chrome.storage.local.get([S1_TOUCH_KEY])
  const ctx = stored[S1_TOUCH_KEY]
  if (!ctx) {
    console.warn('[S1 Touch] gemini_captured but no context')
    return
  }

  let parsed = null
  try {
    const bridgeParsed = await parseTouchOutputViaBridge(clipboardText, ctx)
    if (bridgeParsed && bridgeParsed.ok === false) {
      if (ctx.xTabId) {
        chrome.tabs.sendMessage(ctx.xTabId, {
          type: 's1_error',
          message: 'AIの出力形式を認識できませんでした。===TOUCH_START=== / ===TOUCH_END=== が含まれているか確認してください。',
        }).catch(() => {})
      }
      return
    }
    if (bridgeParsed && bridgeParsed.ok === true) {
      parsed = bridgeParsed
    }
  } catch (_) {
    parsed = parseTouchOutputBasic(clipboardText)
  }

  if (!parsed) {
    parsed = parseTouchOutputBasic(clipboardText)
  }
  if (!parsed) {
    if (ctx.xTabId) {
      chrome.tabs.sendMessage(ctx.xTabId, {
        type: 's1_error',
        message: 'AIの出力形式を認識できませんでした。===TOUCH_START=== / ===TOUCH_END=== が含まれているか確認してください。',
      }).catch(() => {})
    }
    return
  }

  // コンテキストに解析済み案を保存
  const updatedCtx = { ...ctx, capturedRaw: clipboardText, optionA: parsed.optionA, optionB: parsed.optionB }
  await chrome.storage.local.set({ [S1_TOUCH_KEY]: updatedCtx })

  // X タブを開いて A/B パネルを表示
  if (ctx.xTabId) {
    try {
      await chrome.tabs.update(ctx.xTabId, { active: true })
      const tab = await chrome.tabs.get(ctx.xTabId)
      if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true })

      // 少し待ってからメッセージ
      setTimeout(() => {
        chrome.tabs.sendMessage(ctx.xTabId, {
          type: 's1_ab_ready',
          tweetUrl: ctx.tweetUrl,
          optionA: parsed.optionA,
          optionB: parsed.optionB,
          accountName: ctx.accountName,
        }).catch(err => console.warn('[S1 Touch] sendMessage to X tab failed:', err))
      }, 500)
    } catch (err) {
      console.error('[S1 Touch] Failed to focus X tab:', err)
    }
  }
}

async function handleS1TouchSent(message) {
  const stored = await chrome.storage.local.get([S1_TOUCH_KEY])
  const ctx = stored[S1_TOUCH_KEY]
  if (!ctx) return

  try {
    const webappTabId = ctx.webappTabId || (await findOrOpenWebappTabId())
    await repairWebappBridgeIfNeeded(webappTabId)
    await callWebAppBridge(webappTabId, 'RECORD_TOUCH', {
      pipelineItemId: ctx.pipelineItemId,
      postUrl: ctx.tweetUrl,
      postText: ctx.tweetText,
      sentText: message.sentText,
      aiSuggestedText: message.aiSuggestedText || '',
    })
    console.log('[S1 Touch] Touch recorded successfully')
  } catch (err) {
    console.error('[S1 Touch] handleS1TouchSent error:', err)
  } finally {
    chrome.storage.local.remove(S1_TOUCH_KEY)
  }
}

// ── webappからの外部メッセージ（externally_connectable）────────

chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ping') {
    sendResponse({ version: VERSION })
    return
  }

  if (message.type === 'get_queue') {
    chrome.storage.local.get([QUEUE_KEY], result => {
      const items = result[QUEUE_KEY] || []
      sendResponse({ items })
    })
    return true
  }

  if (message.type === 'update_status') {
    chrome.storage.local.get([QUEUE_KEY], result => {
      const queue = (result[QUEUE_KEY] || []).map(item => {
        if (item.id !== message.id) return item
        return {
          ...item,
          status: message.status,
          processedAt: message.processedAt || new Date().toISOString(),
        }
      })
      chrome.storage.local.set({ [QUEUE_KEY]: queue }, () => {
        sendResponse({ ok: true })
      })
    })
    return true
  }

  if (message.type === 'clear_history') {
    chrome.storage.local.get([QUEUE_KEY], result => {
      const queue = (result[QUEUE_KEY] || []).filter(item => item.status === 'pending')
      chrome.storage.local.set({ [QUEUE_KEY]: queue }, () => {
        sendResponse({ ok: true })
      })
    })
    return true
  }

  if (message.type === 'set_gemini_prompt') {
    chrome.storage.local.set({
      os2_gemini_prompt: { text: message.text || '', setAt: Date.now() },
    }, () => {
      sendResponse({ ok: true })
    })
    return true
  }

  if (message.type === 'set_pipeline_handles') {
    chrome.storage.local.set({
      os2_pipeline_handles: { handles: message.handles || [], updatedAt: Date.now() },
    }, () => {
      sendResponse({ ok: true })
    })
    return true
  }
})
