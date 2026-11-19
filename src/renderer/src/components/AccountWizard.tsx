import { useMemo, useState } from 'react'
import { Check, Loader2, LogIn, Plus, Trash2, X } from 'lucide-react'
import type { Account } from '@shared/types'
import { useStore } from '../store'
import Modal from './Modal'
import { platformShort } from '../lib/platform'

const COLORS = ['#7c9cff', '#4cc38a', '#e0a04a', '#e06c75', '#c678dd', '#56b6c2', '#98c379', '#ff8fa3']

export default function AccountWizard(): JSX.Element {
  const data = useStore((s) => s.data)
  const platforms = useStore((s) => s.platforms)
  const closeWizard = useStore((s) => s.closeWizard)
  const editingId = useStore((s) => s.wizard.editId)
  const toast = useStore((s) => s.toast)
  const existing = data?.accounts.find((a) => a.id === editingId)

  const [platform, setPlatform] = useState(existing?.platform ?? platforms[0]?.id ?? 'x')
  const [method, setMethod] = useState<'api' | 'session'>(existing?.method ?? 'api')
  const [name, setName] = useState(existing?.name ?? '')
  const [lang, setLang] = useState(existing?.lang ?? 'EN')
  const [color, setColor] = useState(existing?.color ?? COLORS[0])
  const [credentials, setCredentials] = useState<Record<string, string>>(existing?.credentials ?? {})
  const [proxyUrl, setProxyUrl] = useState(existing?.proxy?.url ?? '')
  const [proxyUser, setProxyUser] = useState(existing?.proxy?.username ?? '')
  const [proxyPass, setProxyPass] = useState(existing?.proxy?.password ?? '')
  const [proxyOn, setProxyOn] = useState(Boolean(existing?.proxy?.enabled))
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null)

  const info = useMemo(() => platforms.find((p) => p.id === platform), [platforms, platform])
  const fields = info?.credentialFields ?? []

  const save = async (): Promise<void> => {
    if (!name.trim()) {
      toast('Дайте аккаунту имя', 'error')
      return
    }
    const payload = {
      platform,
      method,
      name: name.trim(),
      lang: lang.trim().toUpperCase() || 'EN',
      color,
      credentials,
      proxy: { enabled: proxyOn, url: proxyUrl, username: proxyUser, password: proxyPass }
    }
    setBusy('save')
    try {
      if (existing) {
        await window.gridpost.updateAccount(existing.id, payload)
        toast('Аккаунт обновлён')
      } else {
        const created = (await window.gridpost.addAccount(payload)) as Account
        const current = useStore.getState().selected
        useStore.getState().setSelected([...current, created.id])
        toast('Аккаунт добавлен')
      }
      closeWizard()
    } catch (error) {
      toast((error as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const saveAndTest = async (): Promise<void> => {
    if (!existing) {
      toast('Сначала сохраните аккаунт, затем проверьте подключение', 'error')
      return
    }
    setBusy('test')
    try {
      const res = (await window.gridpost.testAccount(existing.id)) as { ok: boolean; message?: string }
      setResult(res)
      toast(res.ok ? `Подключение работает: ${res.message ?? ''}` : `Ошибка: ${res.message ?? ''}`, res.ok ? 'info' : 'error')
    } finally {
      setBusy(null)
    }
  }

  const loginWebview = async (): Promise<void> => {
    let id = existing?.id
    if (!id) {
      setBusy('login')
      try {
        const created = (await window.gridpost.addAccount({
          platform,
          method: 'session',
          name: name.trim() || `${info?.name ?? platform} session`,
          lang,
          color,
          credentials,
          proxy: { enabled: proxyOn, url: proxyUrl, username: proxyUser, password: proxyPass }
        })) as Account
        id = created.id
      } catch (error) {
        toast((error as Error).message, 'error')
        setBusy(null)
        return
      }
    }
    setBusy('login')
    try {
      const res = (await window.gridpost.loginAccount(id)) as { ok: boolean; cookies: number }
      toast(`Сессия сохранена (${res.cookies} cookies)`)
      setMethod('session')
      closeWizard()
    } catch (error) {
      toast(`Вход не завершён: ${(error as Error).message}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal
      title={existing ? 'Аккаунт' : 'Новый аккаунт'}
      onClose={closeWizard}
      footer={
        <>
          <button className="btn primary grow" onClick={() => void save()} disabled={busy !== null}>
            {busy === 'save' ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
            Сохранить
          </button>
          {existing && (
            <button className="btn ghost" onClick={() => void saveAndTest()} disabled={busy !== null}>
              {busy === 'test' ? <Loader2 size={13} className="spin" /> : 'Проверить'}
            </button>
          )}
          <button className="btn ghost" onClick={closeWizard}>
            <X size={13} />
          </button>
        </>
      }
    >
      {!existing && (
        <>
          <div className="section-title">Платформа</div>
          <div className="platform-grid">
            {platforms.map((item) => (
              <button
                key={item.id}
                className={`platform-tile ${platform === item.id ? 'on' : ''}`}
                onClick={() => {
                  setPlatform(item.id)
                  setCredentials({})
                }}
              >
                <span className="glyph" style={{ background: item.color }}>
                  {platformShort(item.id)}
                </span>
                {item.name}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="row" style={{ marginBottom: 9 }}>
        <div className="seg grow">
          <button className={method === 'api' ? 'on' : ''} onClick={() => setMethod('api')} style={{ flex: 1 }}>
            API-ключ
          </button>
          <button className={method === 'session' ? 'on' : ''} onClick={() => setMethod('session')} style={{ flex: 1 }}>
            {info?.loginUrl ? 'WebView' : 'WebView'}
          </button>
        </div>
      </div>

      <div className="field">
        <label>Название</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: X · EN продукт" />
      </div>
      <div className="row">
        <div className="field grow">
          <label>Язык</label>
          <input value={lang} onChange={(e) => setLang(e.target.value.toUpperCase())} maxLength={4} placeholder="EN" />
        </div>
        <div className="field grow">
          <label>Цвет метки</label>
          <div className="color-row">
            {COLORS.map((c) => (
              <button
                key={c}
                className={`color-swatch ${color === c ? 'on' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>
      </div>

      {method === 'api' ? (
        <>
          {fields.map((field) => (
            <div className="field" key={field.key}>
              <label>{field.label}</label>
              <input
                type={field.secret ? 'password' : 'text'}
                value={credentials[field.key] ?? ''}
                placeholder={field.placeholder}
                onChange={(e) => setCredentials({ ...credentials, [field.key]: e.target.value })}
              />
              {field.hint && <span className="hint">{field.hint}</span>}
            </div>
          ))}
          {!fields.length && <div className="dim">Плагин не описывает поля: добавьте ключи вручную в конфиг.</div>}
        </>
      ) : (
        <div className="card-block" style={{ marginBottom: 8 }}>
          <div className="dim" style={{ marginBottom: 8 }}>
            Откроется изолированное окно с отдельными cookies и прокси этого аккаунта. После входа сессия сохранится
            локально в зашифрованном виде.
          </div>
          <button className="btn" onClick={() => void loginWebview()} disabled={busy !== null}>
            {busy === 'login' ? <Loader2 size={13} className="spin" /> : <LogIn size={13} />}
            Войти через WebView
          </button>
          {!info?.loginUrl && <div className="hint" style={{ marginTop: 6 }}>Платформа не объявила loginUrl — откроется пустая страница.</div>}
        </div>
      )}

      <div className="divider" />
      <div className="row" style={{ marginBottom: 6 }}>
        <span className="section-title" style={{ margin: 0 }}>
          Прокси
        </span>
        <span className="spacer" />
        <button className={`switch ${proxyOn ? 'on' : ''}`} onClick={() => setProxyOn(!proxyOn)} />
      </div>
      {proxyOn && (
        <>
          <div className="field">
            <input
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              placeholder="socks5://127.0.0.1:1080 или http://host:port"
            />
            <span className="hint">Отдельный прокси для каждого аккаунта — критично для нескольких профилей одной сети.</span>
          </div>
          <div className="row">
            <input value={proxyUser} onChange={(e) => setProxyUser(e.target.value)} placeholder="логин" />
            <input value={proxyPass} onChange={(e) => setProxyPass(e.target.value)} placeholder="пароль" type="password" />
          </div>
        </>
      )}

      {result && (
        <div className={`pill ${result.ok ? 'ok' : 'err'}`} style={{ marginTop: 10 }}>
          {result.ok ? 'подключено' : 'ошибка'} · {result.message}
        </div>
      )}

      {existing && (
        <button
          className="btn danger small"
          style={{ marginTop: 10 }}
          onClick={async () => {
            await window.gridpost.removeAccount(existing.id)
            toast('Аккаунт удалён')
            closeWizard()
          }}
        >
          <Trash2 size={12} /> Удалить аккаунт
        </button>
      )}
      {!existing && (
        <div className="dim" style={{ marginTop: 10, fontSize: 10 }}>
          <Plus size={10} style={{ verticalAlign: '-1px' }} /> Совет: добавляйте аккаунты по одному на язык, чтобы
          использовать языковые вкладки.
        </div>
      )}
    </Modal>
  )
}
