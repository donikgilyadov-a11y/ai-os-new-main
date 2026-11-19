import type { Account, AppState, MediaItem, PostRecord, PostResult, ThreadPost } from '@shared/types'
import { registry } from './adapters'
import { prepareThreadMedia } from './media'
import { errorMessage, jitterMs, newId, scopedFetch, sleep } from './util'

type Emit = (event: 'records' | 'notice', payload: unknown) => void

export class Publisher {
  private timer: NodeJS.Timeout | undefined
  private running = false
  private readonly activeRecords = new Set<string>()
  private readonly notifiedMissed = new Set<string>()
  private getState: () => AppState
  private save: () => void
  private emit: Emit
  private log: (message: string) => void

  constructor(getState: () => AppState, save: () => void, emit: Emit, log: (message: string) => void) {
    this.getState = getState
    this.save = save
    this.emit = emit
    this.log = log
  }

  start(): void {
    this.recoverInterrupted()
    this.checkMissed()
    this.timer = setInterval(() => void this.tick(), 10_000)
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  private checkMissed(): void {
    const missed = this.missedRecords().filter((record) => !this.notifiedMissed.has(record.id))
    if (missed.length) {
      for (const record of missed) this.notifiedMissed.add(record.id)
      this.emit('notice', {
        kind: 'missed',
        message: `Пропущено запланированных публикаций: ${missed.length}`,
        records: missed.map((r) => ({ id: r.id, scheduledAt: r.scheduledAt }))
      })
    }
  }

  missedRecords(): { id: string; scheduledAt?: number }[] {
    const now = Date.now()
    return this.getState().records
      .filter(
        (record) =>
          !record.ackMissed &&
          record.scheduledAt &&
          record.scheduledAt < now - 60_000 &&
          record.results.some((result) => result.status === 'pending')
      )
      .map((record) => ({ id: record.id, scheduledAt: record.scheduledAt }))
  }

  async tick(): Promise<void> {
    if (this.running) return
    const now = Date.now()
    this.checkMissed()
    const due = this.getState().records.filter(
      (r) =>
        r.scheduledAt &&
        r.scheduledAt <= now &&
        (r.ackMissed || r.scheduledAt >= now - 60_000) &&
        r.results.some((x) => x.status === 'pending')
    )
    if (!due.length) return
    this.running = true
    try {
      for (const record of due) {
        await this.publishRecord(record)
      }
    } finally {
      this.running = false
    }
  }

  private recoverInterrupted(): void {
    let recovered = false
    for (const record of this.getState().records) {
      for (const result of record.results) {
        if (result.status !== 'sending') continue
        result.status = 'error'
        result.error = 'Приложение было закрыто во время отправки. Проверьте публикацию на платформе перед повтором.'
        result.at = Date.now()
        recovered = true
      }
    }
    if (recovered) {
      this.save()
      this.emit('records', this.getState().records)
    }
  }

  async createRecord(input: {
    variants: Record<string, ThreadPost[]>
    accountIds: string[]
    media: MediaItem[]
    scheduledAt?: number
  }): Promise<PostRecord> {
    const accounts = this.getState().accounts.filter((a) => input.accountIds.includes(a.id))
    const results: PostResult[] = accounts.map((account) => ({
      accountId: account.id,
      lang: account.lang,
      status: 'pending'
    }))
    const record: PostRecord = {
      id: newId('post'),
      createdAt: Date.now(),
      scheduledAt: input.scheduledAt,
      native: false,
      accountIds: accounts.map((a) => a.id),
      variants: input.variants,
      media: input.media,
      results
    }
    this.getState().records.unshift(record)
    this.getState().records = this.getState().records.slice(0, 300)
    this.save()
    this.emit('records', this.getState().records)
    return record
  }

  async publishNow(record: PostRecord): Promise<PostRecord> {
    if (this.activeRecords.has(record.id)) throw new Error('Публикация этого задания уже выполняется')
    await this.publishRecord(record)
    return record
  }

  /**
   * Platforms that own their schedule (Mastodon, Facebook) must be handed the
   * future timestamp immediately, otherwise the local scheduler would pass an
   * already-elapsed time to their API. Other accounts stay `pending` for tick().
   */
  async publishNative(record: PostRecord): Promise<PostRecord> {
    if (!record.scheduledAt || record.scheduledAt <= Date.now()) return record
    const state = this.getState()
    const native = record.results.filter((result) => {
      if (result.status !== 'pending') return false
      const account = state.accounts.find((a) => a.id === result.accountId)
      if (!account) return false
      const adapter = registry.get(account.platform)
      if (!adapter?.capabilities.nativeScheduling) return false
      const thread = this.resolveThread(record, account)
      return adapter.supportsNativeScheduling?.(thread) ?? true
    })
    if (native.length) await this.publishRecord(record, native)
    return record
  }

  async retryFailed(recordId: string): Promise<PostRecord | undefined> {
    const record = this.getState().records.find((r) => r.id === recordId)
    if (!record) return undefined
    if (this.activeRecords.has(recordId)) throw new Error('Публикация этого задания ещё выполняется')
    const failedAccounts = new Set(record.results.filter((r) => r.status === 'error').map((r) => r.accountId))
    record.results = record.results.map((r) => (r.status === 'error' ? { ...r, status: 'pending', error: undefined } : r))
    this.save()
    await this.publishRecord(record, record.results.filter((r) => failedAccounts.has(r.accountId)))
    return record
  }

  isPublishing(recordId: string): boolean {
    return this.activeRecords.has(recordId)
  }

  /** Publish only results that are still pending. */
  private async publishRecord(record: PostRecord, only?: PostResult[]): Promise<void> {
    if (this.activeRecords.has(record.id)) return
    const state = this.getState()
    const queue = (only ?? record.results).filter((r) => r.status === 'pending')
    if (!queue.length) return

    this.activeRecords.add(record.id)
    try {
    const touchedPlatforms = new Map<string, number>()
    for (const result of queue) {
      const account = state.accounts.find((a) => a.id === result.accountId)
      if (!account) {
        result.status = 'error'
        result.error = 'Аккаунт удалён'
        continue
      }
      const adapter = registry.get(account.platform)
      if (!adapter) {
        result.status = 'error'
        result.error = 'Плагин платформы не найден'
        continue
      }

      const already = touchedPlatforms.get(account.platform)
      if (already) {
        const pause = jitterMs(state.settings.jitterMinSec, state.settings.jitterMaxSec)
        this.log(`jitter ${Math.round(pause / 1000)}s before ${account.platform}/${account.name}`)
        await sleep(pause)
      }
      touchedPlatforms.set(account.platform, Date.now())

      result.status = 'sending'
      this.save()
      this.emit('records', state.records)

      try {
        const thread = this.resolveThread(record, account)
        if (!thread.length || !thread.some((p) => p.text.trim() || p.mediaIds?.length)) {
          throw new Error('Нет текста для этого языка')
        }
        const prepared = thread.map((post) => {
          const media = (post.mediaIds ?? [])
            .map((id) => record.media.find((m) => m.id === id) ?? state.media.find((m) => m.id === id))
            .filter((m): m is MediaItem => Boolean(m))
          return prepareThreadMedia(media, adapter.capabilities)
        })
        const usableThread = thread.map((post) => ({
          id: post.id,
          text: applyAliases(post.text, account, state.aliases),
          mediaIds: post.mediaIds ?? []
        }))
        const outcome = await adapter.publish(
          {
            account,
            thread: usableThread,
            media: record.media,
            mediaByPost: prepared,
            scheduledAt: record.scheduledAt && record.scheduledAt > Date.now() ? record.scheduledAt : undefined
          },
          {
            fetch: scopedFetch(account.partition),
            log: (message: string) => this.log(`[${account.platform}] ${message}`)
          }
        )
        result.status = 'sent'
        result.url = outcome.url
        result.remoteId = outcome.remoteId
        result.native = Boolean(outcome.nativeScheduling)
        result.at = Date.now()
        if (result.native) record.native = true
      } catch (error) {
        result.status = 'error'
        result.error = errorMessage(error)
        result.at = Date.now()
        this.log(`[${account.platform}] publish failed: ${result.error}`)
      }
      this.save()
      this.emit('records', state.records)
    }
    this.save()
    this.emit('records', state.records)
    } finally {
      this.activeRecords.delete(record.id)
    }
  }

  private resolveThread(record: PostRecord, account: Account): ThreadPost[] {
    const variants = record.variants
    return (
      variants[account.lang] ??
      variants[account.lang.toUpperCase()] ??
      Object.values(variants)[0] ??
      []
    )
  }
}

export function applyAliases(text: string, account: Account, aliases: AppState['aliases']): string {
  let out = text
  for (const alias of aliases) {
    const value = alias.values[account.platform]
    if (value) out = out.split(`{${alias.token}}`).join(value)
  }
  return out
}

