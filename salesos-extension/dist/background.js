// src/shared/protocol.ts
var DEFAULT_RUN_STATE = {
  runId: "",
  phase: "IDLE",
  channel: "twitter",
  limitN: 10,
  queue: [],
  currentIndex: 0,
  errors: [],
  startedAt: "",
  stats: {
    os0Captured: 0,
    os0Passed: 0,
    os1Done: 0,
    os1Failed: 0
  }
};
var DEFAULT_CONNECTION_STATE = {
  status: "unknown"
};

// src/shared/storage.ts
var RUN_STATE_KEY = "salesos.runState";
var CONNECTION_KEY = "salesos.connection";
async function loadRunState() {
  const result = await chrome.storage.local.get(RUN_STATE_KEY);
  return { ...DEFAULT_RUN_STATE, ...result[RUN_STATE_KEY] };
}
async function saveRunState(runState) {
  await chrome.storage.local.set({ [RUN_STATE_KEY]: runState });
}
async function loadConnectionState() {
  const result = await chrome.storage.local.get(CONNECTION_KEY);
  return {
    ...DEFAULT_CONNECTION_STATE,
    ...result[CONNECTION_KEY]
  };
}
async function saveConnectionState(connection) {
  await chrome.storage.local.set({ [CONNECTION_KEY]: connection });
}

// src/background.ts
var DIVIZERO_ORIGINS = ["https://divizero.vercel.app/", "http://localhost:5173/"];
var GEMINI_ORIGIN = "https://gemini.google.com/";
var THROTTLE_MIN_MS = 3e3;
var THROTTLE_MAX_MS = 8e3;
var POST_COUNT = 5;
var pumpInFlight = false;
function makeRunId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function clampLimitN(value) {
  return Math.max(1, Math.min(30, Number.isFinite(value) ? Math.floor(value) : 10));
}
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function randomThrottle() {
  return Math.floor(Math.random() * (THROTTLE_MAX_MS - THROTTLE_MIN_MS + 1)) + THROTTLE_MIN_MS;
}
function handleError(state, message) {
  const error = { at: nowIso(), phase: state.phase, message };
  return {
    ...state,
    phase: "ERROR",
    endedAt: nowIso(),
    message,
    errors: [...state.errors, error]
  };
}
async function updateRunState(mutator) {
  const current = await loadRunState();
  const next = mutator(current);
  await saveRunState(next);
  return next;
}
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
function isXUrl(url) {
  return Boolean(url && /^https:\/\/(x|twitter)\.com\//.test(url));
}
async function findTabByPrefix(prefixes) {
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => tab.url && prefixes.some((prefix) => tab.url.startsWith(prefix)));
}
async function waitForTabComplete(tabId) {
  const existing = await chrome.tabs.get(tabId);
  if (existing.status === "complete") return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("\u30BF\u30D6\u306E\u8AAD\u307F\u8FBC\u307F\u304C\u5B8C\u4E86\u3057\u307E\u305B\u3093\u3067\u3057\u305F"));
    }, 15e3);
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}
async function ensureTab(prefixes, createUrl, key, options = {}) {
  const state = await loadRunState();
  const candidateId = state[key];
  if (candidateId) {
    try {
      const tab = await chrome.tabs.get(candidateId);
      if (tab.url && prefixes.some((prefix) => tab.url.startsWith(prefix))) {
        await chrome.tabs.update(candidateId, { active: true });
        if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
        if (options.refreshOnReuse) {
          await chrome.tabs.reload(candidateId);
        }
        await waitForTabComplete(candidateId);
        return candidateId;
      }
    } catch {
    }
  }
  const existing = await findTabByPrefix(prefixes);
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true });
    if (options.refreshOnReuse) {
      await chrome.tabs.reload(existing.id);
    }
    await waitForTabComplete(existing.id);
    await updateRunState((current) => ({ ...current, [key]: existing.id }));
    return existing.id;
  }
  const created = await chrome.tabs.create({ url: createUrl, active: true });
  if (!created.id) throw new Error("\u30BF\u30D6\u3092\u4F5C\u6210\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F");
  await waitForTabComplete(created.id);
  await updateRunState((current) => ({ ...current, [key]: created.id }));
  return created.id;
}
async function sendTabMessage(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}
async function injectContentScript(tabId, file) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [file]
  });
}
async function bridgeCall(type, payload) {
  const tabId = await ensureTab(DIVIZERO_ORIGINS, DIVIZERO_ORIGINS[0], "divizeroTabId");
  const relay = { cmd: "BRIDGE", type, payload };
  try {
    return await sendTabMessage(tabId, relay);
  } catch (error) {
    await injectContentScript(tabId, "content/divizero.js");
    return sendTabMessage(tabId, relay);
  }
}
function formatOs0Prompt(promptText, accounts) {
  const accountLines = accounts.map((a) => `${a.displayName}\uFF5C${a.handle}\uFF5C${a.bio}`);
  const dataBlock = [
    "\u203B\u62E1\u5F35\u6A5F\u80FD\u306B\u3088\u308B\u81EA\u52D5\u62BD\u51FA\u30C7\u30FC\u30BF\uFF08UI\u30CE\u30A4\u30BA\u9664\u53BB\u6E08\u307F\uFF09\u3002\u5F62\u5F0F\uFF1A\u8868\u793A\u540D\uFF5C@\u30CF\u30F3\u30C9\u30EB\uFF5Cbio\u30011\u884C1\u30A2\u30AB\u30A6\u30F3\u30C8\uFF1A",
    "",
    ...accountLines
  ].join("\n");
  const excludedNote = "\uFF08\u30A2\u30D7\u30EA\u5074\u3067\u7167\u5408\u6E08\u307F\u306E\u305F\u3081\u5BFE\u8C61\u5916\u30EA\u30B9\u30C8\u306A\u3057\uFF09";
  const INPUT_MARKER = "\u3010\u5165\u529B\u30C7\u30FC\u30BF\u3011";
  const EXCLUDED_MARKER = "\u3010\u9664\u5916\u6E08\u307F\u30A2\u30AB\u30A6\u30F3\u30C8";
  const inputIdx = promptText.indexOf(INPUT_MARKER);
  const excludedIdx = promptText.lastIndexOf(EXCLUDED_MARKER);
  if (inputIdx >= 0 && excludedIdx > inputIdx) {
    const before = promptText.slice(0, excludedIdx).trimEnd();
    const excludedSection = promptText.slice(excludedIdx);
    const firstNewline = excludedSection.indexOf("\n") + 1;
    const excludedWithNote = excludedSection.slice(0, firstNewline) + excludedNote + "\n" + excludedSection.slice(firstNewline);
    return `${before}

${dataBlock}

${excludedWithNote}`.trim();
  }
  const oldMarker = "\u3010\u9664\u5916\u6E08\u307F\u30A2\u30AB\u30A6\u30F3\u30C8\u3011";
  const promptWithNote = promptText.includes(oldMarker) ? promptText.replace(oldMarker, `${oldMarker}
${excludedNote}`) : `${promptText}

${oldMarker}
${excludedNote}`;
  return `${promptWithNote}

${dataBlock}`.trim();
}
function formatOs1Prompt(promptText, profile) {
  const tweetLines = profile.posts.slice(0, POST_COUNT).map((post, index) => `${index + 1}.\uFF08${post.relativeTime || "\u6642\u523B\u4E0D\u660E"}\uFF09${post.text}`).join("\n");
  const body = [
    "\u3010\u2460\u30D7\u30ED\u30D5\u30A3\u30FC\u30EB\u60C5\u5831\u3011",
    `\u30A2\u30AB\u30A6\u30F3\u30C8\u540D\uFF1A${profile.displayName}`,
    `\u30E6\u30FC\u30B6\u30FC\u30CD\u30FC\u30E0\uFF1A${profile.handle}`,
    `bio\uFF1A${profile.bio || "\u7121"}`,
    `\u30D5\u30A9\u30ED\u30EF\u30FC\u6570\uFF1A${profile.followers || "\u4E0D\u660E"}\uFF0F\u30D5\u30A9\u30ED\u30FC\u6570\uFF1A${profile.following || "\u4E0D\u660E"}\uFF0F\u30DD\u30B9\u30C8\u6570\uFF1A${profile.postsCount || "\u4E0D\u660E"}`,
    `bio\u30EA\u30F3\u30AF\uFF1A${profile.bioLink || "\u7121"}`,
    `\u56FA\u5B9A\u30DD\u30B9\u30C8\uFF1A${profile.pinnedPost || "\u7121"}`,
    "",
    `\u3010\u2461\u30C4\u30A4\u30FC\u30C8\u4E00\u89A7\uFF08\u6700\u65B0${Math.min(profile.posts.length, POST_COUNT)}\u4EF6\u30FB\u4E0A\u304B\u3089\u65B0\u3057\u3044\u9806\uFF09\u3011`,
    tweetLines || "1.\uFF08\u53D6\u5F97\u5931\u6557\uFF09\u672C\u6587\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F",
    "",
    "\u3010\u2462\u63A5\u89E6\u5BFE\u8C61\u30C4\u30A4\u30FC\u30C8\u3011",
    `\u4E0A\u8A181\u4EF6\u76EE\uFF08\u6700\u65B0\u6295\u7A3F\uFF09\u3092\u63A5\u89E6\u5BFE\u8C61\u3068\u3059\u308B\u3002\u6295\u7A3F\u65E5\u6642\uFF1A${profile.posts[0]?.relativeTime || "\u4E0D\u660E"}`,
    "",
    "\u3010\u2463\u30EA\u30D7\u6B04\u30B5\u30F3\u30D7\u30EB\u3011\u7121"
  ];
  return `${promptText}

${body.join("\n")}`.trim();
}
async function pauseForResidual(waitUntil) {
  const remaining = waitUntil - Date.now();
  if (remaining <= 0) return true;
  setTimeout(() => {
    void schedulePump();
  }, remaining);
  return false;
}
async function doOs0Capture(state) {
  const sourceTabId = state.os0SourceTabId;
  if (!sourceTabId) {
    await saveRunState(handleError(state, "X\u30BF\u30D6\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093"));
    return false;
  }
  let listResult;
  try {
    await injectContentScript(sourceTabId, "content/x.js");
    listResult = await sendTabMessage(sourceTabId, { cmd: "X_EXTRACT_LIST" });
  } catch (error) {
    await saveRunState(handleError(state, error instanceof Error ? error.message : "X\u4E00\u89A7\u306E\u53D6\u5F97\u306B\u5931\u6557\u3057\u307E\u3057\u305F"));
    return false;
  }
  if (!listResult.ok || listResult.accounts.length === 0) {
    await saveRunState(handleError(state, listResult.error || "\u4E00\u89A7\u30DA\u30FC\u30B8\u3067\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044"));
    return false;
  }
  const excludedResponse = await bridgeCall("GET_EXCLUDED", { channel: "twitter" });
  const excluded = new Set((excludedResponse.handles ?? []).map((handle) => handle.toLowerCase()));
  const candidates = listResult.accounts.filter((account) => !excluded.has(account.handle.toLowerCase()));
  if (candidates.length === 0) {
    await saveRunState({
      ...state,
      phase: "DONE",
      endedAt: nowIso(),
      message: "\u65B0\u898F\u5019\u88DC\u306A\u3057",
      stats: { ...state.stats, os0Captured: listResult.accounts.length }
    });
    return false;
  }
  const promptResponse = await bridgeCall("GET_PROMPT", { key: "OS0_X" });
  if (!promptResponse.ready || !promptResponse.text) {
    await saveRunState(handleError(state, "divizero \u304B\u3089 OS0_X \u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F"));
    return false;
  }
  await saveRunState({
    ...state,
    phase: "OS0_GEMINI",
    os0PageType: listResult.pageType,
    currentDraft: formatOs0Prompt(promptResponse.text, candidates),
    currentRawInput: candidates.map((account) => `${account.displayName}\uFF5C${account.handle}\uFF5C${account.bio}`).join("\n"),
    message: "Gemini \u9001\u4FE1\u5F85\u3061",
    stats: { ...state.stats, os0Captured: listResult.accounts.length }
  });
  return true;
}
async function prepareGemini(state) {
  if (!state.currentDraft || !state.currentDraft.trim()) {
    await saveRunState(handleError(state, "Gemini \u306B\u6E21\u3059\u4E0B\u66F8\u304D\u304C\u3042\u308A\u307E\u305B\u3093"));
    return false;
  }
  try {
    const tabId = await ensureTab([GEMINI_ORIGIN], GEMINI_ORIGIN, "geminiTabId", { refreshOnReuse: true });
    await injectContentScript(tabId, "content/gemini.js");
    const label = state.phase === "OS0_GEMINI" ? "OS\u24EA \u4E00\u6B21\u9078\u5225" : `OS\u2460 \u63A5\u89E6\u30B9\u30AF\u30EA\u30FC\u30CB\u30F3\u30B0\uFF08${Math.min(state.currentIndex + 1, Math.max(state.queue.length, 1))}/${Math.max(state.queue.length, 1)}\uFF09`;
    const message = {
      cmd: "GEMINI_PREPARE",
      draftText: state.currentDraft,
      stepLabel: label,
      draftLength: state.currentDraft.length,
      draftPreview: state.currentDraft.slice(0, 180)
    };
    await sendTabMessage(tabId, message);
    return false;
  } catch (error) {
    await saveRunState(handleError(state, error instanceof Error ? error.message : "Gemini \u30BF\u30D6\u306B\u63A5\u7D9A\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F"));
    return false;
  }
}
async function doOs0Import(state) {
  const response = await bridgeCall("OS0_IMPORT", {
    aiOutput: state.currentCapturedText ?? "",
    channel: "twitter",
    rawInput: state.currentRawInput ?? "",
    sourceContext: {
      platform: "twitter",
      pageType: state.os0PageType ?? "unknown",
      url: state.os0SourceUrl ?? "",
      collectedBy: "chrome-extension",
      collectedAt: nowIso()
    }
  });
  if (!response.ok) {
    await saveRunState(handleError(state, `OS0_IMPORT \u5931\u6557: ${(response.missing ?? []).join(", ") || "unknown"}`));
    return false;
  }
  const queue = response.passed.slice(0, state.limitN).map((item) => ({
    screeningId: item.id,
    handle: item.handle.replace(/^@/, ""),
    displayName: item.displayName
  }));
  if (queue.length === 0) {
    await saveRunState({
      ...state,
      phase: "DONE",
      endedAt: nowIso(),
      queue: [],
      currentIndex: 0,
      message: "\u65B0\u898F\u5019\u88DC\u306A\u3057",
      stats: { ...state.stats, os0Passed: 0 }
    });
    return false;
  }
  await saveRunState({
    ...state,
    phase: "OS1_NAV",
    queue,
    currentIndex: 0,
    currentDraft: void 0,
    currentRawInput: void 0,
    currentCapturedText: void 0,
    currentHandle: queue[0]?.handle,
    message: queue.length < response.passed.length ? `\u4E0A\u9650 ${state.limitN} \u4EF6\u306B\u5236\u9650\u3057\u307E\u3057\u305F` : "OS\u2460\u3078\u9032\u884C\u4E2D",
    stats: { ...state.stats, os0Passed: queue.length }
  });
  return true;
}
async function doOs1Nav(state) {
  if (state.currentIndex >= state.queue.length) {
    await saveRunState({ ...state, phase: "DONE", endedAt: nowIso(), message: "\u5B8C\u4E86\u3057\u307E\u3057\u305F" });
    return false;
  }
  if (!state.waitUntil) {
    await saveRunState({
      ...state,
      waitUntil: Date.now() + randomThrottle(),
      currentHandle: state.queue[state.currentIndex]?.handle
    });
    return true;
  }
  const ready = await pauseForResidual(state.waitUntil);
  if (!ready) return false;
  const sourceTabId = state.os0SourceTabId;
  const queueItem = state.queue[state.currentIndex];
  if (!sourceTabId || !queueItem) {
    await saveRunState(handleError(state, "OS\u2460\u5BFE\u8C61\u30A2\u30AB\u30A6\u30F3\u30C8\u3092\u7279\u5B9A\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F"));
    return false;
  }
  try {
    await chrome.tabs.update(sourceTabId, { url: `https://x.com/${queueItem.handle}`, active: true });
    await waitForTabComplete(sourceTabId);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  } catch (error) {
    await saveRunState(handleError(state, error instanceof Error ? error.message : "X\u30D7\u30ED\u30D5\u30A3\u30FC\u30EB\u9077\u79FB\u306B\u5931\u6557\u3057\u307E\u3057\u305F"));
    return false;
  }
  await saveRunState({
    ...state,
    phase: "OS1_CAPTURE",
    waitUntil: void 0,
    currentHandle: queueItem.handle,
    message: `${queueItem.handle} \u306E\u30D7\u30ED\u30D5\u30A3\u30FC\u30EB\u53D6\u5F97\u4E2D`
  });
  return true;
}
async function doOs1Capture(state) {
  const sourceTabId = state.os0SourceTabId;
  const queueItem = state.queue[state.currentIndex];
  if (!sourceTabId || !queueItem) {
    await saveRunState(handleError(state, "OS\u2460\u5BFE\u8C61\u30A2\u30AB\u30A6\u30F3\u30C8\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093"));
    return false;
  }
  let profileResult;
  try {
    await injectContentScript(sourceTabId, "content/x.js");
    profileResult = await sendTabMessage(sourceTabId, {
      cmd: "X_EXTRACT_PROFILE",
      postCount: POST_COUNT
    });
  } catch (error) {
    const failed = {
      ...state,
      phase: "OS1_NAV",
      currentIndex: state.currentIndex + 1,
      currentDraft: void 0,
      currentRawInput: void 0,
      errors: [...state.errors, { at: nowIso(), phase: state.phase, message: String(error) }],
      stats: { ...state.stats, os1Failed: state.stats.os1Failed + 1 }
    };
    await saveRunState(failed);
    return true;
  }
  if (!profileResult.ok || !profileResult.profile) {
    await saveRunState({
      ...state,
      phase: "OS1_NAV",
      currentIndex: state.currentIndex + 1,
      currentDraft: void 0,
      currentRawInput: void 0,
      errors: [
        ...state.errors,
        { at: nowIso(), phase: state.phase, message: `${queueItem.handle}: ${profileResult.error || "profile missing"}` }
      ],
      stats: { ...state.stats, os1Failed: state.stats.os1Failed + 1 }
    });
    return true;
  }
  const promptResponse = await bridgeCall("GET_PROMPT", { key: "OS1_X" });
  if (!promptResponse.ready || !promptResponse.text) {
    await saveRunState(handleError(state, "divizero \u304B\u3089 OS1_X \u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F"));
    return false;
  }
  const rawInput = formatOs1Prompt("", profileResult.profile);
  await saveRunState({
    ...state,
    phase: "OS1_GEMINI",
    currentDraft: formatOs1Prompt(promptResponse.text, profileResult.profile),
    currentRawInput: rawInput,
    currentHandle: queueItem.handle,
    message: `${queueItem.handle} \u306E Gemini \u9001\u4FE1\u5F85\u3061`
  });
  return true;
}
async function notifyGeminiImport(geminiTabId, ok, message) {
  if (!geminiTabId) return;
  const msg = { cmd: "GEMINI_IMPORT_RESULT", ok, message };
  try {
    await sendTabMessage(geminiTabId, msg);
  } catch {
  }
}
async function doOs1Import(state) {
  const queueItem = state.queue[state.currentIndex];
  if (!queueItem) {
    await saveRunState(handleError(state, "OS\u2460\u5BFE\u8C61\u304C\u3042\u308A\u307E\u305B\u3093"));
    return false;
  }
  let response;
  try {
    response = await bridgeCall("OS1_IMPORT", {
      aiOutput: state.currentCapturedText ?? "",
      channel: "twitter",
      screeningId: queueItem.screeningId,
      rawInput: state.currentRawInput ?? "",
      sourceContext: {
        platform: "twitter",
        pageType: "profile",
        url: `https://x.com/${queueItem.handle}`,
        collectedBy: "chrome-extension",
        collectedAt: nowIso()
      }
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "bridge exception";
    await notifyGeminiImport(state.geminiTabId, false, `\u53D6\u8FBC\u5931\u6557: ${errMsg}`);
    await saveRunState({
      ...state,
      phase: "OS1_NAV",
      currentIndex: state.currentIndex + 1,
      currentDraft: void 0,
      currentRawInput: void 0,
      currentCapturedText: void 0,
      errors: [
        ...state.errors,
        { at: nowIso(), phase: state.phase, message: `${queueItem.handle}: ${errMsg}` }
      ],
      stats: { ...state.stats, os1Failed: state.stats.os1Failed + 1 }
    });
    return true;
  }
  if (!response.ok) {
    const reason = (response.missing ?? []).join(", ") || response.code || "OS1_IMPORT failed";
    await notifyGeminiImport(state.geminiTabId, false, `\u53D6\u8FBC\u5931\u6557: ${reason}`);
    await saveRunState({
      ...state,
      phase: "OS1_NAV",
      currentIndex: state.currentIndex + 1,
      currentDraft: void 0,
      currentRawInput: void 0,
      currentCapturedText: void 0,
      errors: [
        ...state.errors,
        {
          at: nowIso(),
          phase: state.phase,
          message: `${queueItem.handle}: ${reason}`
        }
      ],
      stats: { ...state.stats, os1Failed: state.stats.os1Failed + 1 }
    });
    return true;
  }
  await notifyGeminiImport(state.geminiTabId, true, `\u2713 ${queueItem.handle} \u3092\u53D6\u308A\u8FBC\u307F\u307E\u3057\u305F\uFF08OS\u2460\u30FBOS\u2461\u306B\u8FFD\u52A0\uFF09`);
  await saveRunState({
    ...state,
    phase: "OS1_NAV",
    currentIndex: state.currentIndex + 1,
    currentDraft: void 0,
    currentRawInput: void 0,
    currentCapturedText: void 0,
    stats: { ...state.stats, os1Done: state.stats.os1Done + 1 },
    message: `${queueItem.handle} \u3092\u53D6\u308A\u8FBC\u307F\u307E\u3057\u305F`
  });
  return true;
}
async function pumpOnce(state) {
  switch (state.phase) {
    case "OS0_CAPTURE":
      return doOs0Capture(state);
    case "OS0_GEMINI":
      return prepareGemini(state);
    case "OS0_IMPORT":
      return doOs0Import(state);
    case "OS1_NAV":
      return doOs1Nav(state);
    case "OS1_CAPTURE":
      return doOs1Capture(state);
    case "OS1_GEMINI":
      return prepareGemini(state);
    case "OS1_IMPORT":
      return doOs1Import(state);
    default:
      return false;
  }
}
async function schedulePump() {
  if (pumpInFlight) return;
  pumpInFlight = true;
  try {
    let keepGoing = true;
    while (keepGoing) {
      const state = await loadRunState();
      keepGoing = await pumpOnce(state);
    }
  } finally {
    pumpInFlight = false;
  }
}
async function startRunFromQueue(limitN) {
  const connection = await loadConnectionState();
  const current = await loadRunState();
  const appTab = await findTabByPrefix(DIVIZERO_ORIGINS);
  if (!appTab?.id) {
    return {
      ok: false,
      message: "\u30A2\u30D7\u30EA\uFF08localhost:5173 \u307E\u305F\u306F divizero.vercel.app\uFF09\u3092\u5148\u306B\u30D6\u30E9\u30A6\u30B6\u3067\u958B\u3044\u3066\u304F\u3060\u3055\u3044",
      runState: current,
      connection
    };
  }
  await saveRunState({ ...current, divizeroTabId: appTab.id });
  let queueItems = [];
  try {
    const res = await bridgeCall("GET_OS0_QUEUE", { channel: "twitter" });
    queueItems = res.items ?? [];
  } catch {
    return {
      ok: false,
      message: "app\u306B\u63A5\u7D9A\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\uFF08\u30A2\u30D7\u30EA\u3092\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u518D\u8A66\u884C\uFF09",
      runState: current,
      connection
    };
  }
  if (queueItems.length === 0) {
    return {
      ok: false,
      message: "OS\u24EA\u5F85\u6A5F\u4E2D\u306E\u30A2\u30AB\u30A6\u30F3\u30C8\u304C\u3042\u308A\u307E\u305B\u3093\uFF08Tab0\u3067\u30A2\u30AB\u30A6\u30F3\u30C8\u3092\u8FFD\u52A0\u3057\u3066\u304F\u3060\u3055\u3044\uFF09",
      runState: current,
      connection
    };
  }
  let xTabId;
  const activeTab = await getActiveTab();
  if (activeTab?.id && isXUrl(activeTab.url)) {
    xTabId = activeTab.id;
  } else {
    const existing = await findTabByPrefix(["https://x.com/", "https://twitter.com/"]);
    if (existing?.id) {
      xTabId = existing.id;
    } else {
      const created = await chrome.tabs.create({ url: "https://x.com/", active: true });
      if (!created.id) return { ok: false, message: "X\u30BF\u30D6\u3092\u4F5C\u6210\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F", runState: current, connection };
      await waitForTabComplete(created.id);
      xTabId = created.id;
    }
  }
  const queue = queueItems.slice(0, clampLimitN(limitN)).map((item) => ({
    screeningId: item.id,
    handle: item.handle.replace(/^@/, ""),
    displayName: item.displayName
  }));
  const nextState = {
    ...DEFAULT_RUN_STATE,
    runId: makeRunId(),
    phase: "OS1_NAV",
    channel: "twitter",
    limitN: clampLimitN(limitN),
    os0SourceTabId: xTabId,
    divizeroTabId: appTab.id,
    queue,
    currentIndex: 0,
    currentHandle: queue[0]?.handle,
    startedAt: nowIso(),
    message: `OS\u24EA\u30B9\u30AD\u30C3\u30D7 \u2192 ${queue.length}\u4EF6\u3092OS\u2460\u51E6\u7406\u3057\u307E\u3059`,
    stats: { ...DEFAULT_RUN_STATE.stats, os0Passed: queue.length }
  };
  await saveRunState(nextState);
  void schedulePump();
  return { ok: true, runState: nextState, connection };
}
async function startRun(limitN) {
  const activeTab = await getActiveTab();
  const connection = await loadConnectionState();
  const current = await loadRunState();
  if (!activeTab?.id || !isXUrl(activeTab.url)) {
    return { ok: false, message: "X\u306E\u691C\u7D22\u7D50\u679C\u304B\u30D5\u30A9\u30ED\u30EF\u30FC\u4E00\u89A7\u3092\u958B\u3044\u3066\u304B\u3089\u62BC\u3057\u3066\u304F\u3060\u3055\u3044", runState: current, connection };
  }
  const nextState = {
    ...DEFAULT_RUN_STATE,
    runId: makeRunId(),
    phase: "OS0_CAPTURE",
    channel: "twitter",
    limitN: clampLimitN(limitN),
    os0SourceTabId: activeTab.id,
    os0SourceUrl: activeTab.url,
    startedAt: nowIso(),
    message: "OS\u24EA\u3092\u958B\u59CB\u3057\u307E\u3059"
  };
  await saveRunState(nextState);
  void schedulePump();
  return { ok: true, runState: nextState, connection };
}
async function pauseRun() {
  const runState = await updateRunState(
    (state) => state.phase === "IDLE" || state.phase === "DONE" || state.phase === "ERROR" || state.phase === "PAUSED" ? state : { ...state, prevPhase: state.phase, phase: "PAUSED", message: "\u4E00\u6642\u505C\u6B62\u4E2D" }
  );
  return { ok: true, runState, connection: await loadConnectionState() };
}
async function resumeRun() {
  const runState = await updateRunState((state) => {
    if (state.phase === "PAUSED" && state.prevPhase) {
      return { ...state, phase: state.prevPhase, prevPhase: void 0, message: "\u518D\u958B\u3057\u307E\u3059" };
    }
    return state;
  });
  void schedulePump();
  return { ok: true, runState, connection: await loadConnectionState() };
}
async function abortRun() {
  const runState = await updateRunState((state) => ({
    ...state,
    phase: "IDLE",
    prevPhase: void 0,
    currentDraft: void 0,
    currentRawInput: void 0,
    currentCapturedText: void 0,
    waitUntil: void 0,
    message: "\u4E2D\u6B62\u3057\u307E\u3057\u305F"
  }));
  return { ok: true, runState, connection: await loadConnectionState() };
}
async function handlePopupCommand(message) {
  switch (message.cmd) {
    case "POPUP_START":
      return startRun(message.limitN);
    case "POPUP_START_FROM_QUEUE":
      return startRunFromQueue(message.limitN);
    case "POPUP_PAUSE":
      return pauseRun();
    case "POPUP_RESUME":
      return resumeRun();
    case "POPUP_ABORT":
      return abortRun();
    case "POPUP_STATUS":
      return { ok: true, runState: await loadRunState(), connection: await loadConnectionState() };
  }
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if ("cmd" in message && message.cmd === "DIVIZERO_PING_REPORT") {
    const report = message;
    const connection = report.ok ? { status: "connected", version: report.version, updatedAt: nowIso() } : { status: "error", error: report.error, updatedAt: nowIso() };
    void saveConnectionState(connection).then(() => sendResponse({ ok: true }));
    return true;
  }
  if ("cmd" in message && message.cmd === "GEMINI_CAPTURED") {
    void updateRunState((state) => ({
      ...state,
      currentCapturedText: message.clipboardText,
      phase: state.phase === "OS0_GEMINI" ? "OS0_IMPORT" : "OS1_IMPORT",
      message: "\u53D6\u8FBC\u51E6\u7406\u3078\u9032\u307F\u307E\u3059"
    })).then(() => schedulePump()).then(() => sendResponse({ ok: true }));
    return true;
  }
  if ("cmd" in message && message.cmd === "GEMINI_ABORTED") {
    void updateRunState((state) => {
      if (state.phase === "OS0_GEMINI") {
        return handleError(state, "Gemini\u5DE5\u7A0B\u3092\u4E2D\u6B62\u3057\u307E\u3057\u305F");
      }
      if (state.phase === "OS1_GEMINI" && message.reason === "skip") {
        return {
          ...state,
          phase: "OS1_NAV",
          currentIndex: state.currentIndex + 1,
          currentDraft: void 0,
          currentRawInput: void 0,
          currentCapturedText: void 0,
          message: "\u3053\u306E\u4EF6\u3092\u30B9\u30AD\u30C3\u30D7\u3057\u307E\u3057\u305F"
        };
      }
      return handleError(state, "Gemini\u5DE5\u7A0B\u3092\u4E2D\u6B62\u3057\u307E\u3057\u305F");
    }).then(() => schedulePump()).then(() => sendResponse({ ok: true }));
    return true;
  }
  if ("cmd" in message && String(message.cmd).startsWith("POPUP_")) {
    void handlePopupCommand(message).then(sendResponse);
    return true;
  }
  return false;
});
chrome.runtime.onStartup.addListener(() => {
  void schedulePump();
});
