import type { MediaItem, PostResult } from '@shared/types'
import { useStore } from '../store'

export default function PreviewCards(): JSX.Element {
  const data = useStore((s) => s.data)
  const selected = useStore((s) => s.selected)
  const platforms = useStore((s) => s.platforms)
  const composer = useStore((s) => s.composer)

  const accounts = (data?.accounts ?? []).filter((a) => selected.includes(a.id))
  if (!accounts.length) return <div className="preview-wrap dim">Выберите аккаунты, чтобы увидеть превью</div>

  const broadcast = composer.threads['*'] ?? []
  const mediaById = new Map<string, MediaItem>((data?.media ?? []).map((m) => [m.id, m]))
  const fmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="preview-wrap">
      {accounts.map((account) => {
        const platform = platforms.find((p) => p.id === account.platform)
        const limit = platform?.capabilities.maxChars ?? 280
        const thread =
          composer.mode === 'broadcast'
            ? broadcast
            : composer.threads[account.lang.toUpperCase()] ?? composer.threads[account.lang] ?? broadcast
        const text = thread.filter((p) => p.text.trim()).map((p) => p.text).join('\n\n')
        const full = text.length > limit ? `${text.slice(0, limit)}…` : text
        const mediaIds = [...new Set(thread.flatMap((p) => p.mediaIds))]
        return (
          <div className="preview-card" key={account.id}>
            <div className="preview-head">
              <span className="dot" style={{ width: 7, height: 7, borderRadius: '50%', background: account.color }} />
              <span style={{ color: 'var(--text)', fontWeight: 550 }}>{account.name}</span>
              <span className="pill">{account.lang}</span>
              <span className="spacer" />
              <span className="mono" style={{ fontSize: 9.5 }}>
                {full.length}/{limit}
              </span>
            </div>
            <div className={`preview-text ${text.length > limit ? 'truncated' : ''}`}>
              {full || <span className="dim">Пусто для этого языка</span>}
            </div>
            {mediaIds.length > 0 && (
              <div className="preview-media">
                {mediaIds.slice(0, 4).map((id) => {
                  const media = mediaById.get(id)
                  if (!media) return null
                  return media.thumb ? <img key={id} src={media.thumb} alt="" /> : null
                })}
              </div>
            )}
            <div className="preview-head" style={{ marginTop: 6, marginBottom: 0 }}>
              <span className="dim mono" style={{ fontSize: 9 }}>
                {composer.scheduleAt ? `план ${fmt.format(composer.scheduleAt)}` : 'сейчас'}
              </span>
              <span className="spacer" />
              <span className="dim mono" style={{ fontSize: 9 }}>
                {platform?.name}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function statusColor(status: PostResult['status']): string {
  switch (status) {
    case 'sent':
      return 'var(--ok)'
    case 'sending':
      return 'var(--info)'
    case 'error':
      return 'var(--err)'
    case 'skipped':
      return 'var(--text-faint)'
    default:
      return 'var(--warn)'
  }
}
