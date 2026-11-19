import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Clock,
  Eye,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Plus,
  Save,
  Send,
  Sparkles,
  Trash2,
  Type,
  X
} from 'lucide-react'
import type { MediaItem } from '@shared/types'
import { strictestLimit, useStore } from '../store'
import PreviewCards from '../components/PreviewCards'
import AltEditor from '../components/AltEditor'
import DraftsDialog from '../components/DraftsDialog'

function toLocalInput(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function Compose(): JSX.Element {
  const data = useStore((s) => s.data)
  const selected = useStore((s) => s.selected)
  const platforms = useStore((s) => s.platforms)
  const composer = useStore((s) => s.composer)
  const setMode = useStore((s) => s.setMode)
  const setActiveKey = useStore((s) => s.setActiveKey)
  const ensureLang = useStore((s) => s.ensureLang)
  const updatePost = useStore((s) => s.updatePost)
  const addPost = useStore((s) => s.addPost)
  const removePost = useStore((s) => s.removePost)
  const attachMedia = useStore((s) => s.attachMedia)
  const attachMediaDialog = useStore((s) => s.attachMediaDialog)
  const detachMedia = useStore((s) => s.detachMedia)
  const setPreview = useStore((s) => s.setPreview)
  const setSchedule = useStore((s) => s.setSchedule)
  const publish = useStore((s) => s.publish)
  const publishing = useStore((s) => s.publishing)
  const saveDraftAs = useStore((s) => s.saveDraftAs)
  const toast = useStore((s) => s.toast)

  const [translating, setTranslating] = useState(false)
  const [showSchedule, setShowSchedule] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [focusPost, setFocusPost] = useState<string | null>(null)
  const [draftsOpen, setDraftsOpen] = useState(false)
  const [altTarget, setAltTarget] = useState<{ mediaIds: string[] } | null>(null)
  const dragDepth = useRef(0)

  const accounts = data?.accounts ?? []
  const selectedLangs = useMemo(() => {
    const list = accounts.filter((a) => selected.includes(a.id)).map((a) => a.lang.toUpperCase())
    return [...new Set(list)]
  }, [accounts, selected])
  const selectedAccounts = useMemo(
    () => accounts.filter((a) => selected.includes(a.id)),
    [accounts, selected]
  )
  const langsKey = selectedLangs.join('|')

  useEffect(() => {
    for (const lang of selectedLangs) ensureLang(lang)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [langsKey, ensureLang])

  const activeKey = composer.activeKey
  const posts = composer.threads[activeKey] ?? []
  const limit = selectedAccounts.length ? strictestLimit(selectedAccounts, platforms) : 280
  const totalChars = posts.reduce((sum, p) => sum + p.text.length, 0)
  const mediaById = useMemo(() => {
    const map = new Map<string, MediaItem>()
    data?.media.forEach((m) => map.set(m.id, m))
    return map
  }, [data?.media])

  const tabKeys = composer.mode === 'broadcast' ? ['*'] : selectedLangs.length ? selectedLangs : ['*']

  const translateAll = async (): Promise<void> => {
    const sourceLang = composer.mode === 'broadcast' ? selectedLangs[0] : activeKey
    const targets = selectedLangs.filter((l) => l !== sourceLang)
    if (!targets.length) {
      toast('Нужно минимум два языка среди выбранных аккаунтов', 'error')
      return
    }
    if (!posts.some((p) => p.text.trim())) {
      toast('Нет текста для перевода', 'error')
      return
    }
    setTranslating(true)
    try {
      const source = posts.filter((p) => p.text.trim())
      const result = (await window.gridpost.translate({
        texts: source.map((p) => p.text),
        targetLangs: targets,
        platform: selectedAccounts[0]?.platform
      })) as Record<string, string[]>
      for (const [lang, texts] of Object.entries(result)) {
        ensureLang(lang)
        const existing = useStore.getState().composer.threads[lang] ?? []
        const next = texts.map((text, index) => ({
          id: existing[index]?.id ?? crypto.randomUUID(),
          text,
          mediaIds: source[index]?.mediaIds ?? []
        }))
        useStore.setState((prev) => ({
          composer: {
            ...prev.composer,
            threads: { ...prev.composer.threads, [lang]: next }
          }
        }))
      }
      toast(`Переведено: ${targets.join(', ')}`)
    } catch (error) {
      toast(`Перевод не удался: ${(error as Error).message}`, 'error')
    } finally {
      setTranslating(false)
    }
  }

  const onDrop = async (event: React.DragEvent): Promise<void> => {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const files = Array.from(event.dataTransfer.files)
    if (!files.length) return
    const target = focusPost ?? posts[0]?.id
    if (!target) return
    await attachMedia(activeKey, target, files)
  }

  return (
    <div
      className="compose"
      onDragEnter={(e) => {
        e.preventDefault()
        dragDepth.current += 1
        if (e.dataTransfer?.types.includes('Files')) setDragging(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault()
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={(e) => void onDrop(e)}
    >
      <div className="compose-toolbar">
        <div className="seg">
          <button className={composer.mode === 'broadcast' ? 'on' : ''} onClick={() => setMode('broadcast')}>
            Единый
          </button>
          <button className={composer.mode === 'languages' ? 'on' : ''} onClick={() => setMode('languages')}>
            Языки
          </button>
        </div>
        <span className="spacer" />
        <button className="mini-btn" onClick={() => setDraftsOpen(true)} title="Черновики">
          <FolderOpen size={11} />
        </button>
        <button className="mini-btn" onClick={() => void saveDraftAs()} title="Сохранить черновик">
          <Save size={11} />
        </button>
        <button className="mini-btn" onClick={() => void translateAll()} disabled={translating}>
          {translating ? <Loader2 size={11} className="spin" /> : <Sparkles size={11} />}
          Перевести
        </button>
        <button
          className={`mini-btn ${composer.preview ? 'on' : ''}`}
          onClick={() => setPreview(!composer.preview)}
          style={composer.preview ? { color: 'var(--accent)' } : undefined}
        >
          <Eye size={11} /> Превью
        </button>
      </div>

      {composer.mode === 'languages' && (
        <div className="lang-tabs">
          {tabKeys.map((key) => (
            <button
              key={key}
              className={`lang-tab ${activeKey === key ? 'on' : ''}`}
              onClick={() => setActiveKey(key)}
            >
              {key === '*' ? 'ALL' : key}
            </button>
          ))}
        </div>
      )}

      <div className="editor">
        {posts.map((post, index) => {
          const count = post.text.length
          const over = count > limit
          const warn = !over && count > limit * 0.85
          return (
            <div className="post-card" key={post.id}>
              <textarea
                value={post.text}
                placeholder={
                  index === 0
                    ? 'Что публикуем? {alias} подставится под каждую площадку…'
                    : 'Продолжение ветки…'
                }
                rows={1}
                onChange={(e) => updatePost(activeKey, post.id, { text: e.target.value })}
                onFocus={() => setFocusPost(post.id)}
                style={{ height: Math.min(220, Math.max(46, 18 + Math.ceil((count || 1) / 40) * 21)) }}
              />
              {post.mediaIds.length > 0 && (
                <div className="media-row">
                  {post.mediaIds.map((id) => {
                    const media = mediaById.get(id)
                    if (!media) return null
                    return (
                      <div className="media-thumb" key={id} title={`${media.name} · ${(media.size / 1024).toFixed(0)} КБ`}>
                        {media.thumb ? <img src={media.thumb} alt={media.alt ?? media.name} /> : media.name.slice(0, 8)}
                        <button className="rm" onClick={() => detachMedia(activeKey, post.id, id)} title="Убрать">
                          <X size={10} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="post-foot">
                {posts.length > 1 && <span className="thread-index">{index + 1}/{posts.length}</span>}
                <button
                  className="mini-btn"
                  onClick={() => void attachMediaDialog(activeKey, post.id)}
                  title="Добавить фото или видео"
                >
                  <ImageIcon size={11} />
                </button>
                {post.mediaIds.length > 0 && (
                  <button
                    className="mini-btn"
                    onClick={() => setAltTarget({ mediaIds: post.mediaIds })}
                    title="Alt-текст для медиа"
                  >
                    <Type size={11} /> alt
                  </button>
                )}
                {posts.length > 1 && (
                  <button className="mini-btn" onClick={() => removePost(activeKey, post.id)} title="Удалить пост">
                    <Trash2 size={11} />
                  </button>
                )}
                <span className="spacer" />
                <span className={`counter ${over ? 'over' : warn ? 'warn' : ''}`}>
                  {count}/{limit}
                </span>
              </div>
            </div>
          )
        })}

        <button className="mini-btn" onClick={() => addPost(activeKey)} style={{ alignSelf: 'flex-start' }}>
          <Plus size={11} /> Пост в ветке
        </button>

        {dragging && <div className="dropzone hot">Отпустите файлы — добавим в текущий пост</div>}
        {!dragging && posts.every((p) => !p.text && !p.mediaIds.length) && (
          <div className="dropzone">Перетащите изображения или видео прямо в окно</div>
        )}
      </div>

      {composer.preview && <PreviewCards />}

      <div className="compose-actions">
        <button
          className={`mini-btn ${composer.scheduleAt ? 'on' : ''}`}
          onClick={() => {
            setShowSchedule(!showSchedule)
            if (!composer.scheduleAt) setSchedule(Date.now() + 3600_000)
          }}
          style={composer.scheduleAt ? { color: 'var(--warn)' } : undefined}
          title="Отложенная публикация"
        >
          <Clock size={12} />
          {composer.scheduleAt ? new Date(composer.scheduleAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Позже'}
        </button>
        <span className="spacer" />
        <span className="dim mono" style={{ fontSize: 10 }}>
          {totalChars} симв.
        </span>
        <button className="btn primary" onClick={() => void publish()} disabled={publishing || !selectedAccounts.length}>
          {publishing ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
          {composer.scheduleAt ? 'Запланировать' : 'Опубликовать'}
        </button>
      </div>

      {showSchedule && (
        <div className="preview-wrap" style={{ maxHeight: 'none' }}>
          <div className="field">
            <label>Время публикации (локальное)</label>
            <div className="row">
              <input
                type="datetime-local"
                className="grow"
                value={composer.scheduleAt ? toLocalInput(composer.scheduleAt) : toLocalInput(Date.now() + 3600_000)}
                onChange={(e) => {
                  const value = new Date(e.target.value).getTime()
                  setSchedule(Number.isNaN(value) ? null : value)
                }}
              />
              <button
                className="btn small ghost"
                onClick={() => {
                  setSchedule(null)
                  setShowSchedule(false)
                }}
              >
                Сейчас
              </button>
            </div>
            <span className="hint">
              Telegram/X/Bluesky публикуются локальным планировщиком, Mastodon и Facebook — своим нативным.
            </span>
          </div>
        </div>
      )}

      {draftsOpen && <DraftsDialog onClose={() => setDraftsOpen(false)} />}
      {altTarget && <AltEditor mediaIds={altTarget.mediaIds} onClose={() => setAltTarget(null)} />}
    </div>
  )
}
