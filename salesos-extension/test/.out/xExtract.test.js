"use strict";
(() => {
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

  // test/xExtract.test.ts
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }
  function parse(html) {
    return new DOMParser().parseFromString(html, "text/html");
  }
  function run() {
    const notes = [];
    const searchAccounts = extractList(parse('<!doctype html>\n<html lang="ja">\n  <body>\n    <main>\n      <section aria-label="Timeline: Search timeline">\n        <div data-testid="UserCell">\n          <a href="/alpha_sales">profile</a>\n          <div data-testid="User-Name">\n            <span>Alpha Sales</span>\n            <span>@alpha_sales</span>\n          </div>\n          <div data-testid="UserDescription">\u526F\u696D\u3068\u55B6\u696D\u306E\u767A\u4FE1\u3092\u3057\u3066\u3044\u307E\u3059</div>\n        </div>\n        <div data-testid="UserCell">\n          <a href="/beta_growth">profile</a>\n          <div data-testid="User-Name">\n            <span>Beta Growth</span>\n            <span>@beta_growth</span>\n          </div>\n          <div data-testid="UserDescription">\u767A\u4FE1\u8005\u5411\u3051\u306E\u55B6\u696D\u652F\u63F4</div>\n        </div>\n        <section aria-label="Who to follow">\n          <div data-testid="UserCell">\n            <a href="/should_skip">profile</a>\n            <div data-testid="User-Name">\n              <span>Suggested User</span>\n              <span>@should_skip</span>\n            </div>\n            <div data-testid="UserDescription">\u3053\u308C\u306F\u9664\u5916\u3055\u308C\u308B\u60F3\u5B9A</div>\n          </div>\n        </section>\n        <div data-testid="UserCell">\n          <a href="/i/connect_people">skip</a>\n        </div>\n      </section>\n    </main>\n  </body>\n  </html>\n'));
    assert(searchAccounts.length === 2, `search expected 2 accounts, got ${searchAccounts.length}`);
    assert(searchAccounts[0]?.handle === "@alpha_sales", "search first handle mismatch");
    assert(searchAccounts.every((account) => account.handle !== "@should_skip"), "suggested account was not filtered");
    notes.push(`search:${searchAccounts.length}`);
    const followerAccounts = extractList(parse('<!doctype html>\n<html lang="ja">\n  <body>\n    <main>\n      <section aria-label="Timeline: Followers">\n        <div data-testid="UserCell">\n          <a href="/growth_memo">profile</a>\n          <div data-testid="User-Name">\n            <span>Growth Memo</span>\n            <span>@growth_memo</span>\n          </div>\n          <div data-testid="UserDescription">\u30B3\u30F3\u30C6\u30F3\u30C4\u8CA9\u58F2\u3068\u55B6\u696D\u5C0E\u7DDA\u306E\u8A18\u9332</div>\n        </div>\n        <div data-testid="UserCell">\n          <a href="/founder_os">profile</a>\n          <div data-testid="User-Name">\n            <span>Founder OS</span>\n            <span>@founder_os</span>\n          </div>\n          <div data-testid="UserDescription">\u767A\u4FE1\u304B\u3089\u53D7\u6CE8\u307E\u3067\u306E\u5C0E\u7DDA\u8A2D\u8A08</div>\n        </div>\n        <div data-testid="UserCell">\n          <a href="/founder_os">duplicate</a>\n          <div data-testid="User-Name">\n            <span>Founder OS</span>\n            <span>@founder_os</span>\n          </div>\n        </div>\n      </section>\n    </main>\n  </body>\n  </html>\n'));
    assert(followerAccounts.length === 2, `followers expected 2 accounts, got ${followerAccounts.length}`);
    assert(new Set(followerAccounts.map((account) => account.handle)).size === followerAccounts.length, "duplicates were not removed");
    notes.push(`followers:${followerAccounts.length}`);
    const profile = extractProfile(parse('<!doctype html>\n<html lang="ja">\n  <body>\n    <main>\n      <section>\n        <div data-testid="UserName">\n          <a href="/sns_dekinai">\n            <span>\u3067\u304D\u306A\u3044\u304F\u3093</span>\n          </a>\n        </div>\n        <div>11.2K posts</div>\n        <div data-testid="UserDescription">\u767A\u4FE1\u304C\u7D9A\u304B\u306A\u3044\u4EBA\u5411\u3051\u306B\u3001SNS\u904B\u7528\u306E\u8003\u3048\u65B9\u3092\u767A\u4FE1\u3057\u3066\u3044\u307E\u3059\u3002</div>\n        <div data-testid="UserProfileHeader_Items">\n          <a href="https://example.com/service">https://example.com/service</a>\n        </div>\n        <a href="/sns_dekinai/followers">12.4K Followers</a>\n        <a href="/sns_dekinai/following">301 Following</a>\n      </section>\n      <section aria-label="Timeline: \u3067\u304D\u306A\u3044\u304F\u3093\u2019s posts">\n        <article data-testid="tweet">\n          <div data-testid="socialContext">Pinned</div>\n          <div data-testid="tweetText">\u56FA\u5B9A\u30DD\u30B9\u30C8\u3067\u3059\u3002\u55B6\u696D\u5C0E\u7DDA\u306E\u5168\u4F53\u50CF\u3092\u307E\u3068\u3081\u3066\u3044\u307E\u3059\u3002</div>\n          <a href="/sns_dekinai/status/1"><time datetime="2026-06-01T09:00:00.000Z">Jun 1</time></a>\n        </article>\n        <article data-testid="tweet">\n          <div data-testid="tweetText">\u3088\u3063\u3057\u3083\u3041\u3041\u3041\u30D5\u30A9\u30ED\u30EF\u30FC850\u4EBA\u9054\u6210\u3057\u307E\u3057\u305F\uFF01</div>\n          <a href="/sns_dekinai/status/2"><time datetime="2026-07-03T09:00:58.000Z">36m</time></a>\n        </article>\n        <article data-testid="tweet">\n          <div>Replying to @someone</div>\n          <div data-testid="tweetText">\u3053\u308C\u306F\u8FD4\u4FE1\u306A\u306E\u3067\u9664\u5916\u3055\u308C\u308B\u60F3\u5B9A\u3067\u3059\u3002</div>\n          <a href="/sns_dekinai/status/3"><time datetime="2026-07-02T09:00:58.000Z">1d</time></a>\n        </article>\n        <article data-testid="tweet">\n          <div data-testid="tweetText">\u5546\u54C1\u3065\u304F\u308A\u3088\u308A\u5148\u306B\u3001\u8AB0\u306E\u4F55\u3092\u5909\u3048\u308B\u304B\u3092\u8A00\u8A9E\u5316\u3057\u305F\u307B\u3046\u304C\u65E9\u3044\u3002</div>\n          <a href="/sns_dekinai/status/4"><time datetime="2026-07-01T09:00:58.000Z">2d</time></a>\n        </article>\n        <article data-testid="tweet">\n          <div>Promoted</div>\n          <div data-testid="tweetText">\u5E83\u544A\u306A\u306E\u3067\u9664\u5916\u3055\u308C\u308B\u60F3\u5B9A\u3067\u3059\u3002</div>\n          <a href="/sns_dekinai/status/5"><time datetime="2026-06-30T09:00:58.000Z">3d</time></a>\n        </article>\n        <article data-testid="tweet">\n          <div data-testid="tweetText">\u55B6\u696D\u306F\u300C\u523A\u3055\u308B\u4E00\u8A00\u300D\u3088\u308A\u300C\u6B21\u306B\u9032\u3081\u308B\u4E00\u6B69\u300D\u306E\u8A2D\u8A08\u304C\u5927\u4E8B\u3002</div>\n          <a href="/sns_dekinai/status/6"><time datetime="2026-06-29T09:00:58.000Z">4d</time></a>\n        </article>\n        <article data-testid="tweet">\n          <div data-testid="tweetText">\u767A\u4FE1\u306E\u53CD\u5FDC\u7387\u304C\u4F4E\u3044\u3068\u304D\u306F\u3001\u8AAD\u5F8C\u884C\u52D5\u3092\u4E00\u3064\u306B\u7D5E\u308B\u3002</div>\n          <a href="/sns_dekinai/status/7"><time datetime="2026-06-28T09:00:58.000Z">5d</time></a>\n        </article>\n      </section>\n    </main>\n  </body>\n  </html>\n'), 5);
    assert(profile, "profile extraction returned null");
    assert(profile?.handle === "@sns_dekinai", `profile handle mismatch: ${profile?.handle}`);
    assert(profile?.displayName === "\u3067\u304D\u306A\u3044\u304F\u3093", `profile displayName mismatch: ${profile?.displayName}`);
    assert(profile?.pinnedPost?.includes("\u56FA\u5B9A\u30DD\u30B9\u30C8"), "pinned post not captured");
    assert(profile?.posts.length === 5, `expected 5 posts, got ${profile?.posts.length}`);
    assert(profile?.posts.every((post) => !/広告/.test(post.text)), "promoted post was not filtered");
    assert(profile?.posts.every((post) => !/返信なので/.test(post.text)), "reply post was not filtered");
    notes.push(`profile:${profile?.posts.length}`);
    return notes;
  }
  try {
    const notes = run();
    document.body.innerHTML = `<pre>TEST_PASS
${notes.join("\n")}</pre>`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    document.body.innerHTML = `<pre>TEST_FAIL
${message}</pre>`;
  }
})();
