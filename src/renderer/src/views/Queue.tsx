import { useState } from 'react'
import { Clock, ExternalLink, Loader2, RotateCw, Trash2, Zap } from 'lucide-react'
import type { PostResult } from '@shared/types'
import { useStore } from '../store'
import { statusColor } from '../components/PreviewCards'

const STATUS_LABEL: Record<PostResult['status'], string> = {
  pending: 'ожидает',
  sending: 'отправка',
  sent: 'отправлен',
  error: 'ошибка',
  skipped: 'пропущен'
}

export default function Queue(): JSX.Element {
  const data = useStore((s) => s.data)
  const toast = useStore((s) => s.toast)
  const [busy, setBusy] = useState<string | null>(null)

  const records = data?.records ?? []
  const accounts = new Map((data?.accounts ?? []).map((a) => [a.id, a]))

  const act = async (id: string, action: () => Promise<unknown>, message: string): Promise<void> => {
    setBusy(id)
    try {
      await action()
      toast(message)
    } catch (error) {
      toast((error as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  if (!records.length) {
    return (
      <div className="scroll">
        <div className="empty">
          <Clock size={28} />
          <div>Очередь пуста</div>
          <div className="dim">Опубликуйте первый пост или запланируйте его на потом</div>
        </div>
      </div>
    )
  }

  return (
    <div className="scroll">
      {records.map((record) => {
        const errors = record.results.filter((r) => r.status === 'error')
        const pending = record.results.filter((r) => r.status === 'pending')
        const preview = Object.values(record.variants)[0]?.[0]?.text ?? ''
        const scheduled = record.scheduledAt && record.scheduledAt > Date.now()
        return (
          <div className="record" key={record.id}>
            <div className="record-head">
              {record.scheduledAt ? <Clock size={11} /> : <Zap size={11} />}
              <span className="mono">
                {record.scheduledAt
                  ? new Date(record.scheduledAt).toLocaleString('ru-RU', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit'
                    })
                  : new Date(record.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </span>
              {scheduled && <span className="pill">в очереди</span>}
              {record.native && <span className="pill ok">нативно</span>}
              <span className="spacer" />
              <button
                className="mini-btn"
                title="Повторить только неуспешные"
                disabled={!errors.length || busy === record.id}
                onClick={() => void act(record.id, () => window.gridpost.retryPost(record.id), 'Повтор для неуспешных')}
              >
                <RotateCw size={10} /> ретрай
              </button>
              {pending.length > 0 && record.scheduledAt && (
                <button
                  className="mini-btn"
                  disabled={busy === record.id}
                  onClick={() => void act(record.id, () => window.gridpost.ackPost(record.id, 'now'), 'Публикуем сейчас')}
                  title="Опубликовать не дожидаясь времени"
                >
                  <Zap size={10} />
                </button>
              )}
              <button
                className="mini-btn"
                disabled={busy === record.id}
                onClick={() => void act(record.id, () => window.gridpost.deletePost(record.id), 'Удалено из истории')}
              >
                <Trash2 size={10} />
              </button>
            </div>
            {preview && <div className="record-text">{preview}</div>}
            {record.results.map((result) => {
              const account = accounts.get(result.accountId)
              return (
                <div className="result-row" key={result.accountId}>
                  <span className="status-dot" style={{ background: statusColor(result.status) }} />
                  <span className="pill">{result.lang}</span>
                  <span className="result-name">{account?.name ?? 'удалённый аккаунт'}</span>
                  {result.status === 'sending' && <Loader2 size={10} className="spin" />}
                  {result.error ? (
                    <span className="result-error" title={result.error}>
                      {result.error}
                    </span>
                  ) : (
                    <span className="dim" style={{ fontSize: 10 }}>
                      {STATUS_LABEL[result.status]}
                    </span>
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
        )
      })}
    </div>
  )
}
