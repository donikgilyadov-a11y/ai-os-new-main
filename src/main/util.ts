import { net, session as electronSession, type Session } from 'electron'
import { randomBytes } from 'node:crypto'

export function newId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function jitterMs(minSec: number, maxSec: number): number {
  const min = Math.max(0, Math.min(minSec, maxSec))
  const max = Math.max(min, Math.max(minSec, maxSec))
  return Math.round((min + Math.random() * (max - min)) * 1000)
}

export function accountSession(partition: string): Session {
  return electronSession.fromPartition(partition)
}

/**
 * fetch() bound to the account's isolated session, so cookies and the
 * per-account proxy configuration are applied automatically.
 */
export function scopedFetch(partition: string): typeof fetch {
  const ses = accountSession(partition)
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    net.fetch(input as never, { ...(init as Record<string, unknown>), session: ses } as never)) as typeof fetch
}

export async function applyProxy(partition: string, proxy?: { enabled: boolean; url: string; username?: string; password?: string }): Promise<void> {
  const ses = accountSession(partition)
  if (!proxy?.enabled || !proxy.url.trim()) {
    await ses.setProxy({ mode: 'direct' })
    return
  }
  await ses.setProxy({ proxyRules: proxy.url.trim() })
}

export async function readJsonResponse(res: Response): Promise<any> {
  const text = await res.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return 'Unknown error'
  }
}

export function truncate(value: string, max = 180): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}
