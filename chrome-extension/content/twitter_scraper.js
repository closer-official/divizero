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
  // /i/, /settings 等の内部パスを除外
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

  // displayName: User-Name コンテナか profileLink 内の最初の非@テキストスパン
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

  // bio
  const bioEl = cell.querySelector('[data-testid="UserDescription"]')
  const bio = bioEl ? (bioEl.textContent || '').trim() : undefined

  // verified バッジ（テストIDまたは aria-label で検出）
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
  floatingBtn = document.createElement('div')
  floatingBtn.id = 'os-ext-btn-wrapper'
  floatingBtn.innerHTML = `
    <button id="os-ext-send-btn" type="button">
      <i class="os-ext-icon">📥</i>
      <span id="os-ext-count">0</span>件を営業OSへ
    </button>
  `
  document.body.appendChild(floatingBtn)
  document.getElementById('os-ext-send-btn').addEventListener('click', sendToOS)
  return floatingBtn
}

function updateButton(cards) {
  collectedCards = cards
  const wrapper = ensureButton()
  const countEl = document.getElementById('os-ext-count')
  if (countEl) countEl.textContent = String(cards.length)
  wrapper.style.display = cards.length > 0 ? 'block' : 'none'
}

function sendToOS() {
  if (collectedCards.length === 0) return
  const btn = document.getElementById('os-ext-send-btn')
  if (!btn || btn.disabled) return
  btn.disabled = true

  const payload = {
    sourceContext: {
      platform: 'twitter',
      pageType: detectPageType(),
      url: location.href,
      collectedBy: 'chrome-extension',
      collectedAt: new Date().toISOString(),
    },
    accounts: collectedCards.slice(), // コピー
  }

  try {
    chrome.runtime.sendMessage({ type: 'enqueue', itemType: 'os0_candidates', payload }, response => {
      if (chrome.runtime.lastError) {
        console.warn('[OS Ext]', chrome.runtime.lastError.message)
        btn.disabled = false
        return
      }
      if (response && response.ok) {
        btn.textContent = '✓ 送信しました！'
        btn.style.background = '#22c55e'
        setTimeout(() => {
          if (btn) {
            btn.innerHTML = `<i class="os-ext-icon">📥</i><span id="os-ext-count">${collectedCards.length}</span>件を営業OSへ`
            btn.style.background = ''
            btn.disabled = false
          }
        }, 2500)
      } else {
        btn.disabled = false
      }
    })
  } catch (e) {
    // 拡張機能がリロードされてコンテキストが無効になった場合
    btn.textContent = '⚠ タブを再読込してください'
    btn.style.background = '#ef4444'
    setTimeout(() => {
      if (btn) {
        btn.innerHTML = `<i class="os-ext-icon">📥</i><span id="os-ext-count">${collectedCards.length}</span>件を営業OSへ`
        btn.style.background = ''
        btn.disabled = false
      }
    }, 3000)
  }
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

// SPA ナビゲーション検出: history.pushState をインターセプト
const _origPushState = history.pushState
history.pushState = function (...args) {
  _origPushState.apply(this, args)
  setTimeout(handleUrlChange, 150)
}
window.addEventListener('popstate', () => setTimeout(handleUrlChange, 150))

// DOM変化を監視（Twitter は動的にカードを追加する）
const domObserver = new MutationObserver(scheduleScan)
domObserver.observe(document.body, { childList: true, subtree: true })

// 初回スキャン
scheduleScan()
