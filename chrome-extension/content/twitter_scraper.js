'use strict'

let collectedCards = []
let scanDebounce = null
let floatingBtn = null
let lastUrl = location.href

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

// ── ユーザーカード抽出 ─────────────────────────────────────────

function isUsernameHref(href) {
  if (!href) return false
  const skip = ['/i/', '/settings', '/home', '/messages', '/notifications',
                '/explore', '/compose', '/login', '/signup', '/search']
  if (skip.some(s => href.startsWith(s))) return false
  return /^\/[a-zA-Z0-9_]{1,15}$/.test(href)
}

function extractFromCell(cell) {
  const allLinks = Array.from(cell.querySelectorAll('a[href]'))
  const profileLink = allLinks.find(a => isUsernameHref(a.getAttribute('href') || ''))
  if (!profileLink) return null

  const username = (profileLink.getAttribute('href') || '').slice(1)
  if (!username) return null

  let displayName = username
  const nameContainer = cell.querySelector('[data-testid="User-Name"]') || profileLink
  const spans = Array.from(nameContainer.querySelectorAll('span'))
  for (const span of spans) {
    const text = (span.textContent || '').trim()
    if (
      text &&
      !text.startsWith('@') &&
      text.toLowerCase() !== username.toLowerCase() &&
      span.children.length === 0
    ) {
      displayName = text
      break
    }
  }

  const bioEl = cell.querySelector('[data-testid="UserDescription"]')
  const bio = bioEl ? (bioEl.textContent || '').trim() : undefined

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
  btn.addEventListener('click', copyToClipboard)
  floatingBtn = wrapper
  return wrapper
}

function updateButton(cards) {
  collectedCards = cards
  const wrapper = ensureButton()
  const btn = document.getElementById('os-ext-send-btn')
  if (btn) {
    btn.textContent = cards.length > 0
      ? `📋 OS0候補をコピー (${cards.length}件)`
      : '📋 OS0候補をコピー'
  }
  wrapper.style.display = cards.length > 0 ? 'block' : 'none'
}

async function copyToClipboard() {
  if (collectedCards.length === 0) return
  const btn = document.getElementById('os-ext-send-btn')
  if (!btn || btn.disabled) return
  btn.disabled = true

  const data = {
    type: 'os0_candidates',
    sourceContext: {
      platform: 'twitter',
      pageType: detectPageType(),
      url: location.href,
      collectedBy: 'chrome-extension',
      collectedAt: new Date().toISOString(),
    },
    accounts: collectedCards.slice(),
  }

  const json = JSON.stringify(data, null, 2)

  try {
    await navigator.clipboard.writeText(json)
    showSuccess(btn)
  } catch (_) {
    // Clipboard API fallback (フォーカス外の場合など)
    try {
      const ta = document.createElement('textarea')
      ta.value = json
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      showSuccess(btn)
    } catch (_2) {
      btn.textContent = '⚠ コピー失敗'
      btn.style.background = '#ef4444'
      setTimeout(() => resetBtn(btn), 2500)
    }
  }
}

function showSuccess(btn) {
  btn.textContent = '✓ コピーしました！'
  btn.style.background = '#22c55e'
  setTimeout(() => resetBtn(btn), 2500)
}

function resetBtn(btn) {
  if (!btn) return
  btn.textContent = `📋 OS0候補をコピー (${collectedCards.length}件)`
  btn.style.background = ''
  btn.disabled = false
}

// ── スキャン・SPA対応 ──────────────────────────────────────────

function scheduleScan() {
  clearTimeout(scanDebounce)
  scanDebounce = setTimeout(() => {
    const cards = collectCards()
    updateButton(cards)
  }, 400)
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
