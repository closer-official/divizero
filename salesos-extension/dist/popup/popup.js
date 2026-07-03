// src/popup/popup.ts
var PHASE_LABELS = {
  IDLE: "\u5F85\u6A5F",
  OS0_CAPTURE: "OS\u24EA \u53D6\u5F97",
  OS0_GEMINI: "OS\u24EA Gemini\u5F85\u3061",
  OS0_IMPORT: "OS\u24EA \u53D6\u8FBC",
  OS1_NAV: "OS\u2460 \u9077\u79FB\u5F85\u3061",
  OS1_CAPTURE: "OS\u2460 \u53D6\u5F97",
  OS1_GEMINI: "OS\u2460 Gemini\u5F85\u3061",
  OS1_IMPORT: "OS\u2460 \u53D6\u8FBC",
  PAUSED: "\u4E00\u6642\u505C\u6B62",
  DONE: "\u5B8C\u4E86",
  ERROR: "\u30A8\u30E9\u30FC"
};
var app = document.getElementById("app");
app.innerHTML = `
  <style>
    body {
      margin: 0;
      background: #f4f0e8;
      color: #1d1f22;
      font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: 360px;
      padding: 16px;
      box-sizing: border-box;
    }
    .card {
      background: #fffaf3;
      border: 1px solid #dfd6c9;
      border-radius: 18px;
      padding: 14px;
      box-shadow: 0 12px 28px rgba(61, 43, 17, 0.08);
    }
    h1 {
      margin: 0 0 12px;
      font-size: 16px;
    }
    .meta {
      margin: 8px 0;
      color: #665c4d;
    }
    .row {
      display: grid;
      gap: 8px;
      margin-top: 12px;
    }
    .row input {
      border: 1px solid #cabda8;
      border-radius: 10px;
      padding: 9px 10px;
      font: inherit;
      background: #fff;
    }
    .buttons {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-top: 12px;
    }
    button {
      border: 0;
      border-radius: 999px;
      padding: 10px 12px;
      font: inherit;
      cursor: pointer;
    }
    .primary { background: #2d6a4f; color: #f4fff6; }
    .secondary { background: #e8dcc9; color: #3f3325; }
    .danger { background: #8b3a3a; color: #fff5f5; }
    .ghost { background: #d9ecff; color: #0f426a; }
    ul {
      margin: 10px 0 0;
      padding-left: 18px;
    }
    #message {
      min-height: 20px;
      margin-top: 10px;
      color: #7b3829;
    }
  </style>
  <section class="card">
    <h1>SalesOS Assistant</h1>
    <div id="phase" class="meta">\u72B6\u614B: \u8AAD\u307F\u8FBC\u307F\u4E2D</div>
    <div id="progress" class="meta"></div>
    <div id="stats" class="meta"></div>
    <div id="connection" class="meta"></div>
    <div class="row">
      <label for="limitN">\u4E0A\u9650N\uFF081\u301C30\uFF09</label>
      <input id="limitN" type="number" min="1" max="30" value="10" />
    </div>
    <div class="buttons">
      <button id="start" class="primary" type="button">OS\u2460\u307E\u3067\u5B9F\u884C</button>
      <button id="pause" class="secondary" type="button">\u4E00\u6642\u505C\u6B62</button>
      <button id="resume" class="ghost" type="button">\u518D\u958B</button>
      <button id="abort" class="danger" type="button">\u4E2D\u6B62</button>
    </div>
    <button id="startFromQueue" class="ghost" type="button" style="width:100%; margin-top:8px;">OS\u24EA\u30B9\u30AD\u30C3\u30D7 \u2192 OS\u2460\u51E6\u7406\uFF08\u30B9\u30AF\u30EA\u30FC\u30CB\u30F3\u30B0\u6D88\u5316\uFF09</button>
    <button id="refresh" class="secondary" type="button" style="width:100%; margin-top:8px;">\u524D\u56DE\u7D50\u679C\u3092\u898B\u308B</button>
    <div id="message"></div>
    <ul id="errors"></ul>
  </section>
`;
var limitInput = document.getElementById("limitN");
var phaseEl = document.getElementById("phase");
var progressEl = document.getElementById("progress");
var statsEl = document.getElementById("stats");
var connectionEl = document.getElementById("connection");
var messageEl = document.getElementById("message");
var errorsEl = document.getElementById("errors");
var startButton = document.getElementById("start");
async function sendCommand(message) {
  return chrome.runtime.sendMessage(message);
}
function isXUrl(url) {
  return Boolean(url && /^https:\/\/(x|twitter)\.com\//.test(url));
}
async function getActiveTabIsX() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return isXUrl(tab?.url);
}
function render(response, activeTabIsX) {
  const { runState, connection } = response;
  const baseMessage = response.ok ? runState.message || "" : response.message;
  const warningMessage = "\u26A0\uFE0F X\u306E\u691C\u7D22\u7D50\u679C\u304B\u30D5\u30A9\u30ED\u30EF\u30FC\u4E00\u89A7\u3092\u958B\u3044\u3066\u304B\u3089\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044";
  phaseEl.textContent = `\u72B6\u614B: ${PHASE_LABELS[runState.phase]}`;
  progressEl.textContent = `\u9032\u6357: ${Math.min(runState.currentIndex, runState.queue.length)}/${runState.queue.length}`;
  statsEl.textContent = `OS0\u53D6\u5F97 ${runState.stats.os0Captured} / OS0\u901A\u904E ${runState.stats.os0Passed} / OS1\u5B8C\u4E86 ${runState.stats.os1Done} / OS1\u5931\u6557 ${runState.stats.os1Failed}`;
  connectionEl.textContent = connection.status === "connected" ? `divizero\u63A5\u7D9A: OK (${connection.version || "version unknown"})` : connection.status === "error" ? `divizero\u63A5\u7D9A: \u30A8\u30E9\u30FC (${connection.error || "unknown"})` : "divizero\u63A5\u7D9A: \u672A\u78BA\u8A8D";
  startButton.disabled = !activeTabIsX;
  messageEl.textContent = activeTabIsX ? baseMessage : baseMessage ? `${warningMessage} / ${baseMessage}` : warningMessage;
  errorsEl.innerHTML = "";
  for (const error of runState.errors.slice(-3).reverse()) {
    const item = document.createElement("li");
    item.textContent = `[${error.phase}] ${error.message}`;
    errorsEl.appendChild(item);
  }
}
async function refresh() {
  const [response, activeTabIsX] = await Promise.all([
    sendCommand({ cmd: "POPUP_STATUS" }),
    getActiveTabIsX()
  ]);
  render(response, activeTabIsX);
}
document.getElementById("start").addEventListener("click", async () => {
  const response = await sendCommand({ cmd: "POPUP_START", limitN: Number(limitInput.value) || 10 });
  render(response, await getActiveTabIsX());
});
document.getElementById("pause").addEventListener("click", async () => {
  const response = await sendCommand({ cmd: "POPUP_PAUSE" });
  render(response, await getActiveTabIsX());
});
document.getElementById("resume").addEventListener("click", async () => {
  const response = await sendCommand({ cmd: "POPUP_RESUME" });
  render(response, await getActiveTabIsX());
});
document.getElementById("abort").addEventListener("click", async () => {
  const response = await sendCommand({ cmd: "POPUP_ABORT" });
  render(response, await getActiveTabIsX());
});
document.getElementById("startFromQueue").addEventListener("click", async () => {
  const response = await sendCommand({ cmd: "POPUP_START_FROM_QUEUE", limitN: Number(limitInput.value) || 10 });
  render(response, await getActiveTabIsX());
});
document.getElementById("refresh").addEventListener("click", refresh);
void refresh();
window.setInterval(() => void refresh(), 1e3);
