import type { Adapter, AdapterContext, MediaAsset, PublishInput, PublishOutcome } from '@shared/types'
import { readJsonResponse } from '../util'

const API = 'https://api.x.com'
/** Public web bearer token used by the x.com web client. */
const WEB_BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

function splitThread(text: string, limit = 275): string[] {
  if (text.length <= limit) return [text]
  const parts: string[] = []
  let rest = text
  while (rest.length > limit) {
    let cut = rest.lastIndexOf(' ', limit)
    if (cut < limit * 0.5) cut = limit
    parts.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) parts.push(rest)
  return parts
}

async function uploadMedia(accessToken: string, asset: MediaAsset, ctx: AdapterContext): Promise<string> {
  const form = new FormData()
  form.set('media', new Blob([asset.buffer], { type: asset.mime }), asset.name)
  form.set('media_category', asset.mime.startsWith('video/') ? 'tweet_video' : 'tweet_image')
  const res = await ctx.fetch(`${API}/2/media/upload`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: form
  })
  const data = await readJsonResponse(res)
  if (!res.ok) throw new Error(data.detail || data.title || 'X: не удалось загрузить медиа')
  return String(data.data?.id ?? data.media_id_string ?? '')
}

function logMediaWarning(ctx: AdapterContext): void {
  ctx.log('session-режим X: медиа не отправляется (используйте API-метод)')
}

function parseCookies(serialized: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of serialized.split(';')) {
    const index = pair.indexOf('=')
    if (index > 0) out[pair.slice(0, index).trim()] = pair.slice(index + 1).trim()
  }
  return out
}

async function publishViaSession(input: PublishInput, ctx: AdapterContext): Promise<PublishOutcome> {
  const cookies = parseCookies(input.account.credentials.cookies ?? '')
  const ct0 = cookies.ct0
  const authToken = cookies.auth_token
  if (!ct0 || !authToken) throw new Error('Нет активной сессии X. Переавторизуйтесь через WebView.')
  if (input.media.length) {
    logMediaWarning(ctx)
  }
  let replyTo: string | undefined
  let firstId: string | undefined
  for (const post of input.thread) {
    const body = new URLSearchParams({ status: post.text })
    if (replyTo) body.set('in_reply_to_status_id', replyTo)
    const res = await ctx.fetch('https://x.com/i/api/1.1/statuses/update.json', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${WEB_BEARER}`,
        'x-csrf-token': ct0,
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `auth_token=${authToken}; ct0=${ct0}`
      },
      body: body.toString()
    })
    const data = await readJsonResponse(res)
    if (!res.ok) throw new Error(data.errors?.[0]?.message || `X session: ошибка ${res.status}`)
    const id = String(data.id_str ?? data.id ?? '')
    if (!firstId) firstId = id
    replyTo = id
  }
  const handle = input.account.credentials.handle ?? 'i'
  return {
    remoteId: firstId,
    url: firstId ? `https://x.com/${handle}/status/${firstId}` : undefined
  }
}

const adapter: Adapter = {
  id: 'x',
  name: 'X (Twitter)',
  color: '#e7e9ea',
  capabilities: {
    maxChars: 280,
    media: { maxCount: 4, maxBytes: 5 * 1024 * 1024, mime: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4'] },
    threads: true,
    nativeScheduling: false
  },
  credentialFields: [
    { key: 'accessToken', label: 'OAuth 2.0 user token', placeholder: 'доступ с правом tweet.write', secret: true, required: true },
    { key: 'handle', label: 'Handle', placeholder: 'your_handle', hint: 'Для ссылок на посты' }
  ],
  loginUrl: 'https://x.com/home',
  sessionCookies: ['auth_token', 'ct0'],
  async authenticate(credentials, ctx) {
    try {
      if (!credentials.accessToken) return { ok: false, message: 'Нужен user access token' }
      const res = await ctx.fetch(`${API}/2/users/me`, { headers: { authorization: `Bearer ${credentials.accessToken}` } })
      const data = await readJsonResponse(res)
      if (!res.ok) return { ok: false, message: data.detail || data.title || 'Неверный токен' }
      return { ok: true, message: `@${data.data?.username ?? ''}` }
    } catch (error) {
      return { ok: false, message: (error as Error).message }
    }
  },
  async publish(input: PublishInput, ctx: AdapterContext): Promise<PublishOutcome> {
    if (input.account.method === 'session') return publishViaSession(input, ctx)
    const token = input.account.credentials.accessToken
    if (!token) throw new Error('Не задан access token X')

    const expanded: { text: string; media: MediaAsset[] }[] = []
    input.thread.forEach((post, index) => {
      const chunks = splitThread(post.text)
      chunks.forEach((chunk, chunkIndex) => {
        expanded.push({ text: chunk, media: chunkIndex === 0 ? input.mediaByPost[index] ?? [] : [] })
      })
    })

    let replyTo: string | undefined
    let firstId: string | undefined
    for (const item of expanded) {
      const mediaIds: string[] = []
      for (const asset of item.media.slice(0, 4)) {
        mediaIds.push(await uploadMedia(token, asset, ctx))
      }
      const body: Record<string, unknown> = { text: item.text }
      if (mediaIds.length) body.media = { media_ids: mediaIds }
      if (replyTo) body.reply = { in_reply_to_tweet_id: replyTo }
      const res = await ctx.fetch(`${API}/2/tweets`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await readJsonResponse(res)
      if (!res.ok) throw new Error(data.detail || data.title || `X: ошибка публикации (${res.status})`)
      const id = String(data.data?.id ?? '')
      if (!firstId) firstId = id
      replyTo = id
    }
    const handle = input.account.credentials.handle || 'i'
    return { remoteId: firstId, url: firstId ? `https://x.com/${handle}/status/${firstId}` : undefined }
  }
}

export default adapter
