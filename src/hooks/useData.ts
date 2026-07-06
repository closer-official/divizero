import { useState, useEffect, useCallback, useRef } from 'react';
import { doc, onSnapshot, setDoc, type Firestore } from 'firebase/firestore';
import { initFirebase } from '../firebase';
import type { AppData, PipelineItem, Touch } from '../types';
import { uid } from '../utils/helpers';

const EMPTY_DATA = (): AppData => ({
  screenings: [],
  targets: [],
  pipeline: [],
  closed: [],
  excluded: [],
  trash: [],
  logs: [],
});

function buildLoadedData(raw: Partial<AppData> | null | undefined): AppData {
  return { ...EMPTY_DATA(), ...(raw || {}) }
}

function isLikeOnlyTouch(touch: Touch): boolean {
  if (touch.reactionReplyMode === 'like_only') return true
  if (touch.status !== 'awaiting_reaction') return false
  if (/いいねのみ/.test(touch.actualSentText || '')) return true
  const turns = touch.conversationTurns || []
  const lastSelfTurn = [...turns].reverse().find(turn => turn.role === '自分')
  return !!lastSelfTurn && /いいねのみ/.test(lastSelfTurn.text)
}

function normalizeTouch(touch: Touch): Touch {
  if (!isLikeOnlyTouch(touch)) return touch
  return {
    ...touch,
    status: 'reacted',
    reactionReplyMode: 'like_only',
    ...(touch.touchMode === 'conversation' || (touch.conversationTurns?.length ?? 0) > 0
      ? { threadStatus: 'inactive' as const }
      : {}),
  }
}

function inferInboundActions(item: PipelineItem, touch: Touch): string[] {
  if (item.inboundActions?.length) return item.inboundActions
  if (item.inbound_signal?.type) return [item.inbound_signal.type]
  const note = touch.reactionNote || ''
  const m = note.match(/^相手から先に接触あり：([^\n]+)/)
  if (!m) return []
  return m[1].split('、').map(part => part.trim()).filter(Boolean)
}

function inferInboundMemo(item: PipelineItem, touch: Touch): string {
  if (item.inbound_signal?.memo?.trim()) return item.inbound_signal.memo.trim()
  const note = touch.reactionNote || ''
  const m = note.match(/【受信内容・メモ】\n([\s\S]*)$/)
  return m?.[1]?.trim() || ''
}

function normalizeInboundTouch(item: PipelineItem, touch: Touch): Touch {
  const looksInbound = !!item.isInbound
    || !!item.inbound_signal
    || (item.inboundActions?.length ?? 0) > 0
    || /相手から先に接触あり/.test(touch.reactionNote || '')
  if (!looksInbound) return touch

  const actions = inferInboundActions(item, touch)
  const actionsStr = actions.join('、')
  const memo = inferInboundMemo(item, touch)
  const primaryReaction =
    /DM|突然DM|返信/.test(actionsStr) ? 'テキスト返信'
    : /フォロー/.test(actionsStr) ? 'フォロー返し'
    : /いいね/.test(actionsStr) ? 'いいね返り'
    : /スタンプ|絵文字/.test(actionsStr) ? 'スタンプ・絵文字'
    : '未記録'
  const turnText = memo || (actionsStr ? `相手からの${actionsStr}` : '相手からのインバウンド')
  const turnChannel: 'DM' | 'リプ' = /DM|突然DM/.test(actionsStr) ? 'DM' : 'リプ'
  const conversationTurns = (touch.conversationTurns?.length ?? 0) > 0
    ? touch.conversationTurns
    : [{
        id: uid(),
        role: '相手' as const,
        text: turnText,
        timestamp: item.inbound_signal?.date || touch.date,
        channel: turnChannel,
        sentStatus: 'sent' as const,
      }]

  const normalized: Touch = {
    ...touch,
    status: touch.status || 'reacted',
    reactionType: touch.reactionType === '未記録' ? primaryReaction : touch.reactionType,
    reactionReplyMode: touch.reactionReplyMode ?? (primaryReaction === 'テキスト返信' ? 'text' : 'none'),
    touchMode: 'conversation',
    threadEntry: 'inbound',
    threadStatus: touch.threadStatus || 'active',
    conversationTurns,
  }

  return normalized
}

function normalizePipelineItem(item: PipelineItem): PipelineItem {
  const touches = item.touches
  if (!touches || touches.length === 0) return item
  const normalizedTouches = touches.map(touch => normalizeTouch(normalizeInboundTouch(item, touch)))
  const changed = normalizedTouches.length !== touches.length
    || normalizedTouches.some((touch, idx) => touch !== touches[idx])
  if (!changed) return item
  return { ...item, touches: normalizedTouches }
}

function normalizeAppData(data: AppData): AppData {
  const pipeline = data.pipeline || []
  const normalizedPipeline = pipeline.map(normalizePipelineItem)
  const changed = normalizedPipeline.length !== pipeline.length
    || normalizedPipeline.some((item, idx) => item !== pipeline[idx])
  if (!changed) return data
  return { ...data, pipeline: normalizedPipeline }
}

export function useData() {
  const [data, setData] = useState<AppData>(EMPTY_DATA());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [db, setDb] = useState<Firestore | null>(null);
  // Track in-flight Firestore writes so onSnapshot reverts don't overwrite local state
  const pendingWrites = useRef(0);

  useEffect(() => {
    let unsub: (() => void) | null = null;

    initFirebase()
      .then(firestoreDb => {
        setDb(firestoreDb);
        const docRef = doc(firestoreDb, 'workspace', 'main');
        unsub = onSnapshot(
          docRef,
          snap => {
            // Skip if a local write is still in-flight to prevent server revert from
            // overwriting optimistically-committed local state
            if (pendingWrites.current > 0) {
              setLoading(false);
              return;
            }
            if (snap.exists()) {
              try {
                const loaded = buildLoadedData(JSON.parse(snap.data().payload ?? '{}') as Partial<AppData>);
                const normalized = normalizeAppData(loaded);
                setData(normalized);
                if (JSON.stringify(normalized) !== JSON.stringify(loaded)) {
                  pendingWrites.current++;
                  setDoc(docRef, { payload: JSON.stringify(normalized) })
                    .then(() => {
                      pendingWrites.current--;
                    })
                    .catch(e => {
                      pendingWrites.current--;
                      console.error('Firestore migration write error', e);
                      localStorage.setItem('os_data_v1', JSON.stringify(normalized));
                    });
                }
              } catch {
                setData(EMPTY_DATA());
              }
            } else {
              const empty = EMPTY_DATA();
              setData(empty);
              setDoc(docRef, { payload: JSON.stringify(empty) }).catch(console.error);
            }
            setLoading(false);
          },
          err => {
            console.error('Firestore error', err);
            setData(EMPTY_DATA());
            setLoading(false);
            setError('Firestore接続エラー: ' + err.message);
          }
        );
      })
      .catch(err => {
        console.error('Firebase init error', err);
        // Fall back to localStorage if Firebase is unavailable
        const stored = localStorage.getItem('os_data_v1');
        if (stored) {
          try {
            const loaded = buildLoadedData(JSON.parse(stored) as Partial<AppData>);
            const normalized = normalizeAppData(loaded);
            setData(normalized);
            if (JSON.stringify(normalized) !== JSON.stringify(loaded)) {
              localStorage.setItem('os_data_v1', JSON.stringify(normalized));
            }
          } catch {
            setData(EMPTY_DATA());
          }
        } else {
          setData(EMPTY_DATA());
        }
        setLoading(false);
        setError('Firebase未接続 (ローカルモード): ' + String(err));
      });

    return () => {
      if (unsub) unsub();
    };
  }, []);

  const saveData = useCallback((updater: (prev: AppData) => AppData) => {
    setData(prev => {
      const next = updater(prev);
      if (db) {
        const docRef = doc(db, 'workspace', 'main');
        pendingWrites.current++;
        setDoc(docRef, { payload: JSON.stringify(next) })
          .then(() => {
            pendingWrites.current--;
          })
          .catch(e => {
            pendingWrites.current--;
            console.error('Firestore write error', e);
            // Fallback: save to localStorage so data survives page reload
            localStorage.setItem('os_data_v1', JSON.stringify(next));
          });
      } else {
        // No Firestore → save to localStorage
        localStorage.setItem('os_data_v1', JSON.stringify(next));
      }
      return next;
    });
  }, [db]);

  return { data, loading, error, saveData };
}
