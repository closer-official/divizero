;(function () {
  'use strict'
  // content script の isolated world から MAIN world へ Extension ID を注入する
  // window.__OS_EXT_ID を設定することで React の ReceiveService が拡張機能と通信できる
  const extId = chrome.runtime.id
  const script = document.createElement('script')
  script.textContent = [
    '(function(){',
    '  if(window.__OS_EXT_ID) return;',
    '  Object.defineProperty(window,"__OS_EXT_ID",{',
    '    value:' + JSON.stringify(extId) + ',',
    '    writable:false,configurable:false,enumerable:false',
    '  });',
    '})();',
  ].join('')
  ;(document.head || document.documentElement).appendChild(script)
  script.remove()
})()
