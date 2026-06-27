export type Channel = 'twitter' | 'instagram' | 'threads' | 'dm';
export type Track = 'FT' | 'NT' | 'UT' | 'SKIP';
export type Step = 'S1' | 'S2' | 'S3' | 'S4' | 'S5';

export type TouchPostType = '課題ツイート' | '通常投稿' | '達成・嬉しい報告' | '愚痴・本音' | 'ネタ' | 'ストーリー' | 'その他';
export type TouchValidity = '◯' | '△' | '✕' | '未評価' | '未判定';
export type TouchReaction = 'テキスト返信' | 'いいね返り' | 'フォロー返し' | 'スタンプ・絵文字' | '無反応' | '公開拒絶（R5）' | '未記録';

export interface ConversationTurn {
  id: string;
  role: '自分' | '相手';
  text: string;
  timestamp: string;
  channel: 'リプ' | 'DM';
  sentStatus: 'draft' | 'sent' | 'skipped';
  sentAt?: string;
  editReason?: string;
  // DM文生成OS結果（自分ターンのみ）
  dmConversationState?: string;  // '質問あり' | 'クローズ型' | '深掘り余地あり'
  dmSuggestedA?: string;
  dmSuggestedB?: string;
  dmNextAim?: string;
  dmOs2Recommended?: boolean;
  dmRawOutput?: string;
  // OS²チェックポイント結果（自分ターンのみ・踏んだ場合のみ）
  os2Judgment?: string;
  os2NextAction?: string;
  os2Warning?: string;
  os2RawOutput?: string;
  // DM文面判定結果（自分ターンのみ）
  dmMsgJudgment?: string;          // ◯ / △ / ✕
  dmMsgJudgmentReason?: string;
  dmMsgImprovementSuggestion?: string;
  dmMsgImprovedText?: string;
}

export interface SubJudgment {
  modelName: string;
  judgment: TouchValidity;
  judgmentReason: string;
  improvementSuggestion: string;
  improvedText: string;
  judgedAt: string;
}

export interface Touch {
  id: string;
  postId?: string;
  date: string;
  targetPostText: string;
  targetPostRawText?: string;
  targetPostType: TouchPostType;
  targetValidity: TouchValidity;
  aiSuggestedText: string;
  actualSentText: string;
  editReason: string;
  messageValidity: TouchValidity;
  status?: 'awaiting_reaction' | 'reacted';
  reactionType: TouchReaction | TouchReaction[];
  reactionNote: string;
  reactionJudgment?: string;
  reactionNextStep?: string;
  reactionWarning?: string;
  reactionReplyA?: string;
  reactionReplyB?: string;
  reactionDmScore?: string;
  os2ConversationLog?: string;
  os2Judgment?: string;
  os2NextAction?: string;
  os2ReplyA?: string;
  os2ReplyB?: string;
  judgmentReason?: string;
  editEvaluation?: string;
  editComment?: string;
  improvementSuggestion?: string;
  improvedText?: string;
  touchMode?: 'post' | 'conversation';
  threadEntry?: 's1l_promotion' | 's3_direct' | 'log_restore' | 's1_story_reply';
  judgedAt?: string;
  threadStatus?: 'inactive' | 'active' | 'closed';
  conversationTurns?: ConversationTurn[];
  repExchangeCount?: number;
  dmExchangeCount?: number;
  mainJudgmentModel?: string;
  subJudgments?: SubJudgment[];
}

export interface Screening {
  id: string;
  createdAt: string;
  channel: Channel;
  displayName: string;
  handle: string;
  verdict: string;
  reason: string;
  is_inbound?: boolean;
  signal_type?: 'いいね' | 'フォロー' | 'ストーリー反応' | '突然DM' | 'リプ';
  signal_date?: string;
  signal_memo?: string;
  inbound_actions?: string[];
  rawProfileText?: string;
  os1QueuedAt?: string;
}

export interface Target {
  id: string;
  createdAt: string;
  accountName: string;
  url: string;
  channel: Channel;
  track: Track;
  skipJudge: string;
  skipReason: string;
  followers: string;
  industry: string;
  estimatedProduct: string;
  estimatedPrice: string;
  hypothesis: string;
  contactA: string;
  contactB: string;
  storyA?: string;
  storyB?: string;
  storyNote?: string;
  dmA?: string;
  dmB?: string;
  dmNote?: string;
  dmRoute?: string;
  partnerFlag?: string;
  nextAction?: string;
  startDate?: string;
  caseId?: string;
  trackReason?: string;
  pipelineId?: string | null;
  rawInput?: string;
  aiOutput?: string;
  salesExpectation?: number;
  salesExpectationReason?: string;
}

export interface SentMessage {
  id: string;
  label: string;
  original: string;
  actual: string;
  edited: boolean;
  reason: string;
  date: string;
}

export interface Reply {
  id: string;
  sentMsgId: string | null;
  text: string;
  reaction: string;
  date: string;
}

export interface HistoryEntry {
  date: string;
  reaction: string;
  step: Step;
  repCount: number;
  dmCount: number;
  targetPost?: string;
  sentMsgLabel?: string;
  judgment?: string;
  nextAction?: string;
  deadline?: string;
  redSignal?: string;
  responseQuality?: string;
  hypothesisCheck?: string;
  ngAction?: string;
  replyA?: string;
  replyB?: string;
}

export interface PipelineItem {
  id: string;
  targetId?: string;
  caseId?: string | null;
  os1Output?: string | null;
  accountName: string;
  url: string;
  channel: Channel;
  track: Track;
  hypothesis?: string;
  startDate?: string;
  currentStep: Step;
  stepHistory: Array<{step: Step; date: string}>;
  repCount: number;
  dmCount: number;
  lastContactDate?: string;
  redSignal?: string | null;
  responseQuality?: string | null;
  hypothesisVerification?: string | null;
  judgment?: string | null;
  nextAction?: string | null;
  deadline?: string | null;
  replyA?: string | null;
  replyB?: string | null;
  ngAction?: string | null;
  analyses: Array<{date: string; aiInput: string; aiOutput: string; judgment: string}>;
  history: HistoryEntry[];
  sentMessages: SentMessage[];
  replies: Reply[];
  touches?: Touch[];
  likeReturnStreak?: number;
  noReactionStreak?: number;
  isOpen: boolean;
  closedAt?: string | null;
  closedCaseId?: string | null;
  // S∞ループ構造フィールド
  state?: 'active' | 'waiting' | 'sleeping' | 'archived' | 'closed';
  recontact_date?: string;
  temperature?: number;
  last_reaction?: 'none' | 'heart' | 'temp20' | 'temp50' | 'temp80' | 'negative';
  last_reaction_at?: string;
  inbound_signal?: { type: string; date: string; memo?: string };
  isInbound?: boolean;
  inboundActions?: string[];
  salesExpectation?: number;        // 0-40, set at OS1, does not change
  salesExpectationReason?: string;  // なぜこのスコアか（OS1判定時に記録、後から参照用）
  todayTask?: { action: string; addedAt: string };  // 行動判定で「0日後・今日」と出た場合にセット
}

export interface ClosedDeal {
  id: string;
  pipelineId?: string | null;
  createdAt: string;
  accountName: string;
  track: Track;
  hypothesis?: string;
  startDate?: string;
  closeDate?: string;
  result: string;
  ruleFired?: boolean;
  aiOutput?: string;
  rawOutput?: string;
  closeType?: string;
  closeTypeReason?: string;
  hypothesisResult?: string;
  hypothesisExplanation?: string;
  bestTiming?: string;
  roleStart?: string;
  roleEnd?: string;
  roleChange?: string;
  wanted?: string;
  reapproachRating?: string;
  reapproachWait?: string;
  reapproachHow?: string;
  conclusionReason?: string;
  maxLearning?: string;
  nextTypeAction?: string;
  learningValue?: number | null;
}

export interface ExcludedAccount {
  id: string;
  handle: string;
  displayName: string;
  channel: Channel;
  reason: string;
  skipCode?: string;
  addedAt: string;
}

export interface TrashItem {
  _trashId: string;
  _trashSource: string;
  _trashedAt: number;
  [key: string]: unknown;
}

export interface LogEntry {
  id: string;
  accountName: string;
  handle: string;
  sentText: string;
  aiGeneratedText: string;
  editReason: string;
  sentAt: number;
  channel: 'Instagram' | 'X' | 'Threads';
  targetPostText: string;
  targetPostType: '課題ツイート' | '通常投稿' | '達成・嬉しい報告' | '愚痴・本音' | 'ネタ' | '';
  targetValidity: '◯' | '△' | '✕' | '未評価';
  messageValidity: '◯' | '△' | '✕' | '未評価';
}

export interface Analysis {
  id: string;
  type: 'case_pattern' | 'touch_trend' | 'emergency_alert' | 'os_accuracy_alert';
  triggeredAt: string;
  status: 'pending' | 'prompted' | 'completed';
  promptedAt?: string;
  completedAt?: string;
  targetCount: number;
  topLossType?: string;
  winRate?: string;
  patternSummary?: string;
  lastActionImprovement?: string;
  highValuePattern?: string;
  actionItem?: string;
  nextFocusPoint?: string;
  targetValiditySummary?: string;
  messageValiditySummary?: string;
  editEvalSummary?: string;
  topImprovementPattern?: string;
  frequentNgPostType?: string;
  trendComment?: string;
  alertDetail?: string;
  rawOutput?: string;
  // OS精度検証フィールド
  falsePositiveRate?: string;
  falseNegativeRate?: string;
  osAccuracyVerdict?: string;
}

export interface OtherAnalysisResult {
  typeName: string;
  persona: string;
  emotionHook: string;
  structure: string;
  transferable: string;
  rawOutput: string;
  analyzedAt: string;
}

export interface PostStock {
  id: string;
  createdAt: string;
  sourceType: 'os2_touch' | 'manual';
  accountName: string;
  channel: Channel;
  postText: string;
  postRawText?: string;
  postDateTime?: string;
  engagementStats?: string;
  status: 'unanalyzed' | 'analyzed';
  otherAnalysis?: OtherAnalysisResult;
}

export interface OwnPostAnalysis {
  id: string;
  createdAt: string;
  postText: string;
  engagementStats: string;
  evaluation: string;
  goodPoints: string;
  badPoints: string;
  readerReason: string;
  improvementPoint: string;
  rawOutput: string;
}

export interface AppData {
  screenings: Screening[];
  targets: Target[];
  pipeline: PipelineItem[];
  closed: ClosedDeal[];
  excluded: ExcludedAccount[];
  trash: TrashItem[];
  logs?: LogEntry[];
  analyses?: Analysis[];
  postStocks?: PostStock[];
  ownPostAnalyses?: OwnPostAnalysis[];
  myProfile?: string;
}

export type Prompts = {
  OS0?: string;
  OS0_X?: string;
  OS0_IG?: string;
  OS0_TH?: string;
  OS1_X?: string;
  OS1_IG?: string;
  OS1_TH?: string;
  OS2?: string;
  OS3?: string;
  IG_OCR?: string;
  PHENOMENON_FUTURE?: string;
  LOG_OCR?: string;
  S1_ACTION?: string;
  S1_ACTION_BATCH?: string;
  DM_JUDGE?: string;
  OS4_OTHER_ANALYSIS?: string;
  OS4_OWN_ANALYSIS?: string;
  OS4_POST_GEN?: string;
};
