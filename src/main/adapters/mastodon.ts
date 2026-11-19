import type { Adapter, AdapterContext, MediaAsset, PublishInput, PublishOutcome } from '@shared/types'
import { readJsonResponse } from '../util'

function apiBase(host: string): string {
  const clean = host.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return `https://${clean}`
}

async function uploadMedia(base: string, token: string, asset: MediaAsset, ctx: AdapterContext): Promise<string> {
  const form = new FormData()
  form.set('file', new Blob([asset.buffer], { type: asset.mime }), asset.name)
  form.set('description', asset.alt ?? '')
  const res = await ctx.fetch(`${base}/api/v2/media`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form
  })
  const data = await readJsonResponse(res)
  if (!res.ok) throw new Error(data.error || `Mastodon: не удалось загрузить медиа (${res.status})`)
  return String(data.id)
}

const adapter: Adapter = {
  id: 'mastodon',
  name: 'Mastodon',
  color: '#6364ff',
  capabilities: {
    maxChars: 500,
    media: { maxCount: 4, maxBytes: 16 * 1024 * 1024, mime: ['image/*', 'video/*'] },
    threads: true,
    nativeScheduling: true
  },
  supportsNativeScheduling: (thread) => thread.length === 1,
  credentialFields: [
    { key: 'host', label: 'Instance host', placeholder: 'mastodon.social', required: true },
    { key: 'accessToken', label: 'Access token', placeholder: 'токен приложения', secret: true, required: true, hint: 'Preferences → Development → New application' }
  ],
  loginUrl: 'https://mastodon.social/',
  sessionCookies: ['_mastodon_session'],
  async authenticate(credentials, ctx) {
    try {
      const res = await ctx.fetch(`${apiBase(credentials.host)}/api/v1/accounts/verify_credentials`, {
        headers: { authorization: `Bearer ${credentials.accessToken}` }
      })
      const data = await readJsonResponse(res)
      if (!res.ok) return { ok: false, message: data.error || 'Неверный токен' }
      return { ok: true, message: `@${data.acct}` }
    } catch (error) {
      return { ok: false, message: (error as Error).message }
    }
  },
  async publish(input: PublishInput, ctx: AdapterContext): Promise<PublishOutcome> {
    const { host, accessToken } = input.account.credentials
    if (!host || !accessToken) throw new Error('Не заданы host или access token')
    const base = apiBase(host)
    const nativeSchedule = Boolean(input.scheduledAt) && input.thread.length === 1

    let inReplyTo: string | undefined
    let first: any
    for (let i = 0; i < input.thread.length; i += 1) {
      const post = input.thread[i]
      const mediaIds: string[] = []
      for (const asset of input.mediaByPost[i] ?? []) {
        mediaIds.push(await uploadMedia(base, accessToken, asset, ctx))
      }
      const body: Record<string, unknown> = { status: post.text, visibility: 'public' }
      if (mediaIds.length) body.media_ids = mediaIds
      if (inReplyTo) body.in_reply_to_id = inReplyTo
      if (nativeSchedule) body.scheduled_at = new Date(input.scheduledAt as number).toISOString()

      const res = await ctx.fetch(`${base}/api/v1/statuses`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await readJsonResponse(res)
      if (!res.ok) throw new Error(data.error || `Mastodon: ошибка публикации (${res.status})`)
      if (!first) first = data
      inReplyTo = String(data.id)
    }
    return {
      remoteId: first?.id ? String(first.id) : undefined,
      url: first?.url,
      nativeScheduling: nativeSchedule
    }
  },
  async fetchStats(account, remoteId, ctx) {
    const { host, accessToken } = account.credentials
    const res = await ctx.fetch(`${apiBase(host)}/api/v1/statuses/${remoteId}`, {
      headers: { authorization: `Bearer ${accessToken}` }
    })
    if (!res.ok) return {}
    const data = await readJsonResponse(res)
    return { likes: data.favourites_count ?? 0, replies: data.replies_count ?? 0, views: undefined }
  }
}

export default adapter
