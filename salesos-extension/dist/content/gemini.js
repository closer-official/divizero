// src/content/gemini.ts
var host = null;
var shadow = null;
var session = null;
var draftElement = null;
var metaElement = null;
var GLOBAL_FLAG = "__salesosGeminiInitialized";
if (globalThis[GLOBAL_FLAG]) {
} else {
  let ensurePanel = function() {
    if (host && shadow) return shadow;
    host = document.createElement("div");
    host.id = "salesos-gemini-panel";
    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .panel {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        width: 320px;
        padding: 16px;
        border-radius: 18px;
        background: rgba(20, 25, 33, 0.96);
        color: #f5f7fb;
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
      }
      h2 {
        margin: 0 0 10px;
        font-size: 14px;
      }
      p {
        margin: 0 0 12px;
        color: #d7deea;
      }
      .draft {
        max-height: 140px;
        overflow: auto;
        margin: 0 0 10px;
        padding: 10px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.08);
        white-space: pre-wrap;
        word-break: break-word;
        color: #f1f6ff;
      }
      .meta {
        margin: -4px 0 10px;
        color: #9fb0c5;
        font-size: 12px;
      }
      .placeholder {
        color: #9fb0c5;
      }
      .status {
        min-height: 18px;
        margin-bottom: 10px;
        color: #ffca80;
      }
      .actions {
        display: grid;
        gap: 8px;
      }
      button {
        border: 0;
        border-radius: 999px;
        padding: 10px 12px;
        font: inherit;
        cursor: pointer;
      }
      .primary {
        background: #96f0c8;
        color: #0d2418;
        font-weight: 700;
      }
      .secondary {
        background: #243041;
        color: #f5f7fb;
      }
      .danger {
        background: #6f2530;
        color: #fff1f3;
      }
      .copy {
        display: none;
        background: #355d8b;
        color: #f4f8ff;
      }
    </style>
    <div class="panel">
      <h2 id="title">SalesOS Assistant</h2>
      <p>\u2460 \u5165\u529B\u6B04\u3092\u78BA\u8A8D\uFF08\u4E0B\u66F8\u304D\u633F\u5165\u6E08\u307F\u3002\u7A7A\u306A\u3089Ctrl+V\u3067\u8CBC\u308A\u4ED8\u3051\uFF09\u2192 \u2461 \u9001\u4FE1\u3092\u62BC\u3059 \u2192 \u2462 \u51FA\u529B\u306E\u30B3\u30D4\u30FC\u30DC\u30BF\u30F3\u3092\u62BC\u3059 \u2192 \u2463 \u4E0B\u306E\u3010\u53D6\u8FBC\u3011\u3092\u62BC\u3059</p>
      <div id="meta" class="meta"></div>
      <div id="draft" class="draft"></div>
      <div id="status" class="status"></div>
      <div class="actions">
        <button id="import" class="primary" type="button">\u53D6\u8FBC</button>
        <button id="copy" class="copy" type="button">\u4E0B\u66F8\u304D\u3092\u30B3\u30D4\u30FC</button>
        <button id="skip" class="secondary" type="button">\u3053\u306E\u4EF6\u3092\u30B9\u30AD\u30C3\u30D7</button>
        <button id="abort" class="danger" type="button">\u4E2D\u6B62</button>
      </div>
    </div>
  `;
    const importButton = shadow.getElementById("import");
    const copyButton = shadow.getElementById("copy");
    const skipButton = shadow.getElementById("skip");
    const abortButton = shadow.getElementById("abort");
    draftElement = shadow.getElementById("draft");
    metaElement = shadow.getElementById("meta");
    importButton.addEventListener("click", async () => {
      if (!session) return;
      const status = getStatusElement();
      try {
        const clipboardText = await navigator.clipboard.readText();
        const normalize = (s) => s.replace(/\r\n/g, "\n").trim();
        if (!clipboardText.trim() || normalize(clipboardText) === normalize(session.draftText)) {
          status.textContent = "\u51FA\u529B\u306E\u30B3\u30D4\u30FC\u30DC\u30BF\u30F3\u3092\u62BC\u3057\u3066\u304B\u3089\u53D6\u8FBC\u3057\u3066\u304F\u3060\u3055\u3044";
          return;
        }
        const payload = { cmd: "GEMINI_CAPTURED", clipboardText };
        await chrome.runtime.sendMessage(payload);
        status.textContent = "\u53D6\u8FBC\u5F85\u3061\u306B\u9032\u307F\u307E\u3057\u305F";
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "\u30AF\u30EA\u30C3\u30D7\u30DC\u30FC\u30C9\u3092\u8AAD\u3081\u307E\u305B\u3093\u3067\u3057\u305F";
      }
    });
    copyButton.addEventListener("click", async () => {
      if (!session) return;
      try {
        await navigator.clipboard.writeText(session.draftText);
        getStatusElement().textContent = "\u4E0B\u66F8\u304D\u3092\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F\u3002Gemini\u5165\u529B\u6B04\u3067Ctrl+V\u3057\u3066\u304F\u3060\u3055\u3044";
      } catch (error) {
        getStatusElement().textContent = error instanceof Error ? error.message : "\u30B3\u30D4\u30FC\u306B\u5931\u6557\u3057\u307E\u3057\u305F";
      }
    });
    skipButton.addEventListener("click", async () => {
      const payload = { cmd: "GEMINI_ABORTED", reason: "skip" };
      await chrome.runtime.sendMessage(payload);
    });
    abortButton.addEventListener("click", async () => {
      const payload = { cmd: "GEMINI_ABORTED", reason: "abort" };
      await chrome.runtime.sendMessage(payload);
    });
    document.documentElement.appendChild(host);
    return shadow;
  }, getStatusElement = function() {
    return ensurePanel().getElementById("status");
  }, setTitle = function(stepLabel) {
    ;
    ensurePanel().getElementById("title").textContent = stepLabel;
  }, setCopyFallback = function(visible) {
    const button = ensurePanel().getElementById("copy");
    button.style.display = visible ? "block" : "none";
    button.textContent = visible ? "\u4E0B\u66F8\u304D\u3092\u30B3\u30D4\u30FC\uFF08Ctrl+V\u7528\uFF09" : "\u4E0B\u66F8\u304D\u3092\u30B3\u30D4\u30FC";
  }, focusComposer = function() {
    const richTextArea = document.querySelector('rich-textarea div[contenteditable="true"]');
    if (richTextArea) {
      const rect = richTextArea.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        richTextArea.focus();
        return richTextArea;
      }
    }
    for (const el of document.querySelectorAll('[role="textbox"][contenteditable="true"]')) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        el.focus();
        return el;
      }
    }
    const candidates = Array.from(
      document.querySelectorAll('div[contenteditable="true"], textarea, input[type="text"]')
    );
    const composer = candidates.find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
    }) ?? candidates.at(-1) ?? null;
    composer?.focus();
    return composer;
  }, insertDraft = function(draftText) {
    const composer = focusComposer();
    if (!composer) return false;
    try {
      if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
        const start = composer.selectionStart ?? composer.value.length;
        const end = composer.selectionEnd ?? composer.value.length;
        composer.setRangeText(draftText, start, end, "end");
        composer.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        return true;
      }
      const selection = window.getSelection();
      if (!selection) return document.execCommand("insertText", false, draftText);
      const range = document.createRange();
      range.selectNodeContents(composer);
      selection.removeAllRanges();
      selection.addRange(range);
      const inserted = document.execCommand("insertText", false, draftText);
      if (inserted) {
        composer.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: draftText, inputType: "insertText" }));
      }
      return inserted;
    } catch {
      return false;
    }
  };
  ensurePanel2 = ensurePanel, getStatusElement2 = getStatusElement, setTitle2 = setTitle, setCopyFallback2 = setCopyFallback, focusComposer2 = focusComposer, insertDraft2 = insertDraft;
  ;
  globalThis[GLOBAL_FLAG] = true;
  async function prepare(message) {
    session = {
      draftText: message.draftText,
      stepLabel: message.stepLabel,
      copyFallback: false,
      draftLength: message.draftLength ?? message.draftText.length
    };
    setTitle(message.stepLabel);
    draftElement.textContent = message.draftText.trim() ? message.draftText : "\u4E0B\u66F8\u304D\u304C\u7A7A\u3067\u3059\u3002divizero \u5074\u306E\u30D7\u30ED\u30F3\u30D7\u30C8\u8AAD\u307F\u8FBC\u307F\u3092\u78BA\u8A8D\u3057\u3066\u3001\u3082\u3046\u4E00\u5EA6\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
    draftElement.classList.toggle("placeholder", !message.draftText.trim());
    metaElement.textContent = `\u4E0B\u66F8\u304D\u6587\u5B57\u6570: ${session.draftLength}`;
    getStatusElement().textContent = "";
    setCopyFallback(false);
    try {
      await navigator.clipboard.writeText(message.draftText);
    } catch {
      session.copyFallback = true;
      setCopyFallback(true);
      getStatusElement().textContent = "Ctrl+V\u7528\u306E\u81EA\u52D5\u30B3\u30D4\u30FC\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002\u5FC5\u8981\u306A\u3089\u3010\u30B3\u30D4\u30FC\u3011\u3092\u62BC\u3057\u3066\u304F\u3060\u3055\u3044";
    }
    let inserted = false;
    for (let attempt = 0; attempt < 6 && !inserted; attempt++) {
      if (attempt > 0) {
        getStatusElement().textContent = `\u5165\u529B\u6B04\u3092\u63A2\u3057\u3066\u3044\u307E\u3059... (${attempt}/5)`;
        await new Promise((r) => setTimeout(r, 1e3));
      }
      inserted = insertDraft(message.draftText);
    }
    if (inserted) {
      getStatusElement().textContent = "\u4E0B\u66F8\u304D\u3092\u6E96\u5099\u3057\u307E\u3057\u305F\u3002Gemini \u3067\u9001\u4FE1\u3057\u3066\u304F\u3060\u3055\u3044";
    } else if (!session.copyFallback) {
      getStatusElement().textContent = "\u5165\u529B\u6B04\u3078\u81EA\u52D5\u633F\u5165\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u53F3\u4E0B\u306E\u3010\u4E0B\u66F8\u304D\u3092\u30B3\u30D4\u30FC\u3011\u3092\u62BC\u3057\u3066\u8CBC\u308A\u4ED8\u3051\u3066\u304F\u3060\u3055\u3044";
    }
  }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.cmd === "GEMINI_PREPARE") {
      void prepare(message).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "prepare failed" }));
      return true;
    }
    if (message.cmd === "GEMINI_IMPORT_RESULT") {
      const statusEl = ensurePanel().getElementById("status");
      if (statusEl) {
        statusEl.textContent = message.message;
        statusEl.style.color = message.ok ? "#7affb0" : "#ff9090";
      }
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
}
var ensurePanel2;
var getStatusElement2;
var setTitle2;
var setCopyFallback2;
var focusComposer2;
var insertDraft2;
