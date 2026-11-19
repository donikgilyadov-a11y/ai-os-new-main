/**
 * Sample Gridpost plugin.
 *
 * Contract (see docs/PLUGINS.md):
 *   capabilities        -> limits for the composer
 *   credentialFields    -> fields rendered in the add-account wizard
 *   authenticate(ctx)   -> optional credential check
 *   publish(input, ctx) -> publish a thread, return { url, remoteId }
 *   fetchStats(...)     -> optional metrics for the Pulse tab
 *
 * `ctx.fetch` is bound to the account's isolated session (proxy + cookies).
 */
export default {
  capabilities: {
    maxChars: 1900,
    media: { maxCount: 4, maxBytes: 8 * 1024 * 1024, mime: ['image/*'] },
    threads: false,
    nativeScheduling: false,
    formatting: 'Markdown'
  },

  credentialFields: [
    {
      key: 'webhookUrl',
      label: 'Webhook URL',
      placeholder: 'https://discord.com/api/webhooks/…',
      secret: true,
      required: true
    },
    { key: 'username', label: 'Display name', placeholder: 'Gridpost' }
  ],

  async authenticate(credentials, ctx) {
    if (!credentials.webhookUrl) return { ok: false, message: 'Укажите webhook URL' }
    try {
      const res = await ctx.fetch(credentials.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'Gridpost: проверка подключения ✅' })
      })
      return { ok: res.ok, message: res.ok ? 'Webhook отвечает' : `HTTP ${res.status}` }
    } catch (error) {
      return { ok: false, message: String(error) }
    }
  },

  async publish(input, ctx) {
    const url = input.account.credentials.webhookUrl
    if (!url) throw new Error('Не задан webhook URL')
    const username = input.account.credentials.username || undefined
    const text = input.thread.map((post) => post.text).join('\n\n')
    const res = await ctx.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: text, username })
    })
    if (!res.ok) throw new Error(`Webhook вернул HTTP ${res.status}`)
    return { remoteId: `webhook_${Date.now()}` }
  }
}
