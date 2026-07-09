// ── プラットフォーム・画面種別 ────────────────────────────────

export type ExtPlatform = 'twitter' | 'instagram' | 'threads' | 'youtube'

export type ExtPageType =
  | 'followers'
  | 'following'
  | 'search'
  | 'suggested'
  | 'list'
  | 'hashtag'
  | 'home_timeline'
  | 'notifications'
  | 'profile'
  | 'post'
  | 'quote_rt_list'
  | 'reply_thread'
  | 'other'

// ── 収集コンテキスト ──────────────────────────────────────────

export interface ExtSourceContext {
  platform: ExtPlatform
  pageType: ExtPageType
  url: string
  collectedBy: 'chrome-extension' | 'manual'
  collectedAt: string
}

// ── アカウントカード ──────────────────────────────────────────

export interface ExtAccountCard {
  displayName: string
  handle: string        // @付きで統一
  bio?: string
  profileUrl: string
  verified?: boolean
  followerCount?: string
  channel: ExtPlatform
}

export interface GeminiTouchOutputPayload {
  pipelineItemId: string
  raw: string
}

export interface GeminiPromptMeta {
  pipelineItemId: string
  kind: 'touch'
}

// 将来用（型のみ・MVP未実装）
export interface OS1ProfilePayload {
  sourceContext: ExtSourceContext
  account: ExtAccountCard
  rawProfileText: string
  recentPosts?: string[]
}

export interface OS2TouchPayload {
  sourceContext: ExtSourceContext
  account: ExtAccountCard
  postText: string
  postUrl: string
  postedAt?: string
}

export interface QuoteRTPayload {
  sourceContext: ExtSourceContext
  account: ExtAccountCard
  postText: string
  postUrl: string
  postedAt?: string
}

export interface DMMaterialPayload {
  sourceContext: ExtSourceContext
  account: ExtAccountCard
  conversationSnippet: string
}

export interface PostIdeaPayload {
  sourceContext: ExtSourceContext
  account: ExtAccountCard
  postText: string
  postUrl: string
  postedAt?: string
  engagementStats?: string
}

export interface OwnPostPDCAPayload {
  sourceContext: ExtSourceContext
  postText: string
  postUrl: string
  postedAt?: string
  engagementStats?: string
}

// ── メッセージタイプ ──────────────────────────────────────────

export type ExtMessageType =
  | 'os1_profile'
  | 'os2_touch'
  | 'gemini_touch_output'
  | 'quote_rt'
  | 'dm_material'
  | 'post_idea'
  | 'own_post_pdca'

export type ExtPayload =
  | OS1ProfilePayload
  | OS2TouchPayload
  | QuoteRTPayload
  | DMMaterialPayload
  | PostIdeaPayload
  | OwnPostPDCAPayload

// ── キューアイテム ────────────────────────────────────────────

export type ExtQueueItemStatus = 'pending' | 'completed' | 'dismissed'

export interface ExtQueueItem {
  id: string
  type: ExtMessageType
  status: ExtQueueItemStatus
  payload: ExtPayload
  enqueuedAt: string
  processedAt?: string
}

// ── 型付きビュー ──────────────────────────────────────────────

export type GeminiTouchOutputQueueItem = ExtQueueItem & {
  type: 'gemini_touch_output'
  payload: GeminiTouchOutputPayload
}
