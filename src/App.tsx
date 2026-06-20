import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from './hooks/useAuth'
import { useData } from './hooks/useData'
import { usePrompts } from './hooks/usePrompts'
import { buildTouchConvLog } from './utils/helpers'
import { BUILD_LABEL } from './buildInfo'
import Tab0 from './components/tabs/Tab0'
import Tab1 from './components/tabs/Tab1'
import Tab2 from './components/tabs/Tab2'
import Tab3 from './components/tabs/Tab3'
import Tab4 from './components/tabs/Tab4'
import Tab5 from './components/tabs/Tab5'
import type { PipelineItem } from './types'

type TabId = 'tab0' | 'tab1' | 'tab2' | 'tab3' | 'tab4' | 'tab5'

export interface ToastAPI {
  show: (msg: string, duration?: number) => void
  showUndo: (msg: string, onUndo: () => void) => void
}
export interface ConfirmAPI {
  show: (title: string, msg: string, cb: () => void) => void
}
export interface PrefilledOS3 {
  name: string
  track: 'FT' | 'NT' | 'SKIP'
  hypo: string
  startDate: string
  convText: string
  result: string
  pipelineId?: string
}

export default function App() {
  const { role, showLogin, checking, login, logout } = useAuth()
  const { data, loading, error, saveData } = useData()
  const { prompts } = usePrompts()
  const [activeTab, setActiveTab] = useState<TabId>('tab1')
  const [loginPw, setLoginPw] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const [prefilledOS3, setPrefilledOS3] = useState<PrefilledOS3 | null>(null)

  // Toast
  const [toastMsg, setToastMsg] = useState('')
  const [toastVisible, setToastVisible] = useState(false)
  const [undoCb, setUndoCb] = useState<(() => void) | null>(null)
  const [isUndoToast, setIsUndoToast] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((msg: string, duration = 2200) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setIsUndoToast(false)
    setUndoCb(null)
    setToastMsg(msg)
    setToastVisible(true)
    toastTimer.current = setTimeout(() => setToastVisible(false), duration)
  }, [])

  const showUndoToast = useCallback((msg: string, onUndo: () => void) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setIsUndoToast(true)
    setUndoCb(() => onUndo)
    setToastMsg(msg)
    setToastVisible(true)
    toastTimer.current = setTimeout(() => {
      setToastVisible(false)
      setIsUndoToast(false)
    }, 5000)
  }, [])

  const toast: ToastAPI = { show: showToast, showUndo: showUndoToast }

  // Confirm modal
  const [confirmState, setConfirmState] = useState<{
    open: boolean; title: string; msg: string; cb: () => void
  }>({ open: false, title: '', msg: '', cb: () => {} })

  const showConfirm = useCallback((title: string, msg: string, cb: () => void) => {
    setConfirmState({ open: true, title, msg, cb })
  }, [])

  const confirm: ConfirmAPI = { show: showConfirm }

  // Pull-to-refresh (mobile)
  useEffect(() => {
    let startY = 0
    let isPulling = false
    const threshold = 80
    function onTouchStart(e: TouchEvent) {
      if (window.scrollY === 0) { startY = e.touches[0].clientY; isPulling = true }
    }
    function onTouchEnd(e: TouchEvent) {
      if (!isPulling) return
      if (e.changedTouches[0].clientY - startY > threshold) window.location.reload()
      isPulling = false
    }
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchend', onTouchEnd)
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  // OS②→OS③ 情報引き継ぎ
  function handleCloseCase(item: PipelineItem, result: string) {
    const convText = buildTouchConvLog(item)
    setPrefilledOS3({
      name: item.accountName,
      track: item.track,
      hypo: item.hypothesis || '',
      startDate: item.startDate || '',
      convText,
      result,
      pipelineId: item.id,
    })
    setActiveTab('tab3')
  }

  // Login
  async function handleLogin() {
    if (!loginPw) { setLoginError('パスワードを入力してください'); return }
    setLoginBusy(true)
    const result = await login(loginPw)
    if (!result.success) {
      setLoginError(result.error || 'パスワードが違います')
    }
    setLoginBusy(false)
  }

  // Active pipeline warning
  const openPipeline = (data.pipeline || []).filter(p => p.isOpen)
  const warnCount = openPipeline.filter(p => {
    const days = Math.floor((Date.now() - new Date(p.lastContactDate || p.startDate || '').getTime()) / 86400000)
    const totalDays = Math.floor((Date.now() - new Date(p.startDate || '').getTime()) / 86400000)
    return days >= 7 || totalDays >= 30
  }).length

  // Trash badge
  const trashCount = (data.trash || []).length

  // Export (Tab4 handles internally)

  if (checking || loading) {
    return (
      <div className="fixed inset-0 z-[9998]" style={{ background: 'linear-gradient(135deg,#4c1d95,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: 'white' }}>
        <div className="bg-violet-600 text-white rounded-2xl w-14 h-14 flex items-center justify-center shadow-lg">
          <i className="fa-solid fa-cloud text-xl" />
        </div>
        <p className="text-base font-semibold">データを同期中...</p>
        <p className="text-xs text-violet-300">Firestore に接続しています</p>
        <i className="fa-solid fa-spinner fa-spin text-violet-300 text-lg mt-1" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#f8fafc' }}>
      {/* Login overlay */}
      {showLogin && (
        <div className="fixed inset-0 z-[9999]" style={{ background: 'linear-gradient(135deg,#4c1d95,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div className="login-card">
            <div className="text-center mb-7">
              <div className="bg-violet-600 text-white rounded-2xl w-14 h-14 flex items-center justify-center mx-auto mb-4 shadow-lg">
                <i className="fa-solid fa-lock text-xl" />
              </div>
              <h2 className="font-bold text-xl text-slate-900 mb-1">営業OSワークスペース</h2>
              <p className="text-sm text-slate-400">パスワードを入力してアクセスしてください</p>
            </div>
            <div className="flex flex-col gap-3">
              <input
                type="password"
                className="input-base"
                placeholder="パスワード"
                autoComplete="current-password"
                value={loginPw}
                onChange={e => setLoginPw(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
              />
              {loginError && <p className="text-xs text-rose-600 text-center">{loginError}</p>}
              <button
                className="btn-primary w-full justify-center py-3"
                onClick={handleLogin}
                disabled={loginBusy}
              >
                {loginBusy
                  ? <><i className="fa-solid fa-spinner fa-spin" /> 確認中…</>
                  : <><i className="fa-solid fa-arrow-right-to-bracket" />ログイン</>
                }
              </button>
            </div>
            <p className="text-[10px] text-slate-300 text-center mt-5">アクセス権限については管理者にお問い合わせください</p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-5 py-3 flex items-center justify-between gap-4">
          <span className="hidden sm:inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
            {BUILD_LABEL}
          </span>
          <div className="flex items-center gap-2" style={{ flexWrap: 'nowrap', overflowX: 'auto' }}>
            {role && (
              <span className={role === 'admin' ? 'role-badge-admin' : 'role-badge-viewer'}>
                {role === 'admin' ? '管理者' : '閲覧のみ'}
              </span>
            )}
            {role && (
              <button className="btn-sec text-xs" onClick={logout}>
                <i className="fa-solid fa-arrow-right-from-bracket text-slate-400" />
                <span className="hidden sm:inline">ログアウト</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Nav */}
      <div className="bg-white border-b border-slate-200 sticky z-30" style={{ top: 57 }}>
        <div className="max-w-7xl mx-auto px-5 flex gap-0 overflow-x-auto cs" style={{ whiteSpace: 'nowrap', WebkitOverflowScrolling: 'touch' }}>
          {([
            { id: 'tab0' as TabId, icon: 'fa-layer-group', label: 'OS⓪ 一次選別', badgeColor: 'bg-fuchsia-100 text-fuchsia-700', count: (data.screenings || []).length },
            { id: 'tab1' as TabId, icon: 'fa-filter', label: 'OS① スクリーニング', badgeColor: 'bg-violet-100 text-violet-700', count: data.targets.length },
            { id: 'tab2' as TabId, icon: 'fa-chart-gantt', label: 'OS② パイプライン', badgeColor: 'bg-indigo-100 text-indigo-700', count: openPipeline.length, warn: warnCount },
            { id: 'tab3' as TabId, icon: 'fa-graduation-cap', label: 'OS③ 案件検証', badgeColor: 'bg-emerald-100 text-emerald-700', count: data.closed.length },
            { id: 'tab4' as TabId, icon: 'fa-chart-pie', label: '集計ダッシュボード', badgeColor: '', count: null },
            { id: 'tab5' as TabId, icon: 'fa-clock-rotate-left', label: '分析履歴', badgeColor: 'bg-violet-100 text-violet-700', count: (data.analyses || []).filter(a => a.status === 'completed').length || null },
          ] as const).map(tab => (
            <button
              key={tab.id}
              className={`nav-tab${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <i className={`fa-solid ${tab.icon}`} />
              {tab.label}
              {tab.count !== null && (
                <span className={`badge ${tab.badgeColor}`}>{tab.count}</span>
              )}
              {tab.id === 'tab2' && warnCount > 0 && (
                <span className="badge bg-amber-100 text-amber-700">{warnCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-amber-50 border-b border-amber-200 px-5 py-2 text-xs text-amber-800">
          <i className="fa-solid fa-triangle-exclamation mr-1" />{error}
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-5 flex flex-col gap-5">
        {activeTab === 'tab0' && <Tab0 data={data} saveData={saveData} prompts={prompts} role={role} toast={toast} confirm={confirm} onGoToTab1={() => setActiveTab('tab1')} />}
        {activeTab === 'tab1' && <Tab1 data={data} saveData={saveData} prompts={prompts} role={role} toast={toast} confirm={confirm} />}
        {activeTab === 'tab2' && <Tab2 data={data} saveData={saveData} prompts={prompts} role={role} toast={toast} confirm={confirm} onGoToTab3={() => setActiveTab('tab3')} onCloseCase={handleCloseCase} />}
        {activeTab === 'tab3' && <Tab3 data={data} saveData={saveData} prompts={prompts} role={role} toast={toast} confirm={confirm} prefill={prefilledOS3} onPrefillConsumed={() => setPrefilledOS3(null)} />}
        {activeTab === 'tab4' && <Tab4 data={data} saveData={saveData} role={role} toast={toast} confirm={confirm} />}
        {activeTab === 'tab5' && <Tab5 data={data} role={role} />}
      </main>

      {/* Toast */}
      <div
        className={`fixed bottom-5 right-5 bg-slate-950 text-white text-xs px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 transition duration-300 z-50 border border-slate-700 ${toastVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-16 pointer-events-none'}`}
        style={{ maxWidth: 320 }}
      >
        {isUndoToast ? (
          <>
            <i className="fa-solid fa-trash text-slate-400" />
            <span className="flex-1">{toastMsg}</span>
            <button
              className="shrink-0 ml-1 text-violet-300 font-bold border border-violet-500 rounded px-2 py-0.5 text-[11px] hover:bg-violet-900 transition"
              onClick={() => {
                if (undoCb) undoCb()
                setToastVisible(false)
                setIsUndoToast(false)
                setTimeout(() => showToast('元に戻しました'), 100)
              }}
            >元に戻す</button>
          </>
        ) : (
          <>
            <i className="fa-solid fa-circle-check text-emerald-400" />
            <span>{toastMsg}</span>
          </>
        )}
      </div>

      {/* Confirm modal */}
      {confirmState.open && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
            <div className="p-5 flex gap-3">
              <div className="p-2.5 bg-violet-50 text-violet-600 rounded-xl h-10 w-10 flex items-center justify-center flex-shrink-0">
                <i className="fa-solid fa-circle-info" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">{confirmState.title}</h3>
                <p className="text-xs text-slate-500 mt-1">{confirmState.msg}</p>
              </div>
            </div>
            <div className="bg-slate-50 px-5 py-3 flex justify-end gap-2">
              <button className="btn-sec text-xs py-2 px-3" onClick={() => setConfirmState(s => ({ ...s, open: false }))}>キャンセル</button>
              <button className="btn-primary text-xs py-2 px-4" onClick={() => { confirmState.cb(); setConfirmState(s => ({ ...s, open: false })) }}>実行</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
