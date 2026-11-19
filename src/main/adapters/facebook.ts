import type { Adapter, AdapterContext, MediaAsset, PublishInput, PublishOutcome } from '@shared/types'
import { readJsonResponse } from '../util'

const GRAPH = 'https://graph.facebook.com/v21.0'

async function uploadPhoto(pageId: string, token: string, asset: MediaAsset, published: boolean, ctx: AdapterContext): Promise<string> {
  const form = new FormData()
  form.set('source', new Blob([asset.buffer], { type: asset.mime }), asset.name)
  form.set('published', String(published))
  form.set('access_token', token)
  const res = await ctx.fetch(`${GRAPH}/${pageId}/photos`, { method: 'POST', body: form })
  const data = await readJsonResponse(res)
  if (!res.ok) throw new Error(data.error?.message || 'Facebook: не удалось загрузить изображение')
  return published ? String(data.post_id ?? data.id) : String(data.id)
}

const adapter: Adapter = {
  id: 'facebook',
  name: 'Facebook',
  color: '#1877f2',
  capabilities: {
    maxChars: 63206,
    media: { maxCount: 10, maxBytes: 10 * 1024 * 1024, mime: ['image/jpeg', 'image/png', 'image/webp'] },
    threads: false,
    nativeScheduling: true
  },
  credentialFields: [
    { key: 'pageId', label: 'Page ID', placeholder: '123456789012345', required: true },
    { key: 'pageAccessToken', label: 'Page access token', placeholder: 'EAAB…', secret: true, required: true, hint: 'Graph API Explorer → Page token' }
  ],
  loginUrl: 'https://www.facebook.com/',
  sessionCookies: ['c_user', 'xs'],
  async authenticate(credentials, ctx) {
    try {
      const res = await ctx.fetch(`${GRAPH}/${credentials.pageId}?fields=name&access_token=${encodeURIComponent(credentials.pageAccessToken)}`)
      const data = await readJsonResponse(res)
      if (!res.ok) return { ok: false, message: data.error?.message || 'Неверный токен страницы' }
      return { ok: true, message: data.name }
    } catch (error) {
      return { ok: false, message: (error as Error).message }
    }
  },
  async publish(input: PublishInput, ctx: AdapterContext): Promise<PublishOutcome> {
    const { pageId, pageAccessToken } = input.account.credentials
    if (!pageId || !pageAccessToken) throw new Error('Не заданы Page ID или page access token')
    if (input.thread.length > 1) {
      throw new Error('Facebook: ветки не поддерживаются, отправьте один пост')
    }
    const post = input.thread[0]
    const media = input.mediaByPost[0] ?? []
    const nativeSchedule = Boolean(input.scheduledAt)

    if (media.length === 1) {
      const form = new FormData()
      form.set('source', new Blob([media[0].buffer], { type: media[0].mime }), media[0].name)
      form.set('caption', post.text)
      form.set('access_token', pageAccessToken)
      if (input.scheduledAt) {
        form.set('published', 'false')
        form.set('scheduled_publish_time', String(Math.floor(input.scheduledAt / 1000)))
      }
      const res = await ctx.fetch(`${GRAPH}/${pageId}/photos`, { method: 'POST', body: form })
      const data = await readJsonResponse(res)
      if (!res.ok) throw new Error(data.error?.message || 'Facebook: ошибка публикации фото')
      return {
        remoteId: String(data.post_id ?? data.id),
        url: data.post_id ? `https://www.facebook.com/${data.post_id}` : undefined,
        nativeScheduling: nativeSchedule
      }
    }

    const attached: unknown[] = []
    for (const asset of media) {
      const id = await uploadPhoto(pageId, pageAccessToken, asset, false, ctx)
      attached.push({ media_fbid: id })
    }
    const body: Record<string, unknown> = { message: post.text, access_token: pageAccessToken }
    if (attached.length) body.attached_media = attached
    if (input.scheduledAt) {
      body.published = false
      body.scheduled_publish_time = Math.floor(input.scheduledAt / 1000)
    }
    const res = await ctx.fetch(`${GRAPH}/${pageId}/feed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await readJsonResponse(res)
    if (!res.ok) throw new Error(data.error?.message || 'Facebook: ошибка публикации')
    return {
      remoteId: String(data.id ?? ''),
      url: data.id ? `https://www.facebook.com/${data.id}` : undefined,
      nativeScheduling: nativeSchedule
    }
  }
}

export default adapter
