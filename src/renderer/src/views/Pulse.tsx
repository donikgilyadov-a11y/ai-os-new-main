import { useMemo, useState } from 'react'
import { Activity, ExternalLink, Heart, MessageCircle, RefreshCw, Eye } from 'lucide-react'
import { useStore } from '../store'

type Metrics = { likes?: number; views?: number; replies?: number; error?: string }

export default function Pulse(): JSX.Element {
  const data = useStore((s) => s.data)
  const [metrics, setMetrics] = useState<Record<string, Metrics>>({})
  const [loading, setLoading] = useState(false)

  const accounts = useMemo(() => new Map((data?.accounts ?? []).map((a) => [a.id, a])), [data?.accounts])
  const sent = (data?.records ?? []).flatMap((record) =>
    record.results
      .filter((r) => r.status === 'sent')
      .map((result) => ({ record, result }))
  )

  const refresh = async (): Promise<void> => {
    setLoading(true)
    try {
      const next: Record<string, Metrics> = {}
      for (const { record, result } of sent) {
        const key = `${record.id}:${result.accountId}`
        try {
          next[key] = (await window.gridpost.fetchStats(record.id, result.accountId)) as Metrics
        } catch {
          next[key] = {}
        }
      }
      setMetrics(next)
    } finally {
      setLoading(false)
    }
  }

  if (!sent.length) {
    return (
      <div className="scroll">
        <div className="empty">
          <Activity size={28} />
          <div>Пульс появится после первой публикации</div>
          <div className="dim">Здесь собираются метрики по всем вышедшим постам</div>
        </div>
      </div>
    )
  }

  return (
    <div className="scroll">
      <div className="section-title">
        <Activity size={12} /> Последние публикации
        <span className="spacer" />
        <button className="mini-btn" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={10} className={loading ? 'spin' : ''} /> обновить
        </button>
      </div>
      {sent.slice(0, 40).map(({ record, result }) => {
        const account = accounts.get(result.accountId)
        const key = `${record.id}:${result.accountId}`
        const metric = metrics[key]
        const text = (record.variants[result.lang] ?? Object.values(record.variants)[0] ?? [])[0]?.text ?? ''
        return (
          <div className="record" key={key}>
            <div className="record-head">
              <span className="status-dot" style={{ background: account?.color ?? 'var(--ok)' }} />
              <span style={{ color: 'var(--text)' }}>{account?.name ?? 'аккаунт'}</span>
              <span className="pill">{result.lang}</span>
              <span className="spacer" />
              <span className="mono" style={{ fontSize: 9.5 }}>
                {result.at ? new Date(result.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
              {result.url && (
                <button className="mini-btn" onClick={() => void window.gridpost.openExternal(result.url as string)}>
                  <ExternalLink size={10} />
                </button>
              )}
            </div>
            <div className="record-text">{text}</div>
            <div className="row" style={{ gap: 12, fontSize: 11, color: 'var(--text-dim)' }}>
              <span className="row" style={{ gap: 3 }}>
                <Heart size={11} /> {metric?.likes ?? '—'}
              </span>
              <span className="row" style={{ gap: 3 }}>
                <MessageCircle size={11} /> {metric?.replies ?? '—'}
              </span>
              <span className="row" style={{ gap: 3 }}>
                <Eye size={11} /> {metric?.views ?? '—'}
              </span>
              {metric?.error && <span className="dim mono" style={{ fontSize: 9 }}>{metric.error}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
