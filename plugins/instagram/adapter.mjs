/**
 * Instagram Graph API plugin for Gridpost.
 *
 * Publishes captions, single photos and carousels through the official
 * Content Publishing API:
 *   1. POST /{ig-user-id}/media          -> creation container id
 *   2. POST /{ig-user-id}/media_publish  -> published media id
 *
 * Instagram requires media to be reachable by a public URL. Gridpost keeps
 * files locally, so set `imageBaseUrl` to a public folder/CDN where those
 * files are mirrored under the same names. Text-only posts need no media URL.
 */
const DEFAULT_VERSION = 'v19.0'

function stripSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

function base(account) {
  const version = stripSlash(account.credentials.apiVersion || DEFAULT_VERSION)
  return `https://graph.facebook.com/${version}/${account.credentials.igUserId}`
}

async function json(res) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = data?.error?.error_user_msg || data?.error?.message || `HTTP ${res.status}`
    throw new Error(`Instagram: ${message}`)
  }
  return data
}

export default {
  capabilities: {
    maxChars: 2200,
    media: {
      maxCount: 10,
      maxBytes: 8 * 1024 * 1024,
      mime: ['image/jpeg', 'image/png']
    },
    threads: false,
    nativeScheduling: false,
    formatting: 'Instagram не поддерживает ссылки в подписи — они становятся текстом'
  },

  credentialFields: [
    {
      key: 'accessToken',
      label: 'Access token',
      placeholder: 'IGAA…',
      secret: true,
      required: true,
      hint: 'Токен Instagram API с разрешением instagram_content_publish'
    },
    {
      key: 'igUserId',
      label: 'Instagram account ID',
      placeholder: '17841400000000000',
      required: true,
      hint: 'GET /me?fields=accounts — id associated с бизнес-аккаунтом'
    },
    {
      key: 'imageBaseUrl',
      label: 'Публичная папка для медиа (опционально)',
      placeholder: 'https://cdn.example.com/gridpost/',
      hint: 'Instagram забирает файлы по URL. Зеркало должно содержать те же имена (после сжатия расширение может стать .jpg).'
    },
    {
      key: 'apiVersion',
      label: 'Graph API version',
      placeholder: DEFAULT_VERSION,
      hint: 'По умолчанию ' + DEFAULT_VERSION
    }
  ],

  loginUrl: 'https://www.instagram.com/',
  sessionCookies: ['sessionid'],

  async authenticate(credentials, ctx) {
    if (!credentials.accessToken || !credentials.igUserId) {
      return { ok: false, message: 'Укажите токен и Instagram account ID' }
    }
    try {
      const version = stripSlash(credentials.apiVersion || DEFAULT_VERSION)
      const res = await ctx.fetch(
        `https://graph.facebook.com/${version}/${credentials.igUserId}?fields=id,username&access_token=${encodeURIComponent(credentials.accessToken)}`
      )
      const data = await json(res)
      return { ok: true, message: `@${data.username ?? data.id}` }
    } catch (error) {
      return { ok: false, message: String(error.message || error) }
    }
  },

  async publish(input, ctx) {
    const { account } = input
    const token = account.credentials.accessToken
    if (!token || !account.credentials.igUserId) {
      throw new Error('Instagram: не заданы access token или IG user ID')
    }
    if (input.thread.length > 1) {
      throw new Error('Instagram: ветки не поддерживаются — отправьте один пост')
    }

    const caption = input.thread[0]?.text ?? ''
    const assets = (input.mediaByPost[0] ?? []).filter((asset) => asset.mime.startsWith('image/'))
    const baseUrl = stripSlash(account.credentials.imageBaseUrl)
    if (assets.length && !baseUrl) {
      throw new Error('Instagram: укажите публичную папку для медиа (imageBaseUrl) в настройках аккаунта')
    }

    const create = async (body) => {
      const form = new URLSearchParams({ ...body, access_token: token })
      const res = await ctx.fetch(`${base(account)}/media`, { method: 'POST', body: form })
      const data = await json(res)
      if (!data.id) throw new Error('Instagram: API не вернул id медиа-контейнера')
      return String(data.id)
    }

    let creationId
    if (assets.length > 1) {
      const children = []
      for (const asset of assets) {
        children.push(
          await create({
            media_type: 'IMAGE',
            is_carousel_item: 'true',
            image_url: `${baseUrl}/${encodeURIComponent(asset.name)}`
          })
        )
      }
      creationId = await create({
        media_type: 'CAROUSEL',
        children: children.join(','),
        caption
      })
    } else if (assets.length === 1) {
      creationId = await create({
        media_type: 'IMAGE',
        image_url: `${baseUrl}/${encodeURIComponent(assets[0].name)}`,
        caption
      })
    } else {
      creationId = await create({ media_type: 'TEXT', caption })
    }

    // Instagram may need a moment to finish processing the container.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const statusRes = await ctx.fetch(
        `${base(account)}/media/${creationId}?fields=status_code&access_token=${encodeURIComponent(token)}`
      )
      const status = await statusRes.json().catch(() => ({}))
      if (status.error) throw new Error(`Instagram: ${status.error.message || 'ошибка проверки контейнера'}`)
      if (status.status_code === 'FINISHED') break
      if (status.status_code === 'ERROR') throw new Error('Instagram: не удалось подготовить медиа')
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    const publishRes = await ctx.fetch(`${base(account)}/media_publish`, {
      method: 'POST',
      body: new URLSearchParams({ creation_id: creationId, access_token: token })
    })
    const published = await json(publishRes)
    const remoteId = String(published.id ?? creationId)

    let url
    try {
      const infoRes = await ctx.fetch(
        `https://graph.facebook.com/${stripSlash(account.credentials.apiVersion || DEFAULT_VERSION)}/${remoteId}?fields=shortcode&access_token=${encodeURIComponent(token)}`
      )
      const info = await infoRes.json()
      if (info.shortcode) url = `https://www.instagram.com/p/${info.shortcode}/`
    } catch {
      // shortcode is optional — the remoteId is still stored for stats
    }

    ctx.log(`instagram post ${remoteId} published`)
    return { remoteId, url, nativeScheduling: false }
  },

  async fetchStats(account, remoteId, ctx) {
    const version = stripSlash(account.credentials.apiVersion || DEFAULT_VERSION)
    const fields = account.credentials.igUserId ? 'like_count,comments_count,impressions' : 'like_count,comments_count'
    const res = await ctx.fetch(
      `https://graph.facebook.com/${version}/${remoteId}?fields=${fields}&access_token=${encodeURIComponent(account.credentials.accessToken)}`
    )
    const data = await json(res)
    return { likes: data.like_count, replies: data.comments_count, views: data.impressions }
  }
}
