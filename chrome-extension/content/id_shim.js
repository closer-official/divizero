;(function () {
  'use strict'
  // CSP対策: インラインスクリプト注入はブロックされるため DOM属性を使う
  // content script は CSP の制限を受けない isolated world で動作する
  const extId = chrome.runtime.id
  console.log('[OS Ext] id_shim: setting data-os-ext-id =', extId)
  document.documentElement.setAttribute('data-os-ext-id', extId)
})()
