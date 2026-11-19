import { Clock } from 'lucide-react'
import { useStore } from '../store'
import Modal from './Modal'

export default function MissedDialog(): JSX.Element | null {
  const missed = useStore((s) => s.missed)
  const setMissed = useStore((s) => s.setMissed)
  const toast = useStore((s) => s.toast)

  if (!missed || !missed.records.length) return null

  const apply = async (action: 'now' | 'reschedule' | 'draft'): Promise<void> => {
    const when = Date.now() + 3600_000
    for (const record of missed.records) {
      await window.gridpost.ackPost(record.id, action, action === 'reschedule' ? when : undefined)
    }
    setMissed(null)
    toast(
      action === 'now' ? 'Публикуем пропущенные' : action === 'reschedule' ? 'Перенесено на час вперёд' : 'Сохранено в черновики'
    )
  }

  return (
    <Modal
      title="Пропущенные публикации"
      onClose={() => setMissed(null)}
      footer={
        <>
          <button className="btn primary grow" onClick={() => void apply('now')}>
            Опубликовать сейчас
          </button>
          <button className="btn ghost" onClick={() => void apply('reschedule')}>
            +1 час
          </button>
          <button className="btn ghost" onClick={() => void apply('draft')}>
            В черновики
          </button>
        </>
      }
    >
      <div className="row" style={{ marginBottom: 10 }}>
        <Clock size={14} />
        <span>
          {missed.records.length} публикац. не вышли по расписанию — компьютер был выключен. Что делаем?
        </span>
      </div>
      <div className="dim" style={{ fontSize: 10.5 }}>
        Отправка в разные аккаунты одной площадки выполняется с паузой jitter (защита от антифрода).
      </div>
    </Modal>
  )
}
