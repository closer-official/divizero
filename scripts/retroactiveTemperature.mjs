/**
 * 遡及温度計算スクリプト（読み取り専用・本番データ書き込みなし）
 *
 * 使い方:
 *   1. npm run dev でアプリを起動しておく（/api/config エンドポイントが必要）
 *   2. node scripts/retroactiveTemperature.mjs
 *
 * 出力: temperature が未設定の pipeline 案件について、
 *       touch履歴から算出した推定温度を一覧表示する。
 *       実データには一切書き込まない。
 *
 * 温度算出ルール（OS_S1行動判定_バッチ_latest.md L17 準拠）:
 *   フォロー返し     → 25点
 *   テキスト返信2回+ → 20点
 *   テキスト返信1回  → 15点
 *   いいね返り2回+   → 10点
 *   いいね返り1回    →  5点
 *   その他/無反応    →  0点
 *   ※ 最も高い1段階のみ採用（加算しない）
 */

import { initializeApp } from 'firebase/app'
import { getFirestore, doc, getDoc } from 'firebase/firestore'

// --- Firebase 設定取得 ---
async function fetchFirebaseConfig() {
  try {
    const res = await fetch('http://localhost:5173/api/config')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (e) {
    console.error('❌ /api/config の取得に失敗しました。npm run dev が起動中か確認してください。')
    console.error(e.message)
    process.exit(1)
  }
}

// --- 温度算出（touch履歴から） ---
function computeTemperatureFromTouches(touches) {
  if (!touches || touches.length === 0) return 0

  const toArr = (r) => {
    if (!r) return []
    return Array.isArray(r) ? r : [r]
  }
  const hasR = (reactionType, target) => toArr(reactionType).includes(target)

  const hasFollow  = touches.some(t => hasR(t.reactionType, 'フォロー返し'))
  const replyTotal = touches.filter(t => hasR(t.reactionType, 'テキスト返信')).length
  const likeTotal  = touches.filter(t => hasR(t.reactionType, 'いいね返り')).length

  if (hasFollow)       return 25
  if (replyTotal >= 2) return 20
  if (replyTotal >= 1) return 15
  if (likeTotal  >= 2) return 10
  if (likeTotal  >= 1) return  5
  return 0
}

// --- メイン ---
async function main() {
  const config = await fetchFirebaseConfig()
  const app = initializeApp(config)
  const db  = getFirestore(app)

  const snap = await getDoc(doc(db, 'workspace', 'main'))
  if (!snap.exists()) {
    console.error('❌ Firestore の workspace/main ドキュメントが存在しません')
    process.exit(1)
  }

  const raw  = snap.data().payload
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw
  const pipeline = data.pipeline || []

  // temperature が未設定（undefined / null）の案件のみ対象
  const targets = pipeline.filter(p => p.temperature == null)
  const alreadySet = pipeline.filter(p => p.temperature != null)

  console.log(`\n=== 遡及温度計算レポート ===`)
  console.log(`パイプライン総件数   : ${pipeline.length}件`)
  console.log(`温度設定済み         : ${alreadySet.length}件`)
  console.log(`温度未設定（対象）   : ${targets.length}件`)
  console.log(``)

  if (targets.length === 0) {
    console.log('温度未設定の案件はありません。')
    process.exit(0)
  }

  // 計算結果テーブル
  const rows = targets.map(p => {
    const touches  = p.touches || []
    const computed = computeTemperatureFromTouches(touches)
    const hasFollow  = touches.some(t => [].concat(t.reactionType || []).includes('フォロー返し'))
    const replyTotal = touches.filter(t => [].concat(t.reactionType || []).includes('テキスト返信')).length
    const likeTotal  = touches.filter(t => [].concat(t.reactionType || []).includes('いいね返り')).length
    const noReact    = touches.filter(t => [].concat(t.reactionType || []).includes('無反応')).length
    const judgments  = touches.map(t => t.reactionJudgment).filter(Boolean).join(' / ') || '—'

    return {
      id          : p.id,
      name        : p.accountName,
      track       : p.track || '—',
      state       : p.state || '—',
      touchCount  : touches.length,
      likeTotal,
      replyTotal,
      hasFollow   : hasFollow ? 'あり' : '—',
      noReact,
      computedTemp: computed,
      judgments   : judgments.slice(0, 40),
    }
  })

  // 計算後温度の分布
  const dist = {}
  for (const r of rows) {
    dist[r.computedTemp] = (dist[r.computedTemp] || 0) + 1
  }

  console.log('--- 計算後温度の分布 ---')
  Object.entries(dist)
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .forEach(([temp, count]) => {
      const bar = '█'.repeat(Math.min(count, 40))
      console.log(`  温度 ${String(temp).padStart(2)} : ${String(count).padStart(3)}件  ${bar}`)
    })
  console.log('')

  // 詳細一覧（温度 > 0 の案件を先に表示）
  const sorted = [...rows].sort((a, b) => b.computedTemp - a.computedTemp)

  console.log('--- 詳細一覧（温度降順）---')
  console.log(
    'アカウント名'.padEnd(20) +
    'トラック'.padEnd(6) +
    '状態'.padEnd(14) +
    'タッチ'.padEnd(6) +
    'いいね'.padEnd(6) +
    '返信'.padEnd(4) +
    'フォロー'.padEnd(8) +
    '無反応'.padEnd(6) +
    '算出温度'.padEnd(8) +
    '最新S1判定'
  )
  console.log('─'.repeat(110))

  for (const r of sorted) {
    console.log(
      r.name.slice(0, 18).padEnd(20) +
      r.track.padEnd(6) +
      r.state.padEnd(14) +
      String(r.touchCount).padEnd(6) +
      String(r.likeTotal).padEnd(6) +
      String(r.replyTotal).padEnd(4) +
      r.hasFollow.padEnd(8) +
      String(r.noReact).padEnd(6) +
      String(r.computedTemp).padEnd(8) +
      r.judgments
    )
  }

  console.log('')
  console.log('─'.repeat(110))
  console.log(`算出温度 > 0 の案件: ${rows.filter(r => r.computedTemp > 0).length}件`)
  console.log(`算出温度 = 0 の案件: ${rows.filter(r => r.computedTemp === 0).length}件`)
  console.log('')
  console.log('⚠️  このスクリプトは読み取り専用です。実データへの書き込みは行っていません。')
  console.log('   反映する場合は scripts/applyRetroactiveTemperature.mjs を別途実行してください。')
}

main().catch(e => { console.error(e); process.exit(1) })
