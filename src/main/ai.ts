import type { Settings } from '@shared/types'
import { readJsonResponse } from './util'

function buildPrompt(text: string, target: string, platform?: string, toneAdaptation = true): string {
  const platformHint: Record<string, string> = {
    x: 'Площадка X/Twitter: очень кратко, живее, без воды, уложись в 270 символов.',
    telegram: 'Площадка Telegram: структурировано, допустимы абзацы и эмодзи, можно Markdown.',
    facebook: 'Площадка Facebook: спокойный разговорный стиль, абзацы.',
    bluesky: 'Площадка Bluesky: кратко, до 290 символов.',
    mastodon: 'Площадка Mastodon: кратко, дружелюбно, до 480 символов.'
  }
  return [
    `Переведи текст на язык «${target}».`,
    'Верни только перевод без пояснений, кавычек и markdown-обёрток вокруг всего текста.',
    'Сохрани эмодзи, ссылки, упоминания и переносы строк.',
    toneAdaptation && platform ? platformHint[platform] ?? '' : ''
  ]
    .filter(Boolean)
    .join('\n')
    .concat(`\n\nТекст:\n${text}`)
}

async function chat(settings: Settings, prompt: string): Promise<string> {
  const ai = settings.ai
  if (ai.provider === 'none') throw new Error('AI-переводчик отключён в настройках')
  if (ai.provider === 'ollama') {
    const base = ai.baseUrl.replace(/\/+$/, '') || 'http://localhost:11434'
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: ai.model || 'qwen2.5:7b',
        stream: false,
        options: { temperature: 0.3 },
        messages: [
          { role: 'system', content: 'Ты профессиональный переводчик постов для соцсетей.' },
          { role: 'user', content: prompt }
        ]
      })
    })
    const data = await readJsonResponse(res)
    if (!res.ok) throw new Error(data.error || `Ollama: HTTP ${res.status}`)
    return String(data.message?.content ?? '').trim()
  }
  const base = (ai.baseUrl || 'https://api.openai.com').replace(/\/+$/, '')
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ai.apiKey}` },
    body: JSON.stringify({
      model: ai.model || 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: 'Ты профессиональный переводчик постов для соцсетей.' },
        { role: 'user', content: prompt }
      ]
    })
  })
  const data = await readJsonResponse(res)
  if (!res.ok) throw new Error(data.error?.message || `AI: HTTP ${res.status}`)
  return String(data.choices?.[0]?.message?.content ?? '').trim()
}

export async function translateText(
  settings: Settings,
  text: string,
  targetLang: string,
  platform?: string
): Promise<string> {
  if (!text.trim()) return ''
  const prompt = buildPrompt(text, targetLang, platform, settings.ai.toneAdaptation)
  const output = await chat(settings, prompt)
  return output.replace(/^```[a-z]*\n?|\n?```$/g, '').trim()
}

export async function checkProvider(settings: Settings): Promise<{ ok: boolean; message: string }> {
  try {
    const out = await chat(settings, 'Ответь одним словом: ok')
    return { ok: true, message: out.slice(0, 40) || 'ok' }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
}
