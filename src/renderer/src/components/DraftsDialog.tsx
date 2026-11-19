import { FolderOpen, Save, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import Modal from './Modal'

export default function DraftsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const data = useStore((s) => s.data)
  const loadDraft = useStore((s) => s.loadDraft)
  const deleteDraft = useStore((s) => s.deleteDraft)
  const saveDraftAs = useStore((s) => s.saveDraftAs)
  const drafts = [...(data?.drafts ?? [])].sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <Modal title="Черновики" onClose={onClose}>
      <button
        className="btn small ghost"
        style={{ marginBottom: 10 }}
        onClick={async () => {
          await saveDraftAs()
          onClose()
        }}
      >
        <Save size={12} /> Сохранить текущий текст
      </button>
      {!drafts.length && (
        <div className="empty" style={{ padding: 24 }}>
          <FolderOpen size={22} />
          <div>Черновиков пока нет</div>
          <div className="dim">Текст автоматически сохраняется по мере набора</div>
        </div>
      )}
      {drafts.map((draft) => {
        const preview =
          draft.text?.trim() ||
          draft.variants
            .flatMap((v) => v.thread)
            .map((p) => p.text)
            .join(' ')
            .trim()
        const langs = draft.variants.map((v) => v.lang).filter((lang) => lang !== '*')
        return (
          <div className="record" key={draft.id}>
            <div className="record-head">
              <span className="mono">{new Date(draft.updatedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
              {draft.id === 'composer-draft' && <span className="pill">авто</span>}
              {langs.length > 0 && langs.map((lang) => <span className="pill" key={lang}>{lang}</span>)}
              <span className="spacer" />
              <button
                className="mini-btn"
                onClick={() => {
                  loadDraft(draft)
                  onClose()
                }}
              >
                открыть
              </button>
              <button className="mini-btn" onClick={() => void deleteDraft(draft.id)}>
                <Trash2 size={10} />
              </button>
            </div>
            <div className="record-text">{preview || 'Пустой черновик'}</div>
          </div>
        )
      })}
    </Modal>
  )
}
