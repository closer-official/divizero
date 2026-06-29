import type { AppData, ExcludedAccount, TrashItem, TouchReaction, Touch } from '../types';

export function toReactionArr(r: TouchReaction | TouchReaction[] | string | undefined): TouchReaction[] {
  if (!r) return []
  return Array.isArray(r) ? r : [r as TouchReaction]
}

export function hasReaction(r: TouchReaction | TouchReaction[] | string | undefined, reaction: TouchReaction): boolean {
  return toReactionArr(r).includes(reaction)
}

export function reactionDisplay(r: TouchReaction | TouchReaction[] | string | undefined): string {
  const arr = toReactionArr(r)
  return arr.length === 0 ? '未記録' : arr.join('・')
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function shortPostId(): string {
  return 'P' + Math.random().toString(36).slice(2, 8).toUpperCase()
}

export function daysSince(dateStr?: string | null): number {
  if (!dateStr) return 999;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

export function urgencyClass(days: number): string {
  if (days < 4) return 'urgency-ok';
  if (days < 7) return 'urgency-warn';
  return 'urgency-danger';
}

export function trackBadgeClass(track: string): string {
  if (track === 'FT') return 'track-ft';
  if (track === 'NT') return 'track-nt';
  if (track === 'UT') return 'track-ut';
  return 'track-skip';
}

export function closeTypeBadgeClass(type?: string): string {
  if (!type) return 'close-type-i';
  if (type.startsWith('W')) return 'close-type-w';
  if (type === 'TypeI') return 'close-type-i';
  return 'close-type-l';
}

export function normalizeHandle(u?: string): string {
  return (u || '').trim().replace(/^@/, '').toLowerCase().replace(/^.*\//, '');
}

export function buildProfileUrl(raw: string | undefined, channel?: string): string {
  if (!raw) return '';
  const s = raw.trim();
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  const handle = s.startsWith('@') ? s.slice(1) : s;
  if (!handle) return '';
  if (channel === 'instagram') return `https://www.instagram.com/${handle}/`;
  if (channel === 'threads') return `https://www.threads.net/@${handle}`;
  return `https://x.com/${handle}`;
}

export function getProfileUrl(item: { url?: string; channel?: string }): string {
  return buildProfileUrl(item.url, item.channel);
}

export function addToExcluded(d: AppData, handle: string, displayName: string, channel: string, reason: string, skipCode = ''): void {
  if (!d.excluded) d.excluded = [];
  const nh = normalizeHandle(handle);
  if (!nh) return;
  if (d.excluded.some(e => normalizeHandle(e.handle) === nh)) return;
  const h = handle.startsWith('@') ? handle : '@' + handle;
  d.excluded.push({
    id: uid(), handle: h, displayName: displayName || '',
    channel: channel as ExcludedAccount['channel'],
    reason: reason || '手動削除', skipCode: skipCode || '',
    addedAt: new Date().toISOString()
  });
}

export function moveToTrash(d: AppData, item: Record<string, unknown>, source: string): string {
  if (!d.trash) d.trash = [];
  const _trashId = 'tr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  d.trash.push({ ...item, _trashSource: source, _trashedAt: Date.now(), _trashId } as TrashItem);
  return _trashId;
}

export function buildConvLog(p: {
  sentMessages?: Array<{id: string; actual?: string; original?: string; date: string; label: string; edited?: boolean}>;
  replies?: Array<{sentMsgId: string | null; reaction?: string; text?: string; date: string}>;
}): string {
  const msgs = p.sentMessages || [];
  const replies = p.replies || [];
  if (msgs.length === 0 && replies.length === 0) return '';
  const parts: string[] = [];
  msgs.forEach((sm, i) => {
    const txt = sm.actual || sm.original || '';
    const editNote = sm.edited ? '（編集済み）' : '';
    parts.push(`【自分｜送信${i + 1}（${sm.date}）${sm.label}${editNote}】\n${txt}`);
    replies.filter(r => r.sentMsgId === sm.id).forEach(r => {
      const rxLabel = r.reaction ? ` ｜${r.reaction}` : '';
      const body = r.text || '（テキスト返信なし）';
      parts.push(`【相手｜送信${i + 1}への反応（${r.date}）${rxLabel}】\n${body}`);
    });
  });
  replies.filter(r => !msgs.find(m => m.id === r.sentMsgId)).forEach(r => {
    const rxLabel = r.reaction ? ` ｜${r.reaction}` : '';
    const body = r.text || '（テキスト返信なし）';
    parts.push(`【相手（${r.date}）${rxLabel}】\n${body}`);
  });
  return parts.join('\n\n');
}

export function stepsBarData(currentStep: string): Array<{cls: string; tip: string}> {
  const steps = ['S1','S2','S3','S4','S5'];
  const STEP_LABELS: Record<string, string> = {
    S1: 'S1 リプ交流（公開リプでファーストコンタクト）',
    S2: 'S2 DM移行（DMへ切り替えて関係深化）',
    S3: 'S3 事業開示（自分の仕事を自然に開示）',
    S4: 'S4 ヒアリング（相手の課題・状況をヒアリング）',
    S5: 'S5 提案・クローズ（具体的な提案を行う）',
  };
  const ci = steps.indexOf(currentStep);
  return steps.map((s, i) => {
    let cls = 's-node todo';
    if (i < ci) cls = 's-node done';
    else if (i === ci) cls = 's-node current';
    return { cls, tip: STEP_LABELS[s] || s };
  });
}

export function buildTouchConvLog(item: { accountName: string; channel: string; track: string; hypothesis?: string; startDate?: string; currentStep: string; judgment?: string | null; nextAction?: string | null; salesExpectation?: number; salesExpectationReason?: string; touches?: Array<{ date: string; targetPostType: string; targetValidity: string; targetPostText?: string; actualSentText: string; editReason?: string; messageValidity: string; judgmentReason?: string; improvementSuggestion?: string; reactionType: TouchReaction | TouchReaction[] | string; reactionNote?: string; os2Judgment?: string; os2NextAction?: string; os2ReplyA?: string; os2ReplyB?: string; conversationTurns?: Array<{ role: string; text: string; channel: string; timestamp: string }> }> }): string {
  const touches = item.touches || [];
  const lines: string[] = [
    `【案件情報】`,
    `アカウント名: ${item.accountName}`,
    `チャネル: ${item.channel}`,
    `トラック: ${item.track}`,
    `仮説: ${item.hypothesis || '未設定'}`,
    `現在ステップ: ${item.currentStep}`,
    `接触開始: ${item.startDate || '-'}`,
  ];
  if (item.salesExpectation !== undefined) {
    lines.push(`営業期待値スコア: ${item.salesExpectation}点 / 40点（OS①確定値・変動しない）`);
    if (item.salesExpectationReason) lines.push(`スコア根拠: ${item.salesExpectationReason}`);
  }
  lines.push('', `【タッチ履歴（${touches.length}回）】`);
  touches.forEach((t, i) => {
    lines.push('');
    lines.push(`--- タッチ${i + 1} (${t.date.slice(0, 10)}) ---`);
    lines.push(`投稿種別: ${t.targetPostType}`);
    lines.push(`対象妥当性: ${t.targetValidity}`);
    if (t.targetPostText) lines.push(`接触した投稿: ${t.targetPostText}`);
    lines.push(`送った文章: ${t.actualSentText}`);
    if (t.editReason) lines.push(`変えた理由: ${t.editReason}`);
    lines.push(`文面妥当性: ${t.messageValidity}`);
    if (t.judgmentReason) lines.push(`判定理由: ${t.judgmentReason}`);
    if (t.improvementSuggestion && t.improvementSuggestion !== 'なし') lines.push(`改善提案: ${t.improvementSuggestion}`);
    lines.push(`反応: ${reactionDisplay(t.reactionType)}`);
    if (t.reactionNote) lines.push(`反応補足: ${t.reactionNote}`);
    if (t.os2Judgment) lines.push(`OS②判定: ${t.os2Judgment}`);
    if (t.os2NextAction) lines.push(`次アクション: ${t.os2NextAction}`);
    if (t.os2ReplyA) lines.push(`OS②案A: ${t.os2ReplyA}`);
    if (t.os2ReplyB) lines.push(`OS②案B: ${t.os2ReplyB}`);
    if (t.conversationTurns && t.conversationTurns.length > 0) {
      lines.push(`会話スレッド（${t.conversationTurns.length}ターン）:`);
      t.conversationTurns.forEach(ct => {
        const date = ct.timestamp ? ct.timestamp.slice(0, 10) : '';
        lines.push(`  [${ct.role}（${ct.channel}）${date ? ' ' + date : ''}] ${ct.text}`);
      });
    }
  });
  if (item.judgment) {
    lines.push('');
    lines.push(`【最終OS②判定】`);
    lines.push(`判定: ${item.judgment}`);
    if (item.nextAction) lines.push(`次アクション: ${item.nextAction}`);
  }
  return lines.join('\n');
}

export function purgeOldTrash(d: AppData): void {
  if (!d.trash || d.trash.length === 0) return;
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  d.trash = d.trash.filter(x => x._trashedAt > cutoff);
}

export function buildInitialInboundTouch(
  item: { inbound_actions?: string[]; signal_type?: string; signal_date?: string; signal_memo?: string },
  fallbackDate: string
): Touch {
  const ibActionsArr = item.inbound_actions?.length
    ? item.inbound_actions
    : item.signal_type ? [item.signal_type] : []
  const ibActionsStr = ibActionsArr.join('、')
  const memoNote = item.signal_memo?.trim()
    ? `\n\n【受信内容・メモ】\n${item.signal_memo.trim()}`
    : ''
  return {
    id: uid(),
    date: item.signal_date ?? fallbackDate,
    targetPostText: `インバウンド着信（${ibActionsStr}）`,
    targetPostType: 'その他',
    targetValidity: '◯',
    aiSuggestedText: '',
    actualSentText: '',
    editReason: '',
    messageValidity: '未評価',
    status: 'reacted',
    reactionType: '未記録',
    reactionNote: `相手から先に接触あり：${ibActionsStr}${memoNote}`,
    touchMode: ibActionsStr.includes('DM') ? 'conversation' : 'post',
  }
}

export function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isoToDisplay(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
