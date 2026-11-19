import type { Adapter, AdapterContext, MediaAsset, PublishInput, PublishOutcome } from '@shared/types'
import { readJsonResponse } from '../util'

const PDS = 'https://bsky.social'

interface Session {
  accessJwt: string
  did: string
  handle: string
}

async function createSession(identifier: string, password: string, ctx: AdapterContext): Promise<Session> {
  const res = await ctx.fetch(`${PDS}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password })
  })
  const data = await readJsonResponse(res)
  if (!res.ok) throw new Error(data.message || 'Не удалось войти в Bluesky (проверьте handle и app password)')
  return data as Session
}

const encoder = new TextEncoder()
const LINK_RE = /https?:\/\/[^\s)»"']+/g
const MENTION_RE = /(^|\s)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g

function facetsFor(text: string): unknown[] {
  const facets: unknown[] = []
  for (const match of text.matchAll(LINK_RE)) {
    const start = encoder.encode(text.slice(0, match.index)).length
    facets.push({
      index: { byteStart: start, byteEnd: start + encoder.encode(match[0]).length },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: match[0] }]
    })
  }
  for (const match of text.matchAll(MENTION_RE)) {
    const handle = match[2]
    const prefix = (match[1] ?? '').length
    const startChar = (match.index ?? 0) + prefix + 1
    const start = encoder.encode(text.slice(0, startChar)).length
    facets.push({
      index: { byteStart: start, byteEnd: start + encoder.encode(handle).length },
      features: [{ $type: 'app.bsky.richtext.facet#mention', did: '' }],
      $handle: handle
    })
  }
  return facets
}

function splitThread(text: string, limit = 290): string[] {
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  const paragraphs = text.split(/\n{2,}/)
  let current = ''
  for (const paragraph of paragraphs) {
    if (!current) current = paragraph
    else if ((current + '\n\n' + paragraph).length <= limit) current += `\n\n${paragraph}`
    else {
      chunks.push(current)
      current = paragraph
    }
  }
  if (current) chunks.push(current)
  return chunks.flatMap((chunk) => {
    if (chunk.length <= limit) return [chunk]
    const parts: string[] = []
    let rest = chunk
    while (rest.length > limit) {
      let cut = rest.lastIndexOf(' ', limit)
      if (cut < limit * 0.5) cut = limit
      parts.push(rest.slice(0, cut).trim())
      rest = rest.slice(cut).trim()
    }
    if (rest) parts.push(rest)
    return parts
  })
}

async function uploadImage(session: Session, asset: MediaAsset, ctx: AdapterContext): Promise<any> {
  const res = await ctx.fetch(`${PDS}/xrpc/com.atproto.repo.uploadBlob`, {
    method: 'POST',
    headers: { authorization: `Bearer ${session.accessJwt}`, 'content-type': asset.mime },
    body: new Uint8Array(asset.buffer)
  })
  const data = await readJsonResponse(res)
  if (!res.ok) throw new Error(data.message || 'Не удалось загрузить изображение в Bluesky')
  return data.blob
}

const adapter: Adapter = {
  id: 'bluesky',
  name: 'Bluesky',
  color: '#3b8bff',
  capabilities: {
    maxChars: 300,
    media: { maxCount: 4, maxBytes: 1000000, mime: ['image/jpeg', 'image/png', 'image/webp'] },
    threads: true,
    nativeScheduling: false
  },
  credentialFields: [
    { key: 'handle', label: 'Handle', placeholder: 'you.bsky.social', required: true },
    { key: 'appPassword', label: 'App password', placeholder: 'xxxx-xxxx-xxxx-xxxx', secret: true, required: true, hint: 'Settings → App Passwords' }
  ],
  loginUrl: 'https://bsky.app/',
  sessionCookies: ['did'],
  async authenticate(credentials, ctx) {
    try {
      const session = await createSession(credentials.handle, credentials.appPassword, ctx)
      return { ok: true, message: `@${session.handle}` }
    } catch (error) {
      return { ok: false, message: (error as Error).message }
    }
  },
  async publish(input: PublishInput, ctx: AdapterContext): Promise<PublishOutcome> {
    const { handle, appPassword } = input.account.credentials
    if (!handle || !appPassword) throw new Error('Не заданы handle или app password')
    const session = await createSession(handle, appPassword, ctx)

    const expanded: { text: string; media: MediaAsset[] }[] = []
    input.thread.forEach((post, index) => {
      const media = input.mediaByPost[index] ?? []
      const chunks = splitThread(post.text)
      chunks.forEach((chunk, chunkIndex) => {
        expanded.push({ text: chunk, media: chunkIndex === 0 ? media : [] })
      })
    })

    let root: { uri: string; cid: string } | undefined
    let parent: { uri: string; cid: string } | undefined
    let firstUrl: string | undefined

    for (const item of expanded) {
      const images: unknown[] = []
      for (const asset of item.media.slice(0, 4)) {
        const blob = await uploadImage(session, asset, ctx)
        images.push({ alt: asset.alt ?? '', image: blob })
      }
      const record: Record<string, unknown> = {
        $type: 'app.bsky.feed.post',
        text: item.text,
        createdAt: new Date().toISOString(),
        langs: [input.account.lang.toLowerCase()]
      }
      if (images.length) record.embed = { $type: 'app.bsky.embed.images', images }
      const facets = facetsFor(item.text) as { $handle?: string }[]
      const resolved: unknown[] = []
      for (const facet of facets) {
        if (facet.$handle) {
          try {
            const res = await ctx.fetch(`${PDS}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(facet.$handle)}`)
            const data = await readJsonResponse(res)
            if (data.did) {
              resolved.push({
                index: (facet as { index: unknown }).index,
                features: [{ $type: 'app.bsky.richtext.facet#mention', did: data.did }]
              })
            }
          } catch {
            /* ignore unresolved mention */
          }
        } else {
          resolved.push(facet)
        }
      }
      if (resolved.length) record.facets = resolved
      if (root && parent) record.reply = { root, parent }

      const res = await ctx.fetch(`${PDS}/xrpc/com.atproto.repo.createRecord`, {
        method: 'POST',
        headers: { authorization: `Bearer ${session.accessJwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ repo: session.did, collection: 'app.bsky.feed.post', record })
      })
      const data = await readJsonResponse(res)
      if (!res.ok) throw new Error(data.message || 'Не удалось опубликовать пост в Bluesky')
      const ref = { uri: data.uri as string, cid: data.cid as string }
      if (!root) {
        root = ref
        firstUrl = `https://bsky.app/profile/${session.handle}/post/${ref.uri.split('/').pop()}`
      }
      parent = ref
    }
    return { url: firstUrl, remoteId: root?.uri }
  }
}

export default adapter
