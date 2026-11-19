/* Shared domain model used by the main process, preload bridge and renderer. */

export type PlatformId = 'x' | 'telegram' | 'facebook' | 'bluesky' | 'mastodon' | string
export type AuthMethod = 'api' | 'session'

export interface ProxyConfig {
  enabled: boolean
  url: string
  username?: string
  password?: string
}

export interface Account {
  id: string
  platform: PlatformId
  method: AuthMethod
  /** User-defined readable label, e.g. "X · EN product". */
  name: string
  /** ISO-ish language tag: EN, RU, ES, DE ... */
  lang: string
  /** Accent colour used for chips and language badges. */
  color: string
  /** Platform specific secrets: token, chatId, host, handle, cookies ... */
  credentials: Record<string, string>
  proxy?: ProxyConfig
  /** Dedicated Electron session partition ("persist:acct_<id>"). */
  partition: string
  createdAt: number
  status: 'unknown' | 'ok' | 'error'
  statusMessage?: string
}

export interface AccountGroup {
  id: string
  name: string
  accountIds: string[]
}

export interface Alias {
  id: string
  token: string
  /** platform -> replacement (@handle, link ...) */
  values: Record<string, string>
}

export interface MediaItem {
  id: string
  name: string
  mime: string
  size: number
  width?: number
  height?: number
  /** Absolute local path of the stored (original) file. */
  path: string
  /** data: URL used for UI thumbnails. */
  thumb: string
  alt?: string
  isVideo: boolean
}

export interface ThreadPost {
  id: string
  text: string
  mediaIds: string[]
}

export interface DraftVariant {
  lang: string
  thread: ThreadPost[]
}

export interface Draft {
  id: string
  mode: 'broadcast' | 'languages'
  /** Single shared text used in broadcast mode. */
  text: string
  variants: DraftVariant[]
  accountIds: string[]
  media: MediaItem[]
  updatedAt: number
}

export type PostStatus = 'pending' | 'sending' | 'sent' | 'error' | 'skipped'

export interface PostResult {
  accountId: string
  lang: string
  status: PostStatus
  error?: string
  url?: string
  remoteId?: string
  /** True when the platform itself holds the schedule. */
  native?: boolean
  at?: number
}

export interface PostRecord {
  id: string
  createdAt: number
  scheduledAt?: number
  /** True when the platform accepted the schedule itself (PC may be off). */
  native: boolean
  accountIds: string[]
  /** Snapshot of what will be published, resolved per account language. */
  variants: Record<string, ThreadPost[]>
  media: MediaItem[]
  results: PostResult[]
  ackMissed?: boolean
}

export interface Settings {
  hotkey: string
  pin: boolean
  hideOnClose: boolean
  jitterMinSec: number
  jitterMaxSec: number
  ai: {
    provider: 'none' | 'ollama' | 'openai'
    baseUrl: string
    model: string
    apiKey: string
    toneAdaptation: boolean
  }
  activeTab: string
}

export interface PluginInfo {
  id: string
  name: string
  version: string
  description?: string
  platform?: string
  enabled: boolean
  source: 'bundled' | 'user'
  dir: string
  error?: string
  capabilities?: Capabilities
}

export interface Capabilities {
  maxChars: number
  media: { maxCount: number; maxBytes: number; mime: string[] }
  threads: boolean
  nativeScheduling: boolean
  /** Optional human hint, e.g. "HTML/Markdown". */
  formatting?: string
}

export interface AppState {
  accounts: Account[]
  groups: AccountGroup[]
  aliases: Alias[]
  drafts: Draft[]
  media: MediaItem[]
  records: PostRecord[]
  settings: Settings
  plugins: PluginInfo[]
}

export interface PublishOutcome {
  url?: string
  remoteId?: string
  nativeScheduling?: boolean
}

export interface PublishInput {
  account: Account
  thread: ThreadPost[]
  media: MediaItem[]
  /** Platform specific processed media, aligned with thread item mediaIds. */
  mediaByPost: MediaAsset[][]
  /** Set when the platform can schedule the post natively. */
  scheduledAt?: number
}

export interface MediaAsset {
  id: string
  buffer: Buffer
  mime: string
  name: string
  alt?: string
}

export interface AdapterContext {
  fetch: typeof fetch
  log: (message: string) => void
}

export interface Adapter {
  id: string
  name: string
  color: string
  capabilities: Capabilities
  /** Fields rendered in the "add account" wizard for API mode. */
  credentialFields?: CredentialField[]
  /** URL opened inside the isolated WebView for session mode. */
  loginUrl?: string
  /** Cookie names proving a successful session login. */
  sessionCookies?: string[]
  authenticate?(credentials: Record<string, string>, ctx: AdapterContext): Promise<{ ok: boolean; message?: string }>
  publish(input: PublishInput, ctx: AdapterContext): Promise<PublishOutcome>
  fetchStats?(account: Account, remoteId: string, ctx: AdapterContext): Promise<{ likes?: number; views?: number; replies?: number }>
  /** Return false when this particular post shape cannot be scheduled natively. */
  supportsNativeScheduling?(thread: ThreadPost[]): boolean
}

export interface CredentialField {
  key: string
  label: string
  placeholder?: string
  secret?: boolean
  required?: boolean
  hint?: string
}

export interface TranslateRequest {
  texts: string[]
  targetLangs: string[]
  platform?: string
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'dev'

export interface UpdateState {
  status: UpdateStatus
  version?: string
  progress?: number
  error?: string
}
