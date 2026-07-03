import type { XAccount, XProfile } from './protocol'

function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function isProfileHref(href: string | null): href is string {
  if (!href) return false
  if (!href.startsWith('/')) return false
  if (href.startsWith('/i/')) return false
  return /^\/[A-Za-z0-9_]{1,15}$/.test(href)
}

function handleFromHref(href: string | null): string {
  if (!isProfileHref(href)) return ''
  return `@${href.slice(1)}`
}

function firstTextMatch(elements: Element[]): string {
  for (const element of elements) {
    const text = cleanText(element.textContent)
    if (text && !text.startsWith('@')) return text
  }
  return ''
}

function isSuggestionRegion(cell: Element): boolean {
  const region = cell.closest('[aria-label]')
  const label = cleanText(region?.getAttribute('aria-label'))
  return /who to follow|おすすめ/i.test(label)
}

// Returns '' (not the fallback handle) so callers can chain with ||
function extractDisplayNameFromContainer(container: ParentNode | null): string {
  if (!container) return ''
  const spans = Array.from(container.querySelectorAll('span'))
  return firstTextMatch(spans)
}

// Fallback when data-testid="User-Name"/"UserName" is absent.
// In X's current DOM, the name link <a href="/handle"> contains the display name
// as text, distinct from the avatar link (empty) and handle link (@handle).
function extractDisplayNameFromLinks(cell: Element, handle: string): string {
  const bare = handle.replace(/^@/, '')
  for (const a of Array.from(cell.querySelectorAll(`a[href="/${bare}"]`))) {
    const text = cleanText(a.textContent)
    if (!text || text.startsWith('@') || text === bare) continue
    if (text.length <= 80) return text
  }
  return ''
}

function extractBio(cell: ParentNode): string {
  // Primary: data-testid (older X versions)
  const bioEl = cell.querySelector('[data-testid="UserDescription"]')
  if (bioEl?.textContent?.trim()) return cleanText(bioEl.textContent)

  // Fallback: X uses dir="auto" for bio (multilingual).
  // The bio appears last in the cell. Skip hidden aria-description divs (display:none).
  // X bio limit is 160 chars; allow up to 500 after whitespace normalization.
  const candidates = Array.from(cell.querySelectorAll('[dir="auto"]')).filter(el => {
    if ((el as HTMLElement).style.display === 'none') return false
    const text = cleanText(el.textContent)
    return text.length >= 10 && text.length <= 500 && !text.startsWith('@')
  })
  return candidates.length > 0 ? cleanText(candidates[candidates.length - 1]!.textContent) : ''
}

function normalizeCountText(anchor: Element | null): string {
  if (!anchor) return ''
  const text = cleanText(anchor.textContent)
  return text.replace(/\s+/g, ' ')
}

function isAdArticle(article: Element): boolean {
  const text = cleanText(article.textContent)
  return /promoted|プロモーション/i.test(text)
}

function isReplyArticle(article: Element): boolean {
  const text = cleanText(article.textContent)
  return /replying to|返信先:/i.test(text)
}

function postHandleCandidate(root: ParentNode): string {
  const anchors = Array.from(root.querySelectorAll('a[href^="/"]'))
  for (const anchor of anchors) {
    const handle = handleFromHref(anchor.getAttribute('href'))
    if (handle) return handle
  }
  return ''
}

function extractBioLink(root: ParentNode): string {
  const headerItems = root.querySelector('[data-testid="UserProfileHeader_Items"]')
  const candidates = Array.from((headerItems ?? root).querySelectorAll('a[href]'))
  for (const anchor of candidates) {
    const href = anchor.getAttribute('href') ?? ''
    if (/^https?:\/\//.test(href) && !/x\.com|twitter\.com/.test(href)) {
      return href
    }
  }
  return ''
}

export function extractList(root: ParentNode): XAccount[] {
  const seen = new Set<string>()
  const results: XAccount[] = []

  for (const cell of Array.from(root.querySelectorAll('[data-testid="UserCell"]'))) {
    if (isSuggestionRegion(cell)) continue

    const anchor = Array.from(cell.querySelectorAll('a[href^="/"]')).find(candidate =>
      isProfileHref(candidate.getAttribute('href')),
    )
    const handle = handleFromHref(anchor?.getAttribute('href') ?? null)
    if (!handle || seen.has(handle.toLowerCase())) continue

    const nameContainer = cell.querySelector('[data-testid="User-Name"], [data-testid="UserName"]')
    const displayName =
      extractDisplayNameFromContainer(nameContainer) ||
      extractDisplayNameFromLinks(cell, handle) ||
      handle.replace(/^@/, '')
    results.push({
      displayName,
      handle,
      bio: extractBio(cell),
    })
    seen.add(handle.toLowerCase())
  }

  return results
}

export function extractProfile(root: ParentNode, postCount: number, hintHandle?: string): XProfile | null {
  const headerName =
    root.querySelector('[data-testid="UserName"]') ??
    root.querySelector('main h2') ??
    root.querySelector('[data-testid="User-Name"]')
  let handle = postHandleCandidate(headerName ?? root)
  if (!handle && hintHandle) handle = hintHandle
  if (!handle) return null

  const displayName = extractDisplayNameFromContainer(headerName) || handle.replace(/^@/, '')
  const bio = cleanText(root.querySelector('[data-testid="UserDescription"]')?.textContent)
  const followers = normalizeCountText(root.querySelector(`a[href$="${handle.slice(1)}/followers"]`))
  const following = normalizeCountText(root.querySelector(`a[href$="${handle.slice(1)}/following"]`))
  const postsCountMatch = cleanText(root.querySelector('main')?.textContent).match(/\b([\d.,]+[KMB]?) posts\b/i)
  const postsCount = postsCountMatch?.[1] ?? ''

  const posts: XProfile['posts'] = []
  let pinnedPost: string | null = null

  for (const article of Array.from(root.querySelectorAll('article[data-testid="tweet"]'))) {
    if (isAdArticle(article) || isReplyArticle(article)) continue
    const text = cleanText(article.querySelector('[data-testid="tweetText"]')?.textContent)
    if (!text) continue
    const time = article.querySelector('time')
    const relativeTime = cleanText(time?.textContent) || cleanText(time?.getAttribute('datetime'))
    const isPinned = /pinned/i.test(cleanText(article.querySelector('[data-testid="socialContext"]')?.textContent))

    if (isPinned && !pinnedPost) pinnedPost = text
    posts.push({ text, relativeTime, isPinned })
    if (posts.length >= postCount) break
  }

  return {
    displayName,
    handle,
    bio,
    followers,
    following,
    postsCount,
    bioLink: extractBioLink(root),
    pinnedPost,
    posts,
  }
}
