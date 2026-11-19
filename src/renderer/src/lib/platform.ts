export const PLATFORM_SHORT: Record<string, string> = {
  x: 'X',
  telegram: 'TG',
  facebook: 'FB',
  bluesky: 'BS',
  mastodon: 'MAST',
  webhook: 'HOOK'
}

export function platformShort(id: string): string {
  return PLATFORM_SHORT[id] ?? id.slice(0, 4).toUpperCase()
}
