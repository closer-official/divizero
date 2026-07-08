import{j as l}from"./react-De3l3DUN.js";import{r as g,v as y}from"./index-BM3eEPff.js";function v({content:s,filename:r,onClose:a}){function n(){const e=new Blob([s],{type:"text/markdown"}),i=URL.createObjectURL(e),t=document.createElement("a");t.href=i,t.download=r,t.click(),URL.revokeObjectURL(i)}return l.jsx("div",{className:"fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-4",onClick:a,children:l.jsxs("div",{className:"bg-white w-full max-w-2xl rounded-2xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col",style:{maxHeight:"85vh"},onClick:e=>e.stopPropagation(),children:[l.jsxs("div",{className:"p-4 border-b border-slate-100 flex items-center gap-3",children:[l.jsx("i",{className:"fa-solid fa-file-lines text-violet-500"}),l.jsx("span",{className:"font-bold text-sm text-slate-800 flex-1 truncate",children:r}),l.jsx("button",{className:"text-slate-400 hover:text-slate-700 p-1 transition",onClick:a,children:l.jsx("i",{className:"fa-solid fa-xmark"})})]}),l.jsx("div",{className:"flex-1 overflow-y-auto cs p-4",children:l.jsx("pre",{className:"text-[12px] text-slate-700 whitespace-pre-wrap font-mono leading-relaxed",children:s})}),l.jsxs("div",{className:"p-4 border-t border-slate-100 flex justify-end gap-2",children:[l.jsx("button",{className:"btn-sec text-xs",onClick:a,children:"閉じる"}),l.jsxs("button",{className:"btn-primary text-xs",onClick:n,children:[l.jsx("i",{className:"fa-solid fa-file-arrow-down"}),"ダウンロード"]})]})]})})}function m(s){if(!s)return"—";const r=new Date(s);return isNaN(r.getTime())?s:r.toLocaleDateString("ja-JP")}function p(){const s=new Date,r=s.getFullYear(),a=String(s.getMonth()+1).padStart(2,"0"),n=String(s.getDate()).padStart(2,"0");return`${r}${a}${n}`}function N(s){const r=s.touches||[],a=r.filter(t=>g(t.reactionType,"いいね返り")).length,n=r.some(t=>g(t.reactionType,"フォロー返し"));let e=`# ${s.accountName}（${s.url}）| ${s.channel} | ${s.track}

`;e+=`**案件ID：** ${s.id}
`,e+=`**接触開始日：** ${m(s.startDate)}
`,e+=`**事前仮説：** ${s.hypothesis||"—"}
`,e+=`**現在ステップ：** ${s.currentStep}
`,e+=`**S1接触数：** ${r.length}回　いいね返り：${a}回　フォロー返し：${n?"有":"無"}

`,e+=`---

## タッチ履歴

`,r.forEach((t,f)=>{var $;if(t.touchMode==="conversation"){const o={s1l_promotion:"S1-L昇格",s3_direct:"S3直行（IGストーリー）",log_restore:"ログ復元"},c=t.threadEntry?o[t.threadEntry]??t.threadEntry:"";e+=`### 会話スレッド${f+1}${c?` — ${c}`:""}

`,(t.conversationTurns??[]).forEach(d=>{const x=d.role==="自分"?"▶ 自分":"◀ 相手";e+=`**${x}**（${m(d.timestamp)}）
${d.text}

`,d.dmSuggestedA&&(e+=`　DM提案A：${d.dmSuggestedA}
`,e+=`　DM提案B：${d.dmSuggestedB}
`,e+=`　次の狙い：${d.dmNextAim}
`,d.dmOs2Recommended&&(e+=`　⚠ OS²起動推奨あり
`)),d.os2Judgment&&(e+=`　OS②判定：${d.os2Judgment} ／ 次アクション：${d.os2NextAction||"—"}
`),e+=`
`}),e+=`---

`}else e+=`### タッチ${f+1} — ${m(t.date)}

`,e+=`**接触した投稿（要約）：** ${t.targetPostText||"—"}
`,t.targetPostRawText&&(e+=`**投稿原文：** ${t.targetPostRawText}
`),e+=`**投稿種別：** ${t.targetPostType}　**対象妥当性：** ${t.targetValidity}

`,t.aiSuggestedText&&(e+=`**AI提案文：** ${t.aiSuggestedText}
`),t.os2ReplyA&&(e+=`**AI提案文A：** ${t.os2ReplyA}
`,t.os2ReplyB&&(e+=`**AI提案文B：** ${t.os2ReplyB}
`)),e+=`
**実際に送った文章：** ${t.actualSentText||"—"}
`,e+=`**変えた理由：** ${t.editReason||"（なし）"}

`,e+=`**文面妥当性：** ${t.messageValidity}`,t.judgedAt&&(e+=`（${m(t.judgedAt)}判定）`),e+=`
`,t.judgmentReason&&(e+=`**判定理由：** ${t.judgmentReason}
`),t.editEvaluation&&(e+=`**編集評価：** ${t.editEvaluation}　${t.editComment||""}
`),t.improvementSuggestion&&t.improvementSuggestion!=="なし"&&(e+=`**改善提案：** ${t.improvementSuggestion}
`),t.improvedText&&t.improvedText!=="なし"&&(e+=`**改善案：** ${t.improvedText}
`),e+=`
**相手の反応：** ${y(t.reactionType)}
`,t.reactionNote&&(e+=`**反応の補足：** ${t.reactionNote}
`),t.os2Judgment&&(e+=`
**OS②判定：** ${t.os2Judgment}
`,e+=`**次アクション：** ${t.os2NextAction||"—"}
`),t.threadStatus==="active"&&(($=t.conversationTurns)!=null&&$.length)&&(e+=`
#### 会話スレッド

`,t.conversationTurns.forEach(o=>{const c=o.role==="自分"?"▶ 自分":"◀ 相手";e+=`**${c}**（${m(o.timestamp)}）
${o.text}

`,o.os2Judgment&&(e+=`　OS②判定：${o.os2Judgment} / 次アクション：${o.os2NextAction||"—"}
`,e+=`
`)})),e+=`
---

`});const i=r.filter(t=>t.os2Judgment);return i.length>0&&(e+=`## OS②判定履歴

`,e+=`| 日付 | 判定 | 次アクション |
`,e+=`|------|------|-------------|
`,i.forEach(t=>{e+=`| ${m(t.date)} | ${t.os2Judgment} | ${t.os2NextAction||"—"} |
`}),e+=`
`),e}function j(s){return`${s.accountName.replace(/[\\/:*?"<>|]/g,"_")}_${p()}.md`}function b(s){const r=(s.pipeline||[]).filter(i=>i.isOpen),a=s.closed||[],n=r.length+a.length;let e=`# 案件サマリ — ${new Date().toLocaleDateString("ja-JP")}出力

`;return e+=`総案件数：${n}件（進行中：${r.length}件 / クローズ済み：${a.length}件）

`,e+=`---

`,e+=`## 進行中案件

`,r.length===0?e+=`進行中の案件はありません。

`:(e+=`| アカウント | チャネル | トラック | ステップ | タッチ数 | 最終接触 | いいね返り |
`,e+=`|----------|---------|---------|---------|---------|---------|----------|
`,r.forEach(i=>{const t=i.touches||[],f=t.filter(o=>g(o.reactionType,"いいね返り")).length,$=t.length>0?m(t.reduce((o,c)=>c.date>o?c.date:o,t[0].date)):m(i.lastContactDate);e+=`| ${i.accountName} | ${i.channel} | ${i.track} | ${i.currentStep} | ${t.length} | ${$} | ${f} |
`}),e+=`
`),e+=`## クローズ済み案件

`,a.length===0?e+=`クローズ済みの案件はありません。

`:(e+=`| アカウント | クローズタイプ | 学習価値 | クローズ日 |
`,e+=`|----------|-------------|---------|----------|
`,a.forEach(i=>{e+=`| ${i.accountName} | ${i.closeType||i.result} | ${i.learningValue??"—"} | ${m(i.closeDate||i.createdAt)} |
`}),e+=`
`),e}function A(){return`cases_summary_${p()}.md`}function w(s){const r=[...s.analyses||[]].filter(n=>n.status==="completed").sort((n,e)=>(e.completedAt||e.triggeredAt).localeCompare(n.completedAt||n.triggeredAt));let a=`# 分析レポート — ${new Date().toLocaleDateString("ja-JP")}出力

`;return r.length===0?(a+=`完了済みの分析がありません。
`,a):(a+=`---

`,r.forEach(n=>{const e=n.completedAt||n.triggeredAt,i=e?new Date(e).toLocaleDateString("ja-JP"):"—";n.type==="case_pattern"?(a+=`## 失注パターン分析（${i}）

`,n.targetCount&&(a+=`**対象案件数：** ${n.targetCount}件
`),n.topLossType&&(a+=`**最多失注タイプ：** ${n.topLossType}
`),n.winRate&&(a+=`**受注率：** ${n.winRate}
`),n.patternSummary&&(a+=`
**パターン要約：**
${n.patternSummary}
`),n.lastActionImprovement&&(a+=`
**前回指摘の改善状況：** ${n.lastActionImprovement}
`),n.highValuePattern&&(a+=`
**学習価値高案件の共通点：**
${n.highValuePattern}
`),n.actionItem&&(a+=`
**今すぐ直すべき1点：** ${n.actionItem}
`),n.nextFocusPoint&&(a+=`**次回注目ポイント：** ${n.nextFocusPoint}
`)):n.type==="touch_trend"?(a+=`## 文面傾向分析（${i}）

`,n.targetCount&&(a+=`**対象タッチ数：** ${n.targetCount}件
`),n.targetValiditySummary&&(a+=`**対象妥当性：** ${n.targetValiditySummary}
`),n.messageValiditySummary&&(a+=`**文面妥当性：** ${n.messageValiditySummary}
`),n.editEvalSummary&&(a+=`**編集評価：** ${n.editEvalSummary}
`),n.topImprovementPattern&&(a+=`
**最多改善提案パターン：**
${n.topImprovementPattern}
`),n.frequentNgPostType&&(a+=`**よく出る投稿種別✕：** ${n.frequentNgPostType}
`),n.trendComment&&(a+=`
**傾向コメント：**
${n.trendComment}
`),n.actionItem&&(a+=`
**今すぐ直すべき1点：** ${n.actionItem}
`)):n.type==="emergency_alert"&&(a+=`## 対象選び警告（${i}）

`,n.alertDetail&&(a+=`${n.alertDetail}
`)),a+=`
---

`}),a)}function T(){return`analysis_report_${p()}.md`}export{v as M,b as a,N as b,j as c,w as d,T as e,A as s};
