'use strict'

// ── 設定 ───────────────────────────────────────────────────────
const DEFAULT_WEBAPP_BASE = 'https://divizero.vercel.app'
const DEFAULT_MAX_ACCOUNTS = 20

const AI_URLS = {
  gemini:  'https://gemini.google.com/',
  chatgpt: 'https://chatgpt.com/',
  claude:  'https://claude.ai/',
}

// ── 状態 ───────────────────────────────────────────────────────
let collectedCards = []
let scanDebounce = null
let floatingBtn = null
let lastUrl = location.href

// ── 設定取得 ───────────────────────────────────────────────────

async function getSettings() {
  const stored = await chrome.storage.local.get(['webappUrl', 'maxAccounts', 'aiTarget'])
  return {
    webappBase: (stored.webappUrl || DEFAULT_WEBAPP_BASE).replace(/\/$/, ''),
    maxAccounts: Number(stored.maxAccounts) || DEFAULT_MAX_ACCOUNTS,
    aiTarget: stored.aiTarget || 'gemini',
  }
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (resp) => {
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

// ── ページ種別検出 ─────────────────────────────────────────────

function detectPageType() {
  const path = location.pathname
  if (/\/[^/]+\/followers$/.test(path)) return 'followers'
  if (/\/[^/]+\/following$/.test(path)) return 'following'
  if (path.startsWith('/search')) return 'search'
  if (path === '/' || path === '/home') return 'home_timeline'
  if (path.startsWith('/i/connect') || path === '/explore') return 'suggested'
  if (/\/[^/]+\/lists\//.test(path)) return 'list'
  if (path.startsWith('/hashtag')) return 'hashtag'
  if (/\/[^/]+\/status\//.test(path)) return 'post'
  return 'other'
}

function pageTypeLabel(t) {
  const m = {
    followers: 'フォロワー一覧', following: 'フォロー中一覧',
    search: '検索結果', suggested: 'おすすめユーザー',
    list: 'リスト', hashtag: 'ハッシュタグ',
    home_timeline: 'タイムライン', post: '投稿', other: 'その他',
  }
  return m[t] || t
}

// ── ユーザーカード抽出 ─────────────────────────────────────────

function isUsernameHref(href) {
  if (!href) return false
  const skip = ['/i/', '/settings', '/home', '/messages', '/notifications',
                '/explore', '/compose', '/login', '/signup', '/search']
  if (skip.some(s => href.startsWith(s))) return false
  return /^\/[a-zA-Z0-9_]{1,15}$/.test(href)
}

function extractBio(cell, displayName, handle) {
  // ① data-testid="UserDescription"（最も確実）
  const descEl = cell.querySelector('[data-testid="UserDescription"]')
  if (descEl) {
    const text = (descEl.textContent || '').trim()
    if (text) return text
  }

  const nameContainer = cell.querySelector('[data-testid="User-Name"]')

  // フォローボタン系かどうか判定（セルから el までの祖先を辿る）
  function isButtonArea(el) {
    let node = el
    while (node && node !== cell) {
      if (node.tagName.toLowerCase() === 'button') return true
      if (node.getAttribute('role') === 'button') return true
      if (/follow/i.test(node.getAttribute('aria-label') || '')) return true
      node = node.parentElement
    }
    return false
  }

  // フォローボタンのテキストパターン
  function isFollowText(text) {
    return /^(click to follow|follow|フォロー|following)/i.test(text)
  }

  // ② dir="auto" 要素（User-Name 外・ボタン外・非表示除外）
  for (const el of cell.querySelectorAll('[dir="auto"]')) {
    if (nameContainer && nameContainer.contains(el)) continue
    if (isButtonArea(el)) continue
    if (el.style.display === 'none' || el.style.visibility === 'hidden') continue
    const text = (el.textContent || '').trim()
    if (
      text.length >= 5 &&
      !isFollowText(text) &&
      text !== displayName &&
      text !== handle &&
      !text.startsWith('@') &&
      !/^\d[\d,万.kK]*[人件]?$/.test(text)
    ) return text
  }

  // ③ User-Name の次の兄弟要素（最終手段）
  if (nameContainer) {
    let sib = nameContainer.nextElementSibling
    while (sib) {
      if (!isButtonArea(sib)) {
        const text = (sib.textContent || '').trim()
        if (
          text.length >= 5 &&
          !isFollowText(text) &&
          text !== displayName &&
          text !== handle &&
          !text.startsWith('@')
        ) return text
      }
      sib = sib.nextElementSibling
    }
  }

  return undefined
}

function extractFromCell(cell) {
  const allLinks = Array.from(cell.querySelectorAll('a[href]'))
  // aria-hidden="true" はアバター画像リンクなので除外し、テキスト名リンクを取得
  const profileLink = allLinks.find(a =>
    isUsernameHref(a.getAttribute('href') || '') &&
    a.getAttribute('aria-hidden') !== 'true'
  )
  if (!profileLink) return null
  const username = (profileLink.getAttribute('href') || '').slice(1)
  if (!username) return null

  let displayName = username
  const nameContainer = cell.querySelector('[data-testid="User-Name"]') || profileLink
  for (const span of Array.from(nameContainer.querySelectorAll('span'))) {
    const text = (span.textContent || '').trim()
    if (text && !text.startsWith('@') && text.toLowerCase() !== username.toLowerCase() && span.children.length === 0) {
      displayName = text
      break
    }
  }

  const bio = extractBio(cell, displayName, '@' + username)

  const verified = !!(
    cell.querySelector('[data-testid="icon-verified"]') ||
    cell.querySelector('[data-testid="verified"]') ||
    cell.querySelector('svg[aria-label*="確認"]') ||
    cell.querySelector('svg[aria-label*="Verified"]') ||
    cell.querySelector('svg[aria-label*="verified"]')
  )

  return {
    displayName,
    handle: '@' + username,
    bio: bio || undefined,
    profileUrl: 'https://x.com/' + username,
    verified,
    channel: 'twitter',
  }
}

function collectCards() {
  const cells = Array.from(document.querySelectorAll('[data-testid="UserCell"]'))
  const seen = new Set()
  const cards = []
  for (const cell of cells) {
    const card = extractFromCell(cell)
    if (card && !seen.has(card.handle)) {
      seen.add(card.handle)
      cards.push(card)
    }
  }
  return cards
}

function formatAccountsSection(cards, pageType, url) {
  const lines = [
    `【取得元】${pageTypeLabel(pageType)}（${url}）`,
    `【取得アカウント数】${cards.length}件`,
    '',
  ]
  for (const acc of cards) {
    lines.push(`アカウント名：${acc.displayName}`)
    lines.push(`ハンドル：${acc.handle}`)
    if (acc.bio) lines.push(`bio：${acc.bio}`)
    if (acc.followerCount) lines.push(`フォロワー数：${acc.followerCount}`)
    lines.push('---')
  }
  return lines.join('\n')
}

// ── メインアクション ───────────────────────────────────────────

async function buildAndSendToAI() {
  if (collectedCards.length === 0) return
  const btn = document.getElementById('os-ext-send-btn')
  if (!btn || btn.disabled) return

  btn.disabled = true
  const originalText = btn.textContent
  btn.textContent = '⏳ プロンプト生成中...'
  btn.style.background = '#7c3aed'

  try {
    const settings = await getSettings()
    const cards = collectedCards.slice(0, settings.maxAccounts)
    const pageType = detectPageType()
    const accountsSection = formatAccountsSection(cards, pageType, location.href)
    const sourceContext = {
      platform: 'twitter',
      pageType,
      url: location.href,
      collectedBy: 'chrome-extension',
      collectedAt: new Date().toISOString(),
    }

    if (settings.aiTarget !== 'gemini') {
      const promptResp = await sendRuntimeMessage({
        type: 'os0_prepare_prompt',
        accountsSection,
        accountCount: cards.length,
        sourceContext,
      })
      if (!promptResp?.ok || !promptResp.promptText) {
        throw new Error(promptResp?.message || 'プロンプト生成に失敗しました')
      }

      await navigator.clipboard.writeText(promptResp.promptText)

      const aiUrl = AI_URLS[settings.aiTarget] || AI_URLS.gemini
      window.open(aiUrl, '_blank')

      btn.textContent = `✓ ${cards.length}件 → ${settings.aiTarget === 'claude' ? 'Claude' : 'ChatGPT'}に貼り付けてください！`
      btn.style.background = '#22c55e'
      setTimeout(() => resetBtn(btn, originalText), 5000)
      return
    }

    const startResp = await sendRuntimeMessage({
      type: 'os0_start',
      accountsSection,
      accountCount: cards.length,
      sourceContext,
    })
    if (!startResp?.ok) {
      throw new Error(startResp?.message || 'Gemini起動に失敗しました')
    }

    btn.textContent = startResp.excludedApplied
      ? `✓ ${cards.length}件 → Gemini処理中`
      : `✓ ${cards.length}件 → Gemini処理中（除外なし）`
    btn.style.background = '#22c55e'
    setTimeout(() => resetBtn(btn, originalText), 5000)

  } catch (err) {
    console.error('[OS Ext]', err)
    const msg = err.message || 'エラーが発生しました'
    btn.textContent = `⚠ ${msg}`
    btn.style.background = '#ef4444'
    setTimeout(() => resetBtn(btn, originalText), 4000)
  }
}

function resetBtn(btn, originalText) {
  if (!btn) return
  btn.textContent = originalText || `📋 OS0プロンプトを生成 (${collectedCards.length}件)`
  btn.style.background = ''
  btn.disabled = false
}

// ── フローティングボタン ───────────────────────────────────────

function ensureButton() {
  if (floatingBtn) return floatingBtn
  const wrapper = document.createElement('div')
  wrapper.id = 'os-ext-btn-wrapper'
  const btn = document.createElement('button')
  btn.id = 'os-ext-send-btn'
  btn.type = 'button'
  wrapper.appendChild(btn)
  document.body.appendChild(wrapper)
  btn.addEventListener('click', buildAndSendToAI)
  floatingBtn = wrapper
  return wrapper
}

function updateButton(cards) {
  collectedCards = cards
  const wrapper = ensureButton()
  const btn = document.getElementById('os-ext-send-btn')
  if (btn && !btn.disabled) {
    btn.textContent = cards.length > 0
      ? `📋 OS0プロンプトを生成 (${cards.length}件)`
      : '📋 OS0プロンプトを生成'
  }
  wrapper.style.display = cards.length > 0 ? 'block' : 'none'
}

// ── スキャン・SPA対応 ──────────────────────────────────────────

function scheduleScan() {
  clearTimeout(scanDebounce)
  scanDebounce = setTimeout(() => updateButton(collectCards()), 400)
}

function handleUrlChange() {
  const url = location.href
  if (url === lastUrl) return
  lastUrl = url
  collectedCards = []
  scheduleScan()
}

const _origPushState = history.pushState
history.pushState = function (...args) {
  _origPushState.apply(this, args)
  setTimeout(handleUrlChange, 150)
}
window.addEventListener('popstate', () => setTimeout(handleUrlChange, 150))

const domObserver = new MutationObserver(scheduleScan)
domObserver.observe(document.body, { childList: true, subtree: true })

scheduleScan()
