import type { Adapter, AdapterContext, MediaAsset, PublishInput, PublishOutcome } from '@shared/types'
import { readJsonResponse } from '../util'

// Test seam: the e2e smoke suite points this at a local mock Bot API server.
const API = process.env.GRIDPOST_TELEGRAM_API ?? 'https://api.telegram.org'

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function convertMarkdown(text: string): string {
  let out = esc(text)
  out = out.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  out = out.replace(/(^|\s)\*(?!\s)(.+?)(?<!\s)\*/g, '$1<i>$2</i>')
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
  return out
}

async function botCall(token: string, method: string, body: FormData | Record<string, unknown>, ctx: AdapterContext): Promise<any> {
  const isForm = body instanceof FormData
  const res = await ctx.fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    body: isForm ? body : JSON.stringify(body),
    headers: isForm ? undefined : { 'content-type': 'application/json' }
  })
  const data = await readJsonResponse(res)
  if (!res.ok || data.ok === false) {
    throw new Error(data.description || `Telegram API error (${res.status})`)
  }
  return data.result
}

function chatLink(chatId: string, messageId: number | undefined): string | undefined {
  if (!messageId) return undefined
  if (chatId.startsWith('@')) return `https://t.me/${chatId.slice(1)}/${messageId}`
  if (/^-100\d+$/.test(chatId)) return `https://t.me/c/${chatId.slice(4)}/${messageId}`
  return undefined
}

async function sendWithMedia(
  token: string,
  chatId: string,
  text: string,
  media: MediaAsset[],
  replyTo: number | undefined,
  ctx: AdapterContext
): Promise<number | undefined> {
  const caption = convertMarkdown(text)

  if (media.length === 0) {
    const result = await botCall(token, 'sendMessage', {
      chat_id: chatId,
      text: caption,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
      ...(replyTo ? { reply_to_message_id: replyTo, allow_sending_without_reply: true } : {})
    }, ctx)
    return result.message_id
  }

  if (media.length === 1) {
    const asset = media[0]
    const isVideo = asset.mime.startsWith('video/')
    const isGif = asset.mime === 'image/gif'
    const method = isVideo ? 'sendVideo' : isGif ? 'sendAnimation' : 'sendPhoto'
    const field = isVideo ? 'video' : isGif ? 'animation' : 'photo'
    const form = new FormData()
    form.set('chat_id', chatId)
    form.set(field, new Blob([asset.buffer], { type: asset.mime }), asset.name)
    if (caption) {
      form.set('caption', caption)
      form.set('parse_mode', 'HTML')
    }
    if (replyTo) {
      form.set('reply_to_message_id', String(replyTo))
      form.set('allow_sending_without_reply', 'true')
    }
    if (asset.alt) form.set('show_caption_above_media', 'false')
    const result = await botCall(token, method, form, ctx)
    return result.message_id
  }

  const form = new FormData()
  form.set('chat_id', chatId)
  if (replyTo) {
    form.set('reply_to_message_id', String(replyTo))
    form.set('allow_sending_without_reply', 'true')
  }
  const group = media.slice(0, 10).map((asset, index) => {
    const key = `file${index}`
    form.set(key, new Blob([asset.buffer], { type: asset.mime }), asset.name)
    const entry: Record<string, unknown> = { type: asset.mime.startsWith('video/') ? 'video' : 'photo', media: `attach://${key}` }
    if (index === 0 && caption) {
      entry.caption = caption
      entry.parse_mode = 'HTML'
    }
    return entry
  })
  form.set('media', JSON.stringify(group))
  const result = await botCall(token, 'sendMediaGroup', form, ctx)
  return Array.isArray(result) ? result[0]?.message_id : undefined
}

const adapter: Adapter = {
  id: 'telegram',
  name: 'Telegram',
  color: '#2aabee',
  capabilities: {
    maxChars: 4096,
    media: { maxCount: 10, maxBytes: 50 * 1024 * 1024, mime: ['image/*', 'video/*'] },
    threads: true,
    nativeScheduling: false,
    formatting: 'HTML / Markdown'
  },
  credentialFields: [
    { key: 'botToken', label: 'Bot token', placeholder: '123456:ABC-DEF…', secret: true, required: true, hint: 'Получите у @BotFather' },
    { key: 'chatId', label: 'Channel / chat ID', placeholder: '@my_channel или -1001234567890', required: true, hint: 'Бот должен быть админом канала' }
  ],
  loginUrl: 'https://web.telegram.org/a/',
  sessionCookies: ['stel_token', 'stel_ssid'],
  async authenticate(credentials, ctx) {
    try {
      const result = await botCall(credentials.botToken, 'getMe', {}, ctx)
      return { ok: true, message: `@${result.username}` }
    } catch (error) {
      return { ok: false, message: (error as Error).message }
    }
  },
  async publish(input: PublishInput, ctx: AdapterContext): Promise<PublishOutcome> {
    const token = input.account.credentials.botToken
    const chatId = input.account.credentials.chatId
    if (!token || !chatId) throw new Error('Не заданы токен бота или chat ID')

    let replyTo: number | undefined
    let firstId: number | undefined
    let lastId: number | undefined
    for (let i = 0; i < input.thread.length; i += 1) {
      const post = input.thread[i]
      const media = input.mediaByPost[i] ?? []
      const messageId = await sendWithMedia(token, chatId, post.text, media, replyTo, ctx)
      if (!firstId) firstId = messageId
      lastId = messageId
      replyTo = messageId
    }
    return {
      remoteId: String(firstId ?? ''),
      url: chatLink(chatId, firstId ?? lastId)
    }
  }
}

export default adapter
