import type { Observation, OpportunityFacts } from '../types'
import { normalizeOpportunityFit, normalizeOpportunityStatus, normalizePrioritySegment } from './opportunityUtils'

export function field(text: string, label: string): string {
  const re = new RegExp(label + '[：:]\\s*([^\\n]+)');
  const m = text.match(re);
  return m ? m[1].trim() : '';
}

export function block(text: string, header: string): string {
  const re = new RegExp('【' + header + '】\\s*([\\s\\S]*?)(?=【|$)');
  const m = text.match(re);
  return m ? m[1].trim() : '';
}

export function firstLineOf(text: string, header: string): string {
  const b = block(text, header);
  return b.split('\n')[0].trim();
}

export function cleanMsg(s: string): string {
  return s ? s.replace(/^[「『]|[」』]$/g, '').trim() : '';
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function resolveSkipJudge(contactJudgeBlock: string, fullText: string): '通過' | 'SKIP' {
  const firstLine = contactJudgeBlock.split('\n')[0].trim();
  const skipReasonVal = field(fullText, 'SKIP理由');
  // SKIP理由に「該当なし/なし」以外の実質的な内容がある → SKIP
  const skipReasonIsReal = !!skipReasonVal
    && skipReasonVal.trim().length > 2
    && !/^(該当なし|なし|無し|接触する|—|-)/.test(skipReasonVal.trim());
  // 先頭行が "SKIP理由：..." ではなく "SKIP" 単体 → 補助的に SKIP 判定
  const firstLineSKIP = /^SKIP\b/.test(firstLine) && !/^SKIP理由/.test(firstLine);
  return (skipReasonIsReal || (firstLineSKIP && !skipReasonVal)) ? 'SKIP' : '通過';
}

function extractObservationList(karteBlock: string): Observation[] {
  const obsPattern = /\[Observation[①②③④⑤⑥⑦⑧⑨⑩\d]+\]([\s\S]*?)(?=\[Observation|\n禁止角度|$)/g
  const results: Observation[] = []
  let match: RegExpExecArray | null
  let idx = 0
  while ((match = obsPattern.exec(karteBlock)) !== null) {
    const obsText = match[1]
    const naturalQ = field(obsText, 'naturalQuestion')
    if (!naturalQ) { idx++; continue }
    const priorityRaw = parseInt(field(obsText, 'priority'), 10)
    results.push({
      id: uid(),
      priority: isNaN(priorityRaw) ? idx + 1 : priorityRaw,
      observation: field(obsText, 'observation'),
      curiosity: field(obsText, 'curiosity'),
      naturalQuestion: naturalQ,
      ifYes: field(obsText, 'ifYes'),
      ifNo: field(obsText, 'ifNo'),
      businessHypothesis: field(obsText, 'businessHypothesis'),
      evidence: [],
    })
    idx++
  }
  return results
}

function extractHypothesisKarte(text: string): {
  primaryHypothesisPattern?: 'A' | 'B' | 'C' | 'D';
  naturalQuestion?: string;
  forbiddenAngles?: string[];
  observations?: Observation[];
} {
  const karteBlock = block(text, '仮説カルテ（アプリ自動取込）')
  if (!karteBlock) return {}
  const patternRaw = field(karteBlock, '最優先パターン').trim()
  const primaryHypothesisPattern = ['A', 'B', 'C', 'D'].includes(patternRaw)
    ? patternRaw as 'A' | 'B' | 'C' | 'D'
    : undefined
  const naturalQuestion = field(karteBlock, 'naturalQuestion') || undefined
  const forbiddenAnglesRaw = field(karteBlock, '禁止角度')
  const forbiddenAngles = forbiddenAnglesRaw
    ? forbiddenAnglesRaw.split('・').map(s => s.trim()).filter(Boolean)
    : undefined
  const observations = extractObservationList(karteBlock)
  return { primaryHypothesisPattern, naturalQuestion, forbiddenAngles, observations: observations.length ? observations : undefined }
}

function extractBreakdownText(expBlock: string): string | undefined {
  const lines = expBlock.split('\n')
  const breakdown = lines
    .filter(l => !/^スコア[：:]/.test(l.trim()) && !/^根拠[：:]/.test(l.trim()))
    .join('\n')
    .trim()
  return breakdown || undefined
}

function extractSalesExp(text: string): { salesExpectation?: number; salesExpectationReason?: string; salesExpectationBreakdown?: string } {
  const candidateBlock = block(text, '営業期待値 確認候補');
  return {
    salesExpectation: undefined,
    salesExpectationReason: undefined,
    salesExpectationBreakdown: candidateBlock || undefined,
  };
}

function parseYesNoUnknown(value: string): boolean | undefined {
  if (!value) return undefined
  if (/YES|有|確認できる|確認済み/.test(value)) return true
  if (/NO|無|なし|確認できない/.test(value)) return false
  return undefined
}

function extractOpportunityAssessment(text: string): {
  opportunityStatus?: ReturnType<typeof normalizeOpportunityStatus>;
  opportunityStatusReason?: string;
  prioritySegment?: ReturnType<typeof normalizePrioritySegment>;
  prioritySegmentReason?: string;
  opportunityFacts?: OpportunityFacts;
  opportunityFit?: ReturnType<typeof normalizeOpportunityFit>;
  opportunityFitReason?: string;
  opportunityBreakdown?: string;
} {
  const statusBlock = block(text, '営業対象判定')
  const segmentBlock = block(text, '優先セグメント')
  const factsBlock = block(text, '観測事実')
  const fitBlock = block(text, '案件適合度')
  const noteBlock = block(text, '判定メモ')
  const facts: OpportunityFacts = {
    usesUtageConfirmed: parseYesNoUnknown(field(factsBlock, 'UTAGE利用が確認できる')),
    sellsProductConfirmed: parseYesNoUnknown(field(factsBlock, '商品販売の実体が確認できる')),
    hasExistingLpOrHpConfirmed: parseYesNoUnknown(field(factsBlock, '既存LP/HPが確認できる')),
    hasLimitedSalesFlowConfirmed: parseYesNoUnknown(field(factsBlock, '販売導線が限定的である')),
    lacksProductInfoConfirmed: parseYesNoUnknown(field(factsBlock, '商品理解に必要な情報不足が確認できる')),
  }
  const hasFacts = Object.values(facts).some(v => v !== undefined)
  return {
    opportunityStatus: normalizeOpportunityStatus(statusBlock.split('\n')[0]?.trim()),
    opportunityStatusReason: field(statusBlock, '理由') || undefined,
    prioritySegment: normalizePrioritySegment(segmentBlock.split('\n')[0]?.trim()),
    prioritySegmentReason: field(segmentBlock, '理由') || undefined,
    opportunityFacts: hasFacts ? facts : undefined,
    opportunityFit: normalizeOpportunityFit(fitBlock.split('\n')[0]?.trim()),
    opportunityFitReason: noteBlock || undefined,
    opportunityBreakdown: factsBlock || undefined,
  }
}

export function parseOS1(text: string) {
  const contactJudgeBlock = block(text, '接触判断');
  const skipJudge = resolveSkipJudge(contactJudgeBlock, text);
  const trackBlock = block(text, '優先度判定');
  const trackFirstLine = trackBlock.split('\n')[0].trim();
  const track = /UT/.test(trackFirstLine) ? 'UT' : trackFirstLine.match(/優先|FT/) ? 'FT' : 'NT';
  const contactBlock = block(text, '初回接触案');
  const dmSplit = contactBlock.includes('▼初回DM案');
  const replyPart = dmSplit ? contactBlock.split('▼初回DM案')[0] : contactBlock;
  const caM = replyPart.match(/案A[（(]実行案[）)][:：][ \t]*([\s\S]+?)(?=\n案B|\n▼|\n【|$)/);
  const cbM = replyPart.match(/案B[（(]予備案[）)][:：][ \t]*([\s\S]+?)(?=\n▼|\n【|$)/);
  const dmPart = dmSplit ? contactBlock.split('▼初回DM案')[1] : '';
  const daM = dmPart.match(/案A[:：][ \t]*([\s\S]+?)(?=\n案B|\n▼|\n【|$)/);
  const dbM = dmPart.match(/案B[:：][ \t]*([\s\S]+?)(?=\n▼|\n【|$)/);
  const dmNote = (!daM && !dbM && dmPart.trim()) ? dmPart.trim().split('\n')[0] : '';
  const username = field(text, 'ユーザーネーム（@〜）') || field(text, 'ユーザーネーム');
  const partnerFlag = firstLineOf(text, '提携候補フラグ') || field(text, '提携候補フラグ');
  const nextAction = block(text, '次にやること').split('\n').filter(l => l.trim()).join(' ').trim();
  const dmRoute = field(text, 'DM開放');
  const caseId = field(text, '案件ID');
  const { salesExpectation, salesExpectationReason, salesExpectationBreakdown } = extractSalesExp(text);
  const opportunityAssessment = extractOpportunityAssessment(text);
  const { primaryHypothesisPattern, naturalQuestion, forbiddenAngles, observations } = extractHypothesisKarte(text);
  return {
    caseId, accountName: field(text, 'アカウント名'), url: username,
    followers: field(text, 'フォロワー数'), industry: field(text, '業種'),
    estimatedProduct: field(text, '推定商品・サービス') || field(text, '推定商品'),
    estimatedPrice: field(text, '推定単価'), skipJudge, skipReason: field(text, 'SKIP理由'),
    track: skipJudge === 'SKIP' ? 'SKIP' : track, trackReason: field(text, '判定理由'),
    partnerFlag, nextAction, dmRoute, startDate: field(text, '接触開始日'),
    hypothesis: block(text, '事前仮説').split('\n').filter(l => l.trim()).join(' ').trim(),
    contactA: caM ? cleanMsg(caM[1]) : '', contactB: cbM ? cleanMsg(cbM[1]) : '',
    dmA: daM ? cleanMsg(daM[1]) : '', dmB: dbM ? cleanMsg(dbM[1]) : '', dmNote,
    channel: 'twitter' as const, salesExpectation, salesExpectationReason, salesExpectationBreakdown,
    ...opportunityAssessment,
    primaryHypothesisPattern, naturalQuestion, forbiddenAngles, observations,
  };
}

export function parseOS1Instagram(text: string) {
  const contactJudgeBlock = block(text, '接触判断');
  const skipJudge = resolveSkipJudge(contactJudgeBlock, text);
  const trackBlock = block(text, '優先度判定');
  const trackFirstLine = trackBlock.split('\n')[0].trim();
  const track = /UT/.test(trackFirstLine) ? 'UT' : trackFirstLine.match(/優先|FT/) ? 'FT' : 'NT';
  const contactBlock = block(text, '初回接触案');
  const commentPart = contactBlock.split(/▼ストーリー返信案/)[0];
  const caM = commentPart.match(/案A[（(]実行案[）)][:：][ \t]*([\s\S]+?)(?=\n案B|\n▼|\n【|$)/);
  const cbM = commentPart.match(/案B[（(]予備案[）)][:：][ \t]*([\s\S]+?)(?=\n▼|\n【|$)/);
  const storyPart = contactBlock.includes('▼ストーリー返信案')
    ? contactBlock.split('▼ストーリー返信案')[1].split(/▼初回DM案/)[0] : '';
  const saM = storyPart.match(/案A[:：][ \t]*([\s\S]+?)(?=\n案B|\n▼|\n【|\n次に|$)/);
  const sbM = storyPart.match(/案B[:：][ \t]*([\s\S]+?)(?=\n▼|\n【|\n次に|$)/);
  const storyNote = (!saM && !sbM && storyPart.trim()) ? storyPart.trim().split('\n')[0] : '';
  const dmPart = contactBlock.includes('▼初回DM案') ? contactBlock.split('▼初回DM案')[1] : '';
  const daM = dmPart.match(/案A[:：][ \t]*([\s\S]+?)(?=\n案B|\n▼|\n【|$)/);
  const dbM = dmPart.match(/案B[:：][ \t]*([\s\S]+?)(?=\n▼|\n【|$)/);
  const dmNote = (!daM && !dbM && dmPart.trim()) ? dmPart.trim().split('\n')[0] : '';
  const username = field(text, 'ユーザーネーム（@〜）') || field(text, 'ユーザーネーム');
  const partnerFlag = firstLineOf(text, '提携候補フラグ') || field(text, '提携候補フラグ');
  const nextAction = block(text, '次にやること').split('\n').filter(l => l.trim()).join(' ').trim();
  const caseId = field(text, '案件ID');
  const { salesExpectation, salesExpectationReason, salesExpectationBreakdown } = extractSalesExp(text);
  const opportunityAssessment = extractOpportunityAssessment(text);
  const { primaryHypothesisPattern, naturalQuestion, forbiddenAngles, observations } = extractHypothesisKarte(text);
  return {
    caseId, accountName: field(text, 'アカウント名'), url: username,
    followers: field(text, 'フォロワー数'), industry: field(text, '業種'),
    estimatedProduct: field(text, '推定商品・サービス') || field(text, '推定商品'),
    estimatedPrice: field(text, '推定単価'), skipJudge, skipReason: field(text, 'SKIP理由'),
    track: skipJudge === 'SKIP' ? 'SKIP' : track, trackReason: field(text, '判定理由'),
    partnerFlag, nextAction, startDate: field(text, '接触開始日'),
    hypothesis: block(text, '事前仮説').split('\n').filter(l => l.trim()).join(' ').trim(),
    contactA: caM ? cleanMsg(caM[1]) : '', contactB: cbM ? cleanMsg(cbM[1]) : '',
    storyA: saM ? cleanMsg(saM[1]) : '', storyB: sbM ? cleanMsg(sbM[1]) : '',
    storyNote, dmA: daM ? cleanMsg(daM[1]) : '', dmB: dbM ? cleanMsg(dbM[1]) : '',
    dmNote, channel: 'instagram' as const, salesExpectation, salesExpectationReason, salesExpectationBreakdown,
    ...opportunityAssessment,
    primaryHypothesisPattern, naturalQuestion, forbiddenAngles, observations,
  };
}

export function parseOS1Threads(text: string) {
  const contactJudgeBlock = block(text, '接触判断');
  const skipJudge = resolveSkipJudge(contactJudgeBlock, text);
  const trackBlock = block(text, '優先度判定');
  const trackFirstLine = trackBlock.split('\n')[0].trim();
  const track = /UT/.test(trackFirstLine) ? 'UT' : trackFirstLine.match(/優先|FT/) ? 'FT' : 'NT';
  const contactBlock = block(text, '初回接触案');
  const dmSplit = contactBlock.includes('▼初回DM案');
  const replyPart = dmSplit ? contactBlock.split('▼初回DM案')[0] : contactBlock;
  const caM = replyPart.match(/案A[（(]実行案[）)][:：][ \t]*([\s\S]+?)(?=\n案B|\n▼|\n【|$)/);
  const cbM = replyPart.match(/案B[（(]予備案[）)][:：][ \t]*([\s\S]+?)(?=\n▼|\n【|$)/);
  const dmPart = dmSplit ? contactBlock.split('▼初回DM案')[1] : '';
  const daM = dmPart.match(/案A[:：][ \t]*([\s\S]+?)(?=\n案B|\n▼|\n【|$)/);
  const dbM = dmPart.match(/案B[:：][ \t]*([\s\S]+?)(?=\n▼|\n【|$)/);
  const dmNote = (!daM && !dbM && dmPart.trim()) ? dmPart.trim().split('\n')[0] : '';
  const username = field(text, 'ユーザーネーム（@〜）') || field(text, 'ユーザーネーム');
  const dmRoute = field(text, '連動IG') || field(text, 'DM導線');
  const partnerFlag = firstLineOf(text, '提携候補フラグ') || field(text, '提携候補フラグ');
  const nextAction = block(text, '次にやること').split('\n').filter(l => l.trim()).join(' ').trim();
  const { salesExpectation, salesExpectationReason, salesExpectationBreakdown } = extractSalesExp(text);
  const opportunityAssessment = extractOpportunityAssessment(text);
  const { primaryHypothesisPattern, naturalQuestion, forbiddenAngles, observations } = extractHypothesisKarte(text);
  return {
    caseId: field(text, '案件ID'),
    accountName: field(text, 'アカウント名') || field(text, 'アカウント名（表示名）'),
    url: username, followers: field(text, 'フォロワー数'), industry: field(text, '業種'),
    estimatedProduct: field(text, '推定商品・サービス') || field(text, '推定商品'),
    estimatedPrice: field(text, '推定単価'), dmRoute, partnerFlag, nextAction,
    startDate: field(text, '接触開始日'), skipJudge, skipReason: field(text, 'SKIP理由'),
    track: skipJudge === 'SKIP' ? 'SKIP' : track, trackReason: field(text, '判定理由'),
    hypothesis: block(text, '事前仮説').split('\n').filter(l => l.trim()).join(' ').trim(),
    contactA: caM ? cleanMsg(caM[1]) : '', contactB: cbM ? cleanMsg(cbM[1]) : '',
    dmA: daM ? cleanMsg(daM[1]) : '', dmB: dbM ? cleanMsg(dbM[1]) : '',
    dmNote, channel: 'threads' as const, salesExpectation, salesExpectationReason, salesExpectationBreakdown,
    ...opportunityAssessment,
    primaryHypothesisPattern, naturalQuestion, forbiddenAngles, observations,
  };
}

export function parseOS0(text: string, channel: string) {
  const detailMap = new Map<string, {displayName: string; handle: string; verdict: string; reason: string}>();
  const sectionMatch = text.match(/▼判定一覧([\s\S]*?)(?=▼OS①送り候補|▼選別サマリ|$)/);
  if (sectionMatch) {
    for (const line of sectionMatch[1].split('\n').map(l => l.trim()).filter(l => l)) {
      const parts = line.split(/[｜|]/);
      const handleIdx = parts.findIndex(p => p.trim().startsWith('@'));
      if (handleIdx < 0) continue;
      const handle = parts[handleIdx].trim();
      const displayName = parts.slice(1, handleIdx).join('|').trim();
      detailMap.set(handle.toLowerCase(), {
        displayName, handle,
        verdict: parts[handleIdx + 1]?.trim() || '', reason: parts[handleIdx + 2]?.trim() || '',
      });
    }
  }
  const candidateMatch = text.match(/▼OS①送り候補[^\n]*\n([\s\S]*?)(?=▼選別サマリ|$)/);
  if (candidateMatch) {
    const passingHandles = candidateMatch[1].split('\n').map(l => l.trim()).filter(l => l.startsWith('@'));
    if (passingHandles.length > 0) {
      return passingHandles.map(raw => {
        const isTeikei = raw.includes('提携');
        const isUT = raw.includes('UT候補');
        const handle = raw.replace(/【[^】]*】/g, '').trim();
        const detail = detailMap.get(handle.toLowerCase()) || { displayName: '', handle, verdict: '', reason: '' };
        const verdict = isTeikei && isUT ? '◯【提携】【UT候補】' : isTeikei ? '◯【提携】' : isUT ? '◯【UT候補】' : '◯';
        return {
          id: uid(), createdAt: new Date().toISOString(), channel,
          displayName: detail.displayName || '', handle,
          verdict, reason: detail.reason || '',
        };
      });
    }
  }
  return [...detailMap.values()].filter(d => d.verdict.startsWith('◯')).map(d => ({
    id: uid(), createdAt: new Date().toISOString(), channel,
    displayName: d.displayName, handle: d.handle,
    verdict: d.verdict, reason: d.reason,
  }));
}

export function parseOS0NG(text: string, channel: string) {
  const ngs: Array<{handle: string; displayName: string; channel: string; reason: string; skipCode: string}> = [];
  const sectionMatch = text.match(/▼判定一覧([\s\S]*?)(?=▼OS①送り候補|▼選別サマリ|$)/);
  if (!sectionMatch) return ngs;
  for (const line of sectionMatch[1].split('\n').map(l => l.trim()).filter(l => l)) {
    const parts = line.split(/[｜|]/);
    const handleIdx = parts.findIndex(p => p.trim().startsWith('@'));
    if (handleIdx < 0) continue;
    const handle = parts[handleIdx].trim();
    const displayName = parts.slice(1, handleIdx).join('|').trim();
    const verdict = parts[handleIdx + 1]?.trim() || '';
    if (verdict.startsWith('◯')) continue;
    const skipCodeMatch = verdict.match(/X(\d)/);
    ngs.push({ handle, displayName, channel, reason: 'OS⓪NG', skipCode: skipCodeMatch ? 'X' + skipCodeMatch[1] : '' });
  }
  return ngs;
}

// ── OS② 状態指示行（[SLEEP]/[ARCHIVE]/[CLOSE]）のパース ──────────
// OS②プロンプトは判定=休眠/保管/クローズ時に必ず対応行を出力する契約。
// これを取り込み、state と recontact_date の手入力（＝転記漏れ→通知漏れ）を排除する。
export interface OS2StateDirective {
  state: 'sleeping' | 'archived' | 'closed';
  trigger: string;           // 休眠契機 / 保管契機 / クローズ契機
  recontactTrigger?: string; // 再接触トリガー（[SLEEP]/[ARCHIVE]のみ）
  recontactDate?: string;    // YYYY-MM-DD。既定：休眠=+30日 / 保管=+180日（CLAUDE.mdの目安の下限）
  logDate?: string;          // 行内の 日付=
  caseId?: string;           // 行内の 案件ID=
}

function pipeField(line: string, key: string): string {
  const m = line.match(new RegExp(key + '=([^|]*)'));
  return m ? m[1].trim() : '';
}

export function parseOS2StateDirective(text: string, now: Date = new Date()): OS2StateDirective | null {
  const findLine = (tag: string): string => {
    const m = text.match(new RegExp('^\\[' + tag + '\\][^\\n]*', 'm'));
    return m ? m[0] : '';
  };
  const addDays = (days: number): string => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const sleepLine = findLine('SLEEP');
  if (sleepLine) {
    return {
      state: 'sleeping',
      trigger: pipeField(sleepLine, '休眠契機'),
      recontactTrigger: pipeField(sleepLine, '再接触トリガー'),
      recontactDate: addDays(30),
      logDate: pipeField(sleepLine, '日付'),
      caseId: pipeField(sleepLine, '案件ID'),
    };
  }
  const archiveLine = findLine('ARCHIVE');
  if (archiveLine) {
    return {
      state: 'archived',
      trigger: pipeField(archiveLine, '保管契機'),
      recontactTrigger: pipeField(archiveLine, '再接触トリガー'),
      recontactDate: addDays(180),
      logDate: pipeField(archiveLine, '日付'),
      caseId: pipeField(archiveLine, '案件ID'),
    };
  }
  const closeLine = findLine('CLOSE');
  if (closeLine) {
    return {
      state: 'closed',
      trigger: pipeField(closeLine, 'クローズ契機'),
      logDate: pipeField(closeLine, '日付'),
      caseId: pipeField(closeLine, '案件ID'),
    };
  }
  return null;
}

export function parseOS2(text: string) {
  const replyBlock = block(text, '次の返信案');
  const raM = replyBlock.match(/案A[（(]前進案[）)]：([^\n]+)/);
  const rbM = replyBlock.match(/案B[（(]安全案[）)]：([^\n]+)/);
  return {
    step: firstLineOf(text, '現在ステップ'),
    redSignal: firstLineOf(text, '赤信号'),
    responseQuality: firstLineOf(text, '相手反応の質'),
    hypothesisCheck: firstLineOf(text, '事前仮説との照合'),
    judgment: firstLineOf(text, '判定'),
    nextAction: firstLineOf(text, '次アクション'),
    deadline: firstLineOf(text, '実行期限'),
    replyA: raM ? cleanMsg(raM[1]) : cleanMsg(block(text, '次の返信案').split('\n')[0]),
    replyB: rbM ? cleanMsg(rbM[1]) : '',
    ngAction: firstLineOf(text, '今やってはいけないこと'),
    // 判定=休眠/保管/クローズ時の状態指示（該当なしは null）。
    // Tab2側で state / recontact_date への反映に使用する（確認ダイアログ経由を推奨）。
    stateDirective: parseOS2StateDirective(text),
  };
}

export function parseOS3(text: string) {
  const typeBlock = block(text, 'クローズタイプ');
  const typeM = typeBlock.match(/(W-[A-D]|Type[A-K]|TypeI)/);
  const isTypeF = typeM?.[1] === 'TypeF';
  const hypoBlock = block(text, '事前仮説の答え合わせ');
  const hypoM = hypoBlock.match(/(的中|部分的中|外れ|検証不能)/);
  const timingBlock = block(text, 'タイミング検証');
  const timingM = timingBlock.match(/ベストタイミングは[：:]\s*(前|同じ|後)/);
  const perspBlock = block(text, '相手視点分析');
  // Bug fix: extract learningValue from 【個別結論】, NOT from 【事前仮説の答え合わせ】
  const conclusionBlock = block(text, '個別結論');
  const lvM = conclusionBlock.match(/学習価値[：:]\s*(\d+)/);
  const reapBlock = block(text, '再アプローチ判定');
  const reapM = reapBlock.match(/可能性[：:]\s*([SABCD])/);
  return {
    closeType: typeM ? typeM[1] : 'TypeI',
    closeTypeReason: field(typeBlock, '分類理由') || typeBlock.split('\n').slice(1).join(' ').trim(),
    hypothesisResult: hypoM ? hypoM[1] : '',
    hypothesisExplanation: field(hypoBlock, '解説') || hypoBlock.split('\n').slice(1).join(' ').trim(),
    bestTiming: timingM ? timingM[1] : '',
    roleStart: field(perspBlock, '最初の役割認識'),
    roleEnd: field(perspBlock, '最後の役割認識'),
    roleChange: field(perspBlock, '変化した地点'),
    wanted: isTypeF ? '何もなし' : field(perspBlock, '相手が欲しかったもの'),
    reapproachRating: isTypeF ? 'D' : (reapM ? reapM[1] : ''),
    reapproachWait: isTypeF ? '再接触しない' : field(reapBlock, '推奨待機期間'),
    reapproachHow: isTypeF ? '再接触しない' : field(reapBlock, '再接触の入り方'),
    conclusionReason: field(conclusionBlock, '失注.受注理由') || field(conclusionBlock, '失注/受注理由'),
    maxLearning: field(conclusionBlock, '最大の学び'),
    nextTypeAction: field(conclusionBlock, '次回同タイプへの最適行動'),
    learningValue: lvM ? parseInt(lvM[1]) : null,
  };
}
