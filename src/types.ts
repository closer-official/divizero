export type Channel = 'twitter' | 'instagram' | 'threads';
export type Track = 'FT' | 'NT' | 'SKIP';
export type Step = 'S1' | 'S2' | 'S3' | 'S4' | 'S5';

export interface Screening {
  id: string;
  createdAt: string;
  channel: Channel;
  displayName: string;
  handle: string;
  verdict: string;
  reason: string;
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
  isOpen: boolean;
  closedAt?: string | null;
  closedCaseId?: string | null;
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

export interface AppData {
  screenings: Screening[];
  targets: Target[];
  pipeline: PipelineItem[];
  closed: ClosedDeal[];
  excluded: ExcludedAccount[];
  trash: TrashItem[];
  logs?: LogEntry[];
}

export type Prompts = {
  OS0?: string;
  OS1_X?: string;
  OS1_IG?: string;
  OS1_TH?: string;
  OS2?: string;
  OS3?: string;
  IG_OCR?: string;
};
