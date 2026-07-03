// src/content/divizero.ts
var GLOBAL_FLAG = "__salesosDivizeroInitialized";
if (globalThis[GLOBAL_FLAG]) {
} else {
  let makeRequestId = function() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }, bridgeRequest = function(type, payload, timeoutMs = 1e4) {
    const requestId = makeRequestId();
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("BRIDGE_TIMEOUT"));
      }, timeoutMs);
      const onMessage = (event) => {
        if (event.source !== window) return;
        if (event.origin !== location.origin) return;
        if (event.data?.source !== "salesos-app") return;
        if (event.data.requestId !== requestId) return;
        cleanup();
        resolve(event.data.payload);
      };
      const cleanup = () => {
        window.clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
      };
      window.addEventListener("message", onMessage);
      const envelope = {
        source: "salesos-ext",
        type,
        requestId,
        payload
      };
      window.postMessage(envelope, location.origin);
    });
  };
  makeRequestId2 = makeRequestId, bridgeRequest2 = bridgeRequest;
  ;
  globalThis[GLOBAL_FLAG] = true;
  async function reportPing() {
    try {
      const response = await bridgeRequest("APP_PING", {});
      const report = {
        cmd: "DIVIZERO_PING_REPORT",
        ok: true,
        version: response?.version
      };
      await chrome.runtime.sendMessage(report);
    } catch (error) {
      const report = {
        cmd: "DIVIZERO_PING_REPORT",
        ok: false,
        error: error instanceof Error ? error.message : "APP_PING failed"
      };
      await chrome.runtime.sendMessage(report);
    }
  }
  void reportPing();
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.cmd !== "BRIDGE") return false;
    void bridgeRequest(message.type, message.payload).then((payload) => sendResponse(payload)).catch((error) => {
      sendResponse({
        ok: false,
        code: error instanceof Error ? error.message : "BRIDGE_TIMEOUT"
      });
    });
    return true;
  });
}
var makeRequestId2;
var bridgeRequest2;
