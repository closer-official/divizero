import type { XCommand, XListResult, XPageType, XProfileResult } from '../shared/protocol'
import { extractList, extractProfile } from '../shared/xExtract'

const GLOBAL_FLAG = '__salesosXInitialized'

if ((globalThis as typeof globalThis & Record<string, unknown>)[GLOBAL_FLAG]) {
  // Already initialized in this execution world.
} else {
  ;(globalThis as typeof globalThis & Record<string, unknown>)[GLOBAL_FLAG] = true

function detectPageType(): XPageType {
  const path = location.pathname
  if (path.startsWith('/search')) return 'search'
  if (/\/(followers|following)$/.test(path)) return 'followers'
  return 'unknown'
}

chrome.runtime.onMessage.addListener((message: XCommand, _sender, sendResponse) => {
  const respond = (payload: XListResult | XProfileResult) => sendResponse(payload)

  try {
    if (message.cmd === 'X_EXTRACT_LIST') {
      const accounts = extractList(document)
      respond({
        ok: accounts.length > 0,
        pageType: detectPageType(),
        accounts,
        error: accounts.length > 0 ? undefined : '一覧ページで実行してください',
      } satisfies XListResult)
      return true
    }

    if (message.cmd === 'X_EXTRACT_PROFILE') {
      const postCount = Math.max(1, Math.min(message.postCount, 10))
      // Derive handle from URL so we don't depend solely on data-testid="UserName"
      const pathMatch = location.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/)
      const urlHandle = pathMatch ? `@${pathMatch[1]}` : undefined
      // Poll up to 10s: X's React SPA fetches profile data asynchronously after page load
      void (async () => {
        try {
          let profile = null
          for (let attempt = 0; attempt < 10; attempt++) {
            if (attempt > 0) await new Promise<void>(r => setTimeout(r, 1000))
            const candidate = extractProfile(document, postCount, urlHandle)
            if (candidate) {
              profile = candidate
              // Bio or followers loaded → API response has arrived
              if (profile.posts.length > 0 || profile.followers) break
            }
          }
          respond(
            profile
              ? ({ ok: true, profile } satisfies XProfileResult)
              : ({ ok: false, error: 'プロフィールを取得できませんでした' } satisfies XProfileResult),
          )
        } catch (error) {
          respond({ ok: false, error: error instanceof Error ? error.message : '不明なエラー' } satisfies XProfileResult)
        }
      })()
      return true
    }
  } catch (error) {
    respond({
      ok: false,
      pageType: 'unknown',
      accounts: [],
      error: error instanceof Error ? error.message : '不明なエラー',
    } satisfies XListResult)
    return true
  }

  return false
})
}
