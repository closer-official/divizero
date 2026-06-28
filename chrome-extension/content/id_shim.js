;(function () {
  'use strict'
  // content script の isolated world から MAIN world へ Extension ID を注入する
  const extId = chrome.runtime.id
  console.log('[OS Ext] id_shim running, extId:', extId, 'url:', location.href)

  const script = document.createElement('script')
  script.textContent = [
    '(function(){',
    '  if(window.__OS_EXT_ID) { console.log("[OS Ext] __OS_EXT_ID already set:", window.__OS_EXT_ID); return; }',
    '  Object.defineProperty(window,"__OS_EXT_ID",{',
    '    value:' + JSON.stringify(extId) + ',',
    '    writable:false,configurable:false,enumerable:false',
    '  });',
    '  console.log("[OS Ext] __OS_EXT_ID injected:", window.__OS_EXT_ID);',
    '  window.dispatchEvent(new CustomEvent("os_ext_ready", { detail: { extId:' + JSON.stringify(extId) + ' } }));',
    '})();',
  ].join('')
  ;(document.head || document.documentElement).appendChild(script)
  script.remove()
})()
