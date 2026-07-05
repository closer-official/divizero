/**
 * 遡及温度計算スクリプト（読み取り専用・本番データ書き込みなし）
 *
 * 使い方:
 *   node scripts/retroactiveTemperature.mjs
 *   ※ .env.local に VITE_FIREBASE_* が設定されていれば dev サーバー不要
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

import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initializeApp } from 'firebase/app'
import { getFirestore, doc, getDoc } from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// --- CLI 引数: --url https://xxx.vercel.app ---
const urlArgIdx = process.argv.indexOf('--url')
const VERCEL_URL = urlArgIdx !== -1 ? process.argv[urlArgIdx + 1] : null

// --- .env.local から VITE_FIREBASE_* を読み込む ---
function loadEnvLocal() {
  const envPath = resolve(ROOT, '.env.local')
  if (!existsSync(envPath)) return null
  const lines = readFileSync(envPath, 'utf-8').split('\n')
  const env = {}
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    env[key] = val
  }
  return env
}

// --- Firebase 設定取得（.env.local → Vercel URL の順で試みる） ---
async function resolveFirebaseConfig() {
  // ① .env.local から
  const env = loadEnvLocal()
  if (env && env['VITE_FIREBASE_API_KEY'] && env['VITE_FIREBASE_PROJECT_ID']) {
    console.log('📂 .env.local から Firebase 設定を読み込みます')
    return {
      apiKey:            env['VITE_FIREBASE_API_KEY'],
      authDomain:        env['VITE_FIREBASE_AUTH_DOMAIN'],
      projectId:         env['VITE_FIREBASE_PROJECT_ID'],
      storageBucket:     env['VITE_FIREBASE_STORAGE_BUCKET'],
      messagingSenderId: env['VITE_FIREBASE_MESSAGING_SENDER_ID'],
      appId:             env['VITE_FIREBASE_APP_ID'],
    }
  }

  // ② --url オプション（Vercel 本番 URL）から /api/config を取得
  if (VERCEL_URL) {
    const url = VERCEL_URL.replace(/\/$/, '') + '/api/config'
    console.log(`🌐 ${url} から Firebase 設定を取得します`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
    return await res.json()
  }

  // どちらもない場合は使い方を案内して終了
  console.error('❌ Firebase 設定が見つかりません。以下のいずれかを行ってください:')
  console.error('')
  console.error('  A) .env.local に VITE_FIREBASE_* を設定する（.env.local.example 参照）')
  console.error('')
  console.error('  B) デプロイ済み Vercel URL を --url で渡す:')
  console.error('     node scripts/retroactiveTemperature.mjs --url https://your-app.vercel.app')
  process.exit(1)
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
  const config = await resolveFirebaseConfig()

  console.log(`📡 Firebase projectId: ${config.projectId} に接続中...`)
  const app = initializeApp(config)
  const db  = getFirestore(app)

  const snap = await getDoc(doc(db, 'workspace', 'main'))
  if (!snap.exists()) {
    console.error('❌ Firestore の workspace/main ドキュメントが存在しません')
    process.exit(1)
  }

  const raw      = snap.data().payload
  const data     = typeof raw === 'string' ? JSON.parse(raw) : raw
  const pipeline = data.pipeline || []

  const targets    = pipeline.filter(p => p.temperature == null)
  const alreadySet = pipeline.filter(p => p.temperature != null)

  console.log(`\n=== 遡及温度計算レポート ===`)
  console.log(`パイプライン総件数   : ${pipeline.length}件`)
  console.log(`温度設定済み         : ${alreadySet.length}件（内訳: ${alreadySet.map(p => `${p.accountName}=${p.temperature}`).slice(0,5).join(', ')}${alreadySet.length > 5 ? '...' : ''}）`)
  console.log(`温度未設定（対象）   : ${targets.length}件`)
  console.log(``)

  if (targets.length === 0) {
    console.log('✅ 温度未設定の案件はありません。')
    process.exit(0)
  }

  // 計算結果
  const rows = targets.map(p => {
    const touches  = p.touches || []
    const computed = computeTemperatureFromTouches(touches)
    const toArr    = r => Array.isArray(r) ? r : (r ? [r] : [])
    const hasFollow  = touches.some(t => toArr(t.reactionType).includes('フォロー返し'))
    const replyTotal = touches.filter(t => toArr(t.reactionType).includes('テキスト返信')).length
    const likeTotal  = touches.filter(t => toArr(t.reactionType).includes('いいね返り')).length
    const noReact    = touches.filter(t => toArr(t.reactionType).includes('無反応')).length
    const judgments  = [...new Set(touches.map(t => t.reactionJudgment).filter(Boolean))].join(' / ') || '—'

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

  // 温度分布
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

  // 詳細一覧（温度降順）
  const sorted = [...rows].sort((a, b) => b.computedTemp - a.computedTemp)

  const W = { name:20, track:6, state:14, touch:6, like:6, reply:4, follow:8, no:6, temp:8, judge:1 }
  console.log('--- 詳細一覧（温度降順）---')
  console.log(
    'アカウント名'.padEnd(W.name) +
    'トラック'.padEnd(W.track) +
    '状態'.padEnd(W.state) +
    'タッチ'.padEnd(W.touch) +
    'いいね'.padEnd(W.like) +
    '返信'.padEnd(W.reply) +
    'フォロー'.padEnd(W.follow) +
    '無反応'.padEnd(W.no) +
    '算出温度'.padEnd(W.temp) +
    '最新S1判定'
  )
  console.log('─'.repeat(110))

  for (const r of sorted) {
    console.log(
      r.name.slice(0, W.name - 2).padEnd(W.name) +
      r.track.padEnd(W.track) +
      r.state.padEnd(W.state) +
      String(r.touchCount).padEnd(W.touch) +
      String(r.likeTotal).padEnd(W.like) +
      String(r.replyTotal).padEnd(W.reply) +
      r.hasFollow.padEnd(W.follow) +
      String(r.noReact).padEnd(W.no) +
      String(r.computedTemp).padEnd(W.temp) +
      r.judgments
    )
  }

  console.log('')
  console.log(`算出温度 > 0 の案件: ${rows.filter(r => r.computedTemp > 0).length}件`)
  console.log(`算出温度 = 0 の案件: ${rows.filter(r => r.computedTemp === 0).length}件`)
  console.log('')
  console.log('⚠️  このスクリプトは読み取り専用です。実データへの書き込みは行っていません。')
  console.log('   反映する場合は「遡及反映してください」と伝えてください。')
}

main().catch(e => { console.error(e); process.exit(1) })
