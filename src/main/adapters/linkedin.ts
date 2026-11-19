import type { Adapter, AdapterContext, MediaAsset, PublishInput, PublishOutcome } from '@shared/types'
import { readJsonResponse } from '../util'

const API = 'https://api.linkedin.com/v2'

async function resolveAuthor(account: { credentials: Record<string, string> }, ctx: AdapterContext): Promise<string> {
  const creds = account.credentials
  if (creds.authorUrn) return creds.authorUrn
  if (creds.organizationId) return `urn:li:organization:${creds.organizationId.trim()}`
  const res = await ctx.fetch(`${API}/userinfo`, {
    headers: { authorization: `Bearer ${creds.accessToken}` }
  })
  const data = await readJsonResponse(res)
  if (!res.ok || !data.sub) throw new Error('LinkedIn: не удалось определить автора (проверьте токен и scope openid profile)')
  return `urn:li:person:${data.sub}`
}

async function uploadImage(accessToken: string, author: string, asset: MediaAsset, ctx: AdapterContext): Promise<string> {
  const register = await ctx.fetch(`${API}/assets?action=registerUpload`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
        owner: author,
        serviceRelationships: [
          { relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }
        ]
      }
    })
  })
  const registered = await readJsonResponse(register)
  if (!register.ok) throw new Error(registered.message || 'LinkedIn: не удалось зарегистрировать загрузку')
  const value = registered.value
  const uploadUrl: string | undefined =
    value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl
  const assetUrn: string | undefined = value?.asset
  if (!uploadUrl || !assetUrn) throw new Error('LinkedIn: некорректный ответ registerUpload')

  const upload = await ctx.fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': asset.mime,
      'content-length': String(asset.buffer.length)
    },
    body: new Uint8Array(asset.buffer)
  })
  if (!upload.ok) throw new Error(`LinkedIn: загрузка изображения не удалась (${upload.status})`)
  return assetUrn
}

const adapter: Adapter = {
  id: 'linkedin',
  name: 'LinkedIn',
  color: '#0a66c2',
  capabilities: {
    maxChars: 3000,
    media: { maxCount: 9, maxBytes: 8 * 1024 * 1024, mime: ['image/jpeg', 'image/png', 'image/gif'] },
    threads: false,
    nativeScheduling: false
  },
  credentialFields: [
    {
      key: 'accessToken',
      label: 'OAuth 2.0 access token',
      placeholder: 'токен со scope w_member_social',
      secret: true,
      required: true,
      hint: 'LinkedIn Developers → ваше приложение → OAuth 2.0 tools'
    },
    {
      key: 'organizationId',
      label: 'Organization ID (опционально)',
      placeholder: '12345678',
      hint: 'Для постов от имени страницы компании; пусто — от личного профиля'
    }
  ],
  loginUrl: 'https://www.linkedin.com/feed/',
  sessionCookies: ['li_at'],
  async authenticate(credentials, ctx) {
    try {
      const res = await ctx.fetch(`${API}/userinfo`, {
        headers: { authorization: `Bearer ${credentials.accessToken}` }
      })
      const data = await readJsonResponse(res)
      if (!res.ok) return { ok: false, message: data.message || `HTTP ${res.status}` }
      return { ok: true, message: data.name ?? data.sub ?? 'профиль доступен' }
    } catch (error) {
      return { ok: false, message: (error as Error).message }
    }
  },
  async publish(input: PublishInput, ctx: AdapterContext): Promise<PublishOutcome> {
    const token = input.account.credentials.accessToken
    if (!token) throw new Error('Не задан access token LinkedIn')
    if (input.thread.length > 1) {
      throw new Error('LinkedIn: ветки не поддерживаются API — отправьте один пост')
    }
    const post = input.thread[0]
    const author = await resolveAuthor(input.account, ctx)
    const media = input.mediaByPost[0] ?? []

    const uploaded: { asset: string; alt?: string }[] = []
    for (const asset of media.slice(0, 9)) {
      uploaded.push({ asset: await uploadImage(token, author, asset, ctx), alt: asset.alt })
    }

    const shareContent: Record<string, unknown> = {
      shareCommentary: { text: post.text },
      shareMediaCategory: uploaded.length ? 'IMAGE' : 'NONE'
    }
    if (uploaded.length) {
      shareContent.media = uploaded.map((item) => ({
        status: 'READY',
        media: item.asset,
        ...(item.alt ? { description: { text: item.alt.slice(0, 200) } } : {})
      }))
    }

    const res = await ctx.fetch(`${API}/ugcPosts`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        author,
        lifecycleState: 'PUBLISHED',
        specificContent: { 'com.linkedin.ugc.ShareContent': shareContent },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
      })
    })
    const data = await readJsonResponse(res)
    if (!res.ok) throw new Error(data.message || `LinkedIn: ошибка публикации (${res.status})`)
    const urn = String(data.id ?? '')
    return {
      remoteId: urn,
      url: urn ? `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}/` : undefined
    }
  }
}

export default adapter
