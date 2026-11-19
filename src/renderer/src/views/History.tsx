import { useMemo, useState } from 'react'
import { Archive, Download, ExternalLink, RotateCcw, Search, Trash2, X } from 'lucide-react'
import type { PostRecord, PostResult } from '@shared/types'
import { useStore } from '../store'
import { statusColor } from '../components/PreviewCards'
import { platformShort } from '../lib/platform'

type Filter = 'all' | 'sent' | 'error' | 'skipped' | 'scheduled'

const LABEL: Record<PostResult['status'], string> = {
  pending: 'ожидает',
  sending: 'отправка',
  sent: 'отправлен',
  error: 'ошибка',
  skipped: 'пропущен'
}

function aggregate(record: PostRecord): Filter {
  if (record.results.some((r) => r.status === 'sent')) return 'sent'
  if (record.results.some((r) => r.status === 'error')) return 'error'
  if (record.results.some((r) => r.status === 'skipped')) return 'skipped'
  return 'scheduled'
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'всё' },
  { id: 'sent', label: 'отправлено' },
  { id: 'error', label: 'ошибки' },
  { id: 'skipped', label: 'пропущено' },
  { id: 'scheduled', label: 'в очереди' }
]

export default function History(): JSX.Element {
  const data = useStore((s) => s.data)
  const loadRecord = useStore((s) => s.loadRecord)
  const toast = useStore((s) => s.toast)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [platform, setPlatform] = useState('all')
  const [confirm, setConfirm] = useState<string | null>(null)

  const records = useMemo(() => {
    const list = [...(data?.records ?? [])].sort(
      (a, b) => (b.scheduledAt ?? b.createdAt) - (a.scheduledAt ?? a.createdAt)
    )
    const q = query.trim().toLocaleLowerCase()
    return list.filter((record) => {
      if (filter !== 'all' && aggregate(record) !== filter) return false
      const accounts = (data?.accounts ?? []).filter((a) => record.accountIds.includes(a.id))
      if (platform !== 'all' && !accounts.some((a) => a.platform === platform)) return false
      if (!q) return true
      const text = Object.values(record.variants)
        .flatMap((thread) => thread.map((post) => post.text))
        .join(' ')
        .toLocaleLowerCase()
      return `${text} ${accounts.map((a) => `${a.name} ${a.platform}`).join(' ')}`.includes(q)
    })
  }, [data?.records, data?.accounts, query, filter, platform])

  const accounts = new Map((data?.accounts ?? []).map((a) => [a.id, a]))
  const platforms = [...new Set((data?.records ?? []).flatMap((r) => r.accountIds.map((id) => accounts.get(id)?.platform).filter((p): p is string => Boolean(p))))]
  const counts = FILTERS.reduce<Record<Filter, number>>(
    (acc, item) => ({
      ...acc,
      [item.id]: item.id === 'all' ? (data?.records ?? []).length : (data?.records ?? []).filter((r) => aggregate(r) === item.id).length
    }),
    { all: 0, sent: 0, error: 0, skipped: 0, scheduled: 0 }
  )

  const remove = async (id: string): Promise<void> => {
    try {
      await window.gridpost.deletePost(id)
      toast('Запись удалена из истории')
    } catch (error) {
      toast((error as Error).message, 'error')
    } finally {
      setConfirm(null)
    }
  }

  if (!data?.records?.length) {
    return (
      <div className="scroll">
        <div className="empty">
          <Archive size={28} />
          <div>История пока пуста</div>
          <div className="dim">Здесь появятся все отправленные и запланированные посты</div>
        </div>
      </div>
    )
  }

  return (
    <div className="scroll">
      <div className="history-search">
        <Search size={12} />
        <input
          value={query}
          placeholder="Поиск по тексту и аккаунтам"
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="icon-btn" onClick={() => setQuery('')} title="Очистить">
            <X size={12} />
          </button>
        )}
      </div>

      <div className="history-filters">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            className={`filter-pill ${filter === item.id ? 'on' : ''}`}
            onClick={() => setFilter(item.id)}
          >
            {item.label} <span className="dim">{counts[item.id]}</span>
          </button>
        ))}
      </div>

      {platforms.length > 1 && (
        <select className="history-platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
          <option value="all">Все площадки</option>
          {platforms.map((id) => (
            <option value={id} key={id}>
              {id}
            </option>
          ))}
        </select>
      )}

      <div className="section-title" style={{ marginTop: 10 }}>
        <Archive size={12} /> Записей: {records.length}
        <span className="spacer" />
        <button
          className="mini-btn"
          title="Экспортировать текущую выборку в CSV"
          onClick={async () => {
            try {
              const count = await window.gridpost.exportHistory(records.map((r) => r.id))
              if (typeof count === 'number') toast(`Экспортировано строк: ${count}`)
            } catch (error) {
              toast((error as Error).message, 'error')
            }
          }}
        >
          <Download size={10} /> CSV
        </button>
      </div>

      {!records.length && (
        <div className="empty" style={{ padding: 24 }}>
          <Search size={22} />
          <div>Ничего не найдено</div>
          <div className="dim">Попробуйте изменить запрос или фильтр</div>
        </div>
      )}

      {records.map((record) => {
        const status = aggregate(record)
        const firstResult = record.results[0]
        const firstUrl = record.results.find((r) => r.url)?.url
        const preview = Object.values(record.variants)[0]?.[0]?.text ?? ''
        const langs = [...new Set(record.results.map((r) => r.lang.toUpperCase()))]
        const pforms = [
          ...new Set(
            record.accountIds.map((id) => accounts.get(id)?.platform).filter((p): p is string => Boolean(p))
          )
        ]
        return (
          <div className="record" key={record.id}>
            <div className="record-head">
              <span className="status-dot" style={{ background: statusColor(firstResult?.status ?? 'pending') }} />
              <span className="mono" style={{ color: 'var(--text)' }}>
                {new Date(record.scheduledAt ?? record.createdAt).toLocaleString('ru-RU', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
              {pforms.map((p) => (
                <span className="pill" key={p}>{platformShort(p)}</span>
              ))}
              {langs.map((lang) => (
                <span className="pill" key={lang}>{lang}</span>
              ))}
              {record.native && <span className="pill ok">нативно</span>}
              <span className="spacer" />
              {firstUrl && (
                <button
                  className="mini-btn"
                  title="Открыть пост"
                  onClick={() => void window.gridpost.openExternal(firstUrl)}
                >
                  <ExternalLink size={10} />
                </button>
              )}
              <button className="mini-btn" title="Загрузить в композер" onClick={() => loadRecord(record)}>
                <RotateCcw size={10} /> в композер
              </button>
            </div>

            {preview && <div className="record-text">{preview}</div>}

            {record.media.length > 0 && (
              <div className="history-media">
                {record.media.slice(0, 6).map((item) => (
                  <div className="media-thumb" key={item.id} title={item.alt ?? item.name}>
                    {item.thumb ? <img src={item.thumb} alt={item.alt ?? ''} /> : <span className="mono">◆</span>}
                  </div>
                ))}
                {record.media.length > 6 && <span className="pill">+{record.media.length - 6}</span>}
              </div>
            )}

            <div className="history-results">
              {record.results.map((result) => {
                const account = accounts.get(result.accountId)
                return (
                  <div className="result-row" key={result.accountId}>
                    <span className="status-dot" style={{ background: statusColor(result.status) }} />
                    <span className="pill">{platformShort(account?.platform ?? '')}</span>
                    <span className="result-name">{account?.name ?? 'удалённый аккаунт'}</span>
                    {result.error ? (
                      <span className="result-error" title={result.error}>{result.error}</span>
                    ) : (
                      <span className="dim" style={{ fontSize: 10 }}>{LABEL[result.status]}</span>
                    )}
                    {result.url && (
                      <button
                        className="mini-btn"
                        title="Открыть пост"
                        onClick={() => void window.gridpost.openExternal(result.url as string)}
                      >
                        <ExternalLink size={10} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="history-foot">
              <span className="dim mono" style={{ fontSize: 9 }}>
                {status === 'sent'
                  ? 'опубликовано'
                  : status === 'error'
                    ? 'есть ошибки'
                    : status === 'skipped'
                      ? 'пропущено'
                      : 'в очереди'}
              </span>
              <span className="spacer" />
              <button
                className={`mini-btn ${confirm === record.id ? 'danger' : ''}`}
                onClick={() => (confirm === record.id ? void remove(record.id) : setConfirm(record.id))}
                title="Удалить запись"
              >
                <Trash2 size={10} /> {confirm === record.id ? 'точно?' : 'удалить'}
              </button>
            </div>
          </div>
        )
      })}

      <div className="dim" style={{ fontSize: 9, textAlign: 'center', padding: '10px 0 2px' }}>
        Хранятся последние 300 записей
      </div>
    </div>
  )
}
