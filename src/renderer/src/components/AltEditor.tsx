import { useState } from 'react'
import { Check, Image as ImageIcon } from 'lucide-react'
import { useStore } from '../store'
import Modal from './Modal'

export default function AltEditor({
  mediaIds,
  onClose
}: {
  mediaIds: string[]
  onClose: () => void
}): JSX.Element {
  const data = useStore((s) => s.data)
  const setMediaAlt = useStore((s) => s.setMediaAlt)
  const toast = useStore((s) => s.toast)
  const media = (data?.media ?? []).filter((m) => mediaIds.includes(m.id))
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(media.map((m) => [m.id, m.alt ?? '']))
  )
  const [saving, setSaving] = useState(false)

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      for (const [id, alt] of Object.entries(values)) {
        await setMediaAlt(id, alt.trim())
      }
      toast('Alt-текст сохранён')
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Alt-текст изображений"
      onClose={onClose}
      footer={
        <button className="btn primary grow" onClick={() => void save()} disabled={saving}>
          <Check size={13} /> Сохранить
        </button>
      }
    >
      <div className="dim" style={{ marginBottom: 10 }}>
        Описание помогает незрячим пользователям и улучшает доступность постов. До 1000 символов, уходит во все
        площадки, которые это поддерживают.
      </div>
      {!media.length && (
        <div className="empty" style={{ padding: 20 }}>
          <ImageIcon size={22} />
          <div>Для этого поста нет медиа</div>
        </div>
      )}
      {media.map((item) => (
        <div className="alt-row" key={item.id}>
          <div className="media-thumb" style={{ width: 64, height: 64 }}>
            {item.thumb ? <img src={item.thumb} alt={item.alt ?? ''} /> : <span className="mono">{item.name.slice(0, 6)}</span>}
          </div>
          <div className="grow">
            <div className="dim mono" style={{ fontSize: 9.5, marginBottom: 4 }}>
              {item.name}
            </div>
            <textarea
              rows={2}
              value={values[item.id] ?? ''}
              placeholder="Например: скриншот очереди публикаций в Gridpost"
              maxLength={1000}
              onChange={(e) => setValues({ ...values, [item.id]: e.target.value })}
            />
          </div>
        </div>
      ))}
    </Modal>
  )
}
