'use strict'

// ── 設定 ───────────────────────────────────────────────────────
const DEFAULT_WEBAPP_BASE = 'https://divizero.vercel.app'
const PROMPT_FILE = '/prompts/OS0_X_一次選別_v2.md'
const PROMPT_CACHE_KEY = 'os0_prompt_cache'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000  // 24h
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

// ── プロンプト取得（24hキャッシュ）────────────────────────────

async function fetchOS0Prompt(webappBase) {
  const cached = await chrome.storage.local.get([PROMPT_CACHE_KEY])
  const cache = cached[PROMPT_CACHE_KEY]
  if (cache && cache.text && (Date.now() - cache.cachedAt) < CACHE_TTL_MS) {
    return cache.text
  }
  const url = webappBase + PROMPT_FILE
  const res = await fetch(url)
  if (!res.ok) throw new Error(`プロンプト取得失敗 (${res.status})`)
  const text = await res.text()
  await chrome.storage.local.set({ [PROMPT_CACHE_KEY]: { text, cachedAt: Date.now() } })
  return text
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
  // ① data-testid="UserDescription" (プロフィールページ・一部リスト)
  const descEl = cell.querySelector('[data-testid="UserDescription"]')
  if (descEl) {
    const text = (descEl.textContent || '').trim()
    if (text) return text
  }

  // ② User-Name の次の兄弟要素を探す（フォロワー/フォロー中リストで多い構造）
  const nameContainer = cell.querySelector('[data-testid="User-Name"]')
  if (nameContainer) {
    let sibling = nameContainer.nextElementSibling
    while (sibling) {
      // ボタン類は除外（role="button" または button タグ）
      const tag = sibling.tagName.toLowerCase()
      if (tag === 'button' || sibling.getAttribute('role') === 'button') break
      const text = (sibling.textContent || '').trim()
      if (
        text.length >= 5 &&
        text !== displayName &&
        text !== handle &&
        !text.startsWith('@')
      ) return text
      sibling = sibling.nextElementSibling
    }
  }

  // ③ dir="auto" 属性を持つ要素（User-Name 外で最初に見つかるもの）
  for (const el of cell.querySelectorAll('[dir="auto"]')) {
    if (nameContainer && nameContainer.contains(el)) continue
    const text = (el.textContent || '').trim()
    if (
      text.length >= 5 &&
      text !== displayName &&
      text !== handle &&
      !text.startsWith('@') &&
      !/^\d[\d,万.kK]*$/.test(text) // フォロワー数などの数値のみは除外
    ) return text
  }

  return undefined
}

function extractFromCell(cell) {
  const allLinks = Array.from(cell.querySelectorAll('a[href]'))
  const profileLink = allLinks.find(a => isUsernameHref(a.getAttribute('href') || ''))
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

// ── プロンプト組み立て ─────────────────────────────────────────

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

function buildFullPrompt(promptText, accountsSection) {
  // 除外済みアカウントセクションの前に候補を挿入、なければ末尾に追加
  const splitMarker = '\n\n【除外済みアカウント'
  const splitPoint = promptText.indexOf(splitMarker)
  if (splitPoint !== -1) {
    return (
      promptText.slice(0, splitPoint) +
      '\n\n' + accountsSection +
      promptText.slice(splitPoint)
    )
  }
  return promptText + '\n\n' + accountsSection
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

    // プロンプト取得（キャッシュ優先）
    const promptText = await fetchOS0Prompt(settings.webappBase)

    // 候補テキスト組み立て
    const accountsSection = formatAccountsSection(cards, pageType, location.href)
    const fullPrompt = buildFullPrompt(promptText, accountsSection)

    // クリップボードにコピー
    await navigator.clipboard.writeText(fullPrompt)

    // AIタブを開く
    const aiUrl = AI_URLS[settings.aiTarget] || AI_URLS.gemini
    window.open(aiUrl, '_blank')

    // 成功表示
    btn.textContent = `✓ ${cards.length}件 → Geminiに貼り付けてください！`
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
