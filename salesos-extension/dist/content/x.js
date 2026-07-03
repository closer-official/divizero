// src/shared/xExtract.ts
function cleanText(value) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}
function isProfileHref(href) {
  if (!href) return false;
  if (!href.startsWith("/")) return false;
  if (href.startsWith("/i/")) return false;
  return /^\/[A-Za-z0-9_]{1,15}$/.test(href);
}
function handleFromHref(href) {
  if (!isProfileHref(href)) return "";
  return `@${href.slice(1)}`;
}
function firstTextMatch(elements) {
  for (const element of elements) {
    const text = cleanText(element.textContent);
    if (text && !text.startsWith("@")) return text;
  }
  return "";
}
function isSuggestionRegion(cell) {
  const region = cell.closest("[aria-label]");
  const label = cleanText(region?.getAttribute("aria-label"));
  return /who to follow|おすすめ/i.test(label);
}
function extractDisplayNameFromContainer(container) {
  if (!container) return "";
  const spans = Array.from(container.querySelectorAll("span"));
  return firstTextMatch(spans);
}
function extractDisplayNameFromLinks(cell, handle) {
  const bare = handle.replace(/^@/, "");
  for (const a of Array.from(cell.querySelectorAll(`a[href="/${bare}"]`))) {
    const text = cleanText(a.textContent);
    if (!text || text.startsWith("@") || text === bare) continue;
    if (text.length <= 80) return text;
  }
  return "";
}
function extractBio(cell) {
  const bioEl = cell.querySelector('[data-testid="UserDescription"]');
  if (bioEl?.textContent?.trim()) return cleanText(bioEl.textContent);
  const candidates = Array.from(cell.querySelectorAll('[dir="auto"]')).filter((el) => {
    if (el.style.display === "none") return false;
    const text = cleanText(el.textContent);
    return text.length >= 10 && text.length <= 500 && !text.startsWith("@");
  });
  return candidates.length > 0 ? cleanText(candidates[candidates.length - 1].textContent) : "";
}
function normalizeCountText(anchor) {
  if (!anchor) return "";
  const text = cleanText(anchor.textContent);
  return text.replace(/\s+/g, " ");
}
function isAdArticle(article) {
  const text = cleanText(article.textContent);
  return /promoted|プロモーション/i.test(text);
}
function isReplyArticle(article) {
  const text = cleanText(article.textContent);
  return /replying to|返信先:/i.test(text);
}
function postHandleCandidate(root) {
  const anchors = Array.from(root.querySelectorAll('a[href^="/"]'));
  for (const anchor of anchors) {
    const handle = handleFromHref(anchor.getAttribute("href"));
    if (handle) return handle;
  }
  return "";
}
function extractBioLink(root) {
  const headerItems = root.querySelector('[data-testid="UserProfileHeader_Items"]');
  const candidates = Array.from((headerItems ?? root).querySelectorAll("a[href]"));
  for (const anchor of candidates) {
    const href = anchor.getAttribute("href") ?? "";
    if (/^https?:\/\//.test(href) && !/x\.com|twitter\.com/.test(href)) {
      return href;
    }
  }
  return "";
}
function extractList(root) {
  const seen = /* @__PURE__ */ new Set();
  const results = [];
  for (const cell of Array.from(root.querySelectorAll('[data-testid="UserCell"]'))) {
    if (isSuggestionRegion(cell)) continue;
    const anchor = Array.from(cell.querySelectorAll('a[href^="/"]')).find(
      (candidate) => isProfileHref(candidate.getAttribute("href"))
    );
    const handle = handleFromHref(anchor?.getAttribute("href") ?? null);
    if (!handle || seen.has(handle.toLowerCase())) continue;
    const nameContainer = cell.querySelector('[data-testid="User-Name"], [data-testid="UserName"]');
    const displayName = extractDisplayNameFromContainer(nameContainer) || extractDisplayNameFromLinks(cell, handle) || handle.replace(/^@/, "");
    results.push({
      displayName,
      handle,
      bio: extractBio(cell)
    });
    seen.add(handle.toLowerCase());
  }
  return results;
}
function extractProfile(root, postCount, hintHandle) {
  const headerName = root.querySelector('[data-testid="UserName"]') ?? root.querySelector("main h2") ?? root.querySelector('[data-testid="User-Name"]');
  let handle = postHandleCandidate(headerName ?? root);
  if (!handle && hintHandle) handle = hintHandle;
  if (!handle) return null;
  const displayName = extractDisplayNameFromContainer(headerName) || handle.replace(/^@/, "");
  const bio = cleanText(root.querySelector('[data-testid="UserDescription"]')?.textContent);
  const followers = normalizeCountText(root.querySelector(`a[href$="${handle.slice(1)}/followers"]`));
  const following = normalizeCountText(root.querySelector(`a[href$="${handle.slice(1)}/following"]`));
  const postsCountMatch = cleanText(root.querySelector("main")?.textContent).match(/\b([\d.,]+[KMB]?) posts\b/i);
  const postsCount = postsCountMatch?.[1] ?? "";
  const posts = [];
  let pinnedPost = null;
  for (const article of Array.from(root.querySelectorAll('article[data-testid="tweet"]'))) {
    if (isAdArticle(article) || isReplyArticle(article)) continue;
    const text = cleanText(article.querySelector('[data-testid="tweetText"]')?.textContent);
    if (!text) continue;
    const time = article.querySelector("time");
    const relativeTime = cleanText(time?.textContent) || cleanText(time?.getAttribute("datetime"));
    const isPinned = /pinned/i.test(cleanText(article.querySelector('[data-testid="socialContext"]')?.textContent));
    if (isPinned && !pinnedPost) pinnedPost = text;
    posts.push({ text, relativeTime, isPinned });
    if (posts.length >= postCount) break;
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
    posts
  };
}

// src/content/x.ts
var GLOBAL_FLAG = "__salesosXInitialized";
if (globalThis[GLOBAL_FLAG]) {
} else {
  let detectPageType = function() {
    const path = location.pathname;
    if (path.startsWith("/search")) return "search";
    if (/\/(followers|following)$/.test(path)) return "followers";
    return "unknown";
  };
  detectPageType2 = detectPageType;
  ;
  globalThis[GLOBAL_FLAG] = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const respond = (payload) => sendResponse(payload);
    try {
      if (message.cmd === "X_EXTRACT_LIST") {
        const accounts = extractList(document);
        respond({
          ok: accounts.length > 0,
          pageType: detectPageType(),
          accounts,
          error: accounts.length > 0 ? void 0 : "\u4E00\u89A7\u30DA\u30FC\u30B8\u3067\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044"
        });
        return true;
      }
      if (message.cmd === "X_EXTRACT_PROFILE") {
        const postCount = Math.max(1, Math.min(message.postCount, 10));
        const pathMatch = location.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
        const urlHandle = pathMatch ? `@${pathMatch[1]}` : void 0;
        void (async () => {
          try {
            let profile = null;
            for (let attempt = 0; attempt < 10; attempt++) {
              if (attempt > 0) await new Promise((r) => setTimeout(r, 1e3));
              const candidate = extractProfile(document, postCount, urlHandle);
              if (candidate) {
                profile = candidate;
                if (profile.posts.length > 0 || profile.followers) break;
              }
            }
            respond(
              profile ? { ok: true, profile } : { ok: false, error: "\u30D7\u30ED\u30D5\u30A3\u30FC\u30EB\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F" }
            );
          } catch (error) {
            respond({ ok: false, error: error instanceof Error ? error.message : "\u4E0D\u660E\u306A\u30A8\u30E9\u30FC" });
          }
        })();
        return true;
      }
    } catch (error) {
      respond({
        ok: false,
        pageType: "unknown",
        accounts: [],
        error: error instanceof Error ? error.message : "\u4E0D\u660E\u306A\u30A8\u30E9\u30FC"
      });
      return true;
    }
    return false;
  });
}
var detectPageType2;
