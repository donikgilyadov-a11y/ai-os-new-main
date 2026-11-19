export const LANG_COLORS: Record<string, string> = {
  EN: '#4cc38a',
  RU: '#e0a04a',
  ES: '#e06c75',
  DE: '#61afef',
  FR: '#c678dd',
  IT: '#56b6c2',
  PT: '#98c379',
  ZH: '#e5c07b',
  JA: '#ff8fa3'
}

export const STATUS_COLORS = {
  sent: '#4cc38a',
  pending: '#e0a04a',
  sending: '#61afef',
  error: '#e06c75',
  skipped: '#6b7280'
} as const

export function langColor(lang: string): string {
  return LANG_COLORS[lang.toUpperCase()] ?? '#8b93a7'
}

export const platformLabels: Record<string, string> = {
  x: 'X (Twitter)',
  telegram: 'Telegram',
  facebook: 'Facebook',
  bluesky: 'Bluesky',
  mastodon: 'Mastodon'
}
