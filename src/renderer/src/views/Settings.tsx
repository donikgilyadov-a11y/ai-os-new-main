import { useEffect, useRef, useState } from 'react'
import {
  Check,
  FolderOpen,
  Keyboard,
  Loader2,
  Plus,
  Puzzle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users
} from 'lucide-react'
import type { AccountGroup, Alias, Settings as SettingsModel } from '@shared/types'
import { useStore } from '../store'

export default function Settings(): JSX.Element {
  const data = useStore((s) => s.data)
  const platforms = useStore((s) => s.platforms)
  const openWizard = useStore((s) => s.openWizard)

  if (!data) return <div className="scroll" />
  const settings = data.settings

  const update = async (patch: Partial<SettingsModel>): Promise<void> => {
    await window.gridpost.updateSettings(patch)
  }

  return (
    <div className="scroll">
      <AccountsSection />
      <GroupsSection />
      <AliasesSection />
      <AiSection />
      <WindowSection settings={settings} update={update} />
      <PluginsSection />
      <DataSection />
      {!data.accounts.length && (
        <div className="empty" style={{ padding: 16 }}>
          <button className="btn primary" onClick={() => openWizard(null)}>
            <Plus size={13} /> Добавить первый аккаунт
          </button>
          <span className="dim">Платформы: {platforms.map((p) => p.name).join(', ')}</span>
        </div>
      )}
    </div>
  )
}

function AccountsSection(): JSX.Element {
  const data = useStore((s) => s.data)
  const openWizard = useStore((s) => s.openWizard)
  const toast = useStore((s) => s.toast)
  const platforms = useStore((s) => s.platforms)

  return (
    <div className="card-block">
      <h3>Аккаунты</h3>
      {(data?.accounts ?? []).map((account) => {
        const platform = platforms.find((p) => p.id === account.platform)
        return (
          <div className="account-row" key={account.id}>
            <span className="account-avatar" style={{ background: account.color }}>
              {account.lang.slice(0, 2)}
            </span>
            <div className="account-meta">
              <div className="name">{account.name}</div>
              <div className="sub">
                {platform?.name ?? account.platform} · {account.method === 'session' ? 'webview' : 'api'}
                {account.proxy?.enabled ? ' · proxy' : ''}
              </div>
            </div>
            <span className={`pill ${account.status === 'ok' ? 'ok' : account.status === 'error' ? 'err' : ''}`}>
              {account.status === 'ok' ? 'ok' : account.status === 'error' ? 'err' : '—'}
            </span>
            <button
              className="mini-btn"
              onClick={async () => {
                const res = (await window.gridpost.testAccount(account.id)) as { ok: boolean; message?: string }
                toast(res.ok ? `${account.name}: ${res.message ?? 'ok'}` : `${account.name}: ${res.message}`, res.ok ? 'info' : 'error')
              }}
            >
              тест
            </button>
            <button className="mini-btn" onClick={() => openWizard(account.id)}>
              изменить
            </button>
          </div>
        )
      })}
      <button className="mini-btn" style={{ marginTop: 6 }} onClick={() => openWizard(null)}>
        <Plus size={11} /> Добавить аккаунт
      </button>
    </div>
  )
}

function GroupsSection(): JSX.Element {
  const data = useStore((s) => s.data)
  const toast = useStore((s) => s.toast)
  const [name, setName] = useState('')
  const [ids, setIds] = useState<string[]>([])

  const save = async (): Promise<void> => {
    if (!name.trim() || !ids.length) {
      toast('Укажите название и выберите аккаунты', 'error')
      return
    }
    const group: AccountGroup = { id: `group_${Date.now()}`, name: name.trim(), accountIds: ids }
    await window.gridpost.saveGroup(group)
    setName('')
    setIds([])
    toast('Пресет сохранён')
  }

  return (
    <div className="card-block">
      <h3>
        <Users size={11} style={{ verticalAlign: '-1px' }} /> Пресеты аккаунтов
      </h3>
      {(data?.groups ?? []).map((group) => (
        <div className="account-row" key={group.id}>
          <div className="account-meta">
            <div className="name">{group.name}</div>
            <div className="sub">{group.accountIds.length} аккаунтов</div>
          </div>
          <button className="mini-btn" onClick={() => void window.gridpost.removeGroup(group.id)}>
            <Trash2 size={10} />
          </button>
        </div>
      ))}
      <div className="field" style={{ marginTop: 8 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название пресета" />
      </div>
      <div className="account-scroll" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
        {(data?.accounts ?? []).map((account) => (
          <button
            key={account.id}
            className={`chip ${ids.includes(account.id) ? 'on' : ''}`}
            onClick={() => setIds(ids.includes(account.id) ? ids.filter((x) => x !== account.id) : [...ids, account.id])}
          >
            <span className="dot" style={{ background: account.color }} />
            {account.name}
          </button>
        ))}
      </div>
      <button className="mini-btn" style={{ marginTop: 7 }} onClick={() => void save()}>
        <Plus size={11} /> Сохранить пресет
      </button>
    </div>
  )
}

function AliasesSection(): JSX.Element {
  const data = useStore((s) => s.data)
  const platforms = useStore((s) => s.platforms)
  const toast = useStore((s) => s.toast)
  const [token, setToken] = useState('')
  const [platform, setPlatform] = useState('x')
  const [value, setValue] = useState('')

  const add = async (): Promise<void> => {
    if (!token.trim() || !value.trim()) {
      toast('Нужны токен и значение', 'error')
      return
    }
    const clean = token.replace(/[{}]/g, '').trim()
    const existing = data?.aliases.find((a) => a.token === clean)
    const alias: Alias = existing
      ? { ...existing, values: { ...existing.values, [platform]: value.trim() } }
      : { id: `alias_${Date.now()}`, token: clean, values: { [platform]: value.trim() } }
    await window.gridpost.saveAlias(alias)
    setToken('')
    setValue('')
    toast('Алиас сохранён')
  }

  return (
    <div className="card-block">
      <h3>Умные алиасы</h3>
      <div className="dim" style={{ marginBottom: 8 }}>
        Пишите <span className="mono">{'{lead}'}</span> в тексте — при отправке подставится значение под каждую площадку.
      </div>
      {(data?.aliases ?? []).map((alias) => (
        <div className="account-row" key={alias.id} style={{ alignItems: 'flex-start' }}>
          <div className="account-meta">
            <div className="name mono">{`{${alias.token}}`}</div>
            <div className="sub" style={{ whiteSpace: 'normal' }}>
              {Object.entries(alias.values)
                .map(([k, v]) => `${k}: ${v}`)
                .join(' · ')}
            </div>
          </div>
          <button className="mini-btn" onClick={() => void window.gridpost.removeAlias(alias.id)}>
            <Trash2 size={10} />
          </button>
        </div>
      ))}
      <div className="row" style={{ marginTop: 8 }}>
        <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="lead" style={{ maxWidth: 90 }} />
        <select value={platform} onChange={(e) => setPlatform(e.target.value)} style={{ maxWidth: 110 }}>
          {platforms.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="@handle или ссылка" className="grow" />
        <button className="mini-btn" onClick={() => void add()}>
          <Plus size={11} />
        </button>
      </div>
    </div>
  )
}

function AiSection(): JSX.Element {
  const data = useStore((s) => s.data)
  const toast = useStore((s) => s.toast)
  const [testing, setTesting] = useState(false)
  if (!data) return <></>
  const ai = data.settings.ai

  const patch = (next: Partial<typeof ai>): void => {
    void window.gridpost.updateSettings({ ai: { ...ai, ...next } })
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    try {
      const res = (await window.gridpost.checkAi()) as { ok: boolean; message: string }
      toast(res.ok ? `Провайдер отвечает: ${res.message}` : `AI недоступен: ${res.message}`, res.ok ? 'info' : 'error')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="card-block">
      <h3>
        <Sparkles size={11} style={{ verticalAlign: '-1px' }} /> AI-переводчик
      </h3>
      <div className="field">
        <label>Провайдер</label>
        <select value={ai.provider} onChange={(e) => patch({ provider: e.target.value as typeof ai.provider })}>
          <option value="none">Отключён</option>
          <option value="ollama">Ollama (локально)</option>
          <option value="openai">OpenAI-совместимый API</option>
        </select>
      </div>
      {ai.provider !== 'none' && (
        <>
          <div className="field">
            <label>Base URL</label>
            <input value={ai.baseUrl} onChange={(e) => patch({ baseUrl: e.target.value })} placeholder="http://localhost:11434" />
          </div>
          <div className="field">
            <label>Модель</label>
            <input value={ai.model} onChange={(e) => patch({ model: e.target.value })} placeholder="qwen2.5:7b" />
          </div>
          {ai.provider === 'openai' && (
            <div className="field">
              <label>API key</label>
              <input type="password" value={ai.apiKey} onChange={(e) => patch({ apiKey: e.target.value })} />
            </div>
          )}
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="dim">Адаптация тона под площадку</span>
            <button className={`switch ${ai.toneAdaptation ? 'on' : ''}`} onClick={() => patch({ toneAdaptation: !ai.toneAdaptation })} />
          </div>
          <button className="mini-btn" style={{ marginTop: 8 }} onClick={() => void test()} disabled={testing}>
            {testing ? <Loader2 size={11} className="spin" /> : <Check size={11} />} Проверить
          </button>
        </>
      )}
    </div>
  )
}

function WindowSection({ settings, update }: { settings: SettingsModel; update: (p: Partial<SettingsModel>) => Promise<void> }): JSX.Element {
  const [capture, setCapture] = useState(false)
  const [hotkey, setHotkey] = useState(settings.hotkey)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => setHotkey(settings.hotkey), [settings.hotkey])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!capture) return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      setCapture(false)
      return
    }
    const mods: string[] = []
    if (e.ctrlKey) mods.push('Control')
    if (e.altKey) mods.push('Alt')
    if (e.shiftKey) mods.push('Shift')
    if (e.metaKey) mods.push('Super')
    const key = e.key.length === 1 ? e.key.toUpperCase() : e.key
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return
    const combo = [...mods, key === ' ' ? 'Space' : key].join('+')
    setHotkey(combo)
    setCapture(false)
    void update({ hotkey: combo })
  }

  return (
    <div className="card-block" onKeyDown={onKeyDown}>
      <h3>
        <Keyboard size={11} style={{ verticalAlign: '-1px' }} /> Окно и поведение
      </h3>
      <div className="field">
        <label>Глобальная горячая клавиша</label>
        <div className="row">
          <input
            ref={ref}
            value={capture ? 'Нажмите комбинацию…' : hotkey}
            readOnly
            onClick={() => setCapture(true)}
            className="mono grow"
            style={{ cursor: 'pointer' }}
          />
          <button className="mini-btn" onClick={() => setCapture(true)}>
            задать
          </button>
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="dim">Поверх всех окон</span>
        <button className={`switch ${settings.pin ? 'on' : ''}`} onClick={() => void update({ pin: !settings.pin })} />
      </div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="dim">Скрывать в трей при закрытии</span>
        <button className={`switch ${settings.hideOnClose ? 'on' : ''}`} onClick={() => void update({ hideOnClose: !settings.hideOnClose })} />
      </div>
      <div className="row">
        <div className="field grow">
          <label>Jitter, сек (мин)</label>
          <input
            type="number"
            value={settings.jitterMinSec}
            min={0}
            onChange={(e) => void update({ jitterMinSec: Number(e.target.value) })}
          />
        </div>
        <div className="field grow">
          <label>Jitter, сек (макс)</label>
          <input
            type="number"
            value={settings.jitterMaxSec}
            min={0}
            onChange={(e) => void update({ jitterMaxSec: Number(e.target.value) })}
          />
        </div>
      </div>
      <div className="hint">Пауза между отправками в аккаунты одной площадки — защита от антифрод-блокировок.</div>
    </div>
  )
}

function PluginsSection(): JSX.Element {
  const data = useStore((s) => s.data)
  const toast = useStore((s) => s.toast)

  return (
    <div className="card-block">
      <h3>
        <Puzzle size={11} style={{ verticalAlign: '-1px' }} /> Плагины
      </h3>
      {(data?.plugins ?? []).map((plugin) => (
        <div className="account-row" key={plugin.id}>
          <div className="account-meta">
            <div className="name">{plugin.name}</div>
            <div className="sub">
              {plugin.id} · v{plugin.version} · {plugin.source}
              {plugin.error ? ` · ${plugin.error}` : ''}
            </div>
          </div>
          <span className={`pill ${plugin.error ? 'err' : ''}`}>{plugin.error ? 'error' : plugin.enabled ? 'on' : 'off'}</span>
          <button
            className={`switch ${plugin.enabled ? 'on' : ''}`}
            onClick={() => void window.gridpost.togglePlugin(plugin.id, !plugin.enabled)}
          />
        </div>
      ))}
      {!data?.plugins.length && <div className="dim">Плагины не найдены</div>}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="mini-btn" onClick={() => void window.gridpost.reloadPlugins()}>
          <RefreshCw size={10} /> перезагрузить
        </button>
        <button
          className="mini-btn"
          onClick={async () => {
            const dir = (await window.gridpost.openPluginsDir()) as string
            toast(`Папка плагинов: ${dir}`)
          }}
        >
          <FolderOpen size={10} /> папка
        </button>
      </div>
    </div>
  )
}

function DataSection(): JSX.Element {
  const encrypted = useStore((s) => s.encrypted)
  const logs = useStore((s) => s.logs)
  const [info, setInfo] = useState<{ storePath: string; userData: string } | null>(null)

  useEffect(() => {
    void window.gridpost.appInfo().then((i) => setInfo(i as { storePath: string; userData: string }))
  }, [])

  return (
    <div className="card-block">
      <h3>
        <ShieldCheck size={11} style={{ verticalAlign: '-1px' }} /> Данные
      </h3>
      <div className="dim" style={{ fontSize: 10.5 }}>
        Токены, cookies и черновики хранятся только на этом устройстве.{' '}
        {encrypted ? 'Хранилище зашифровано системным ключом ОС.' : 'Системное шифрование недоступно — файл сохранён в base64.'}
      </div>
      <div className="mono dim" style={{ fontSize: 9, marginTop: 6, wordBreak: 'break-all' }}>
        {info?.storePath}
      </div>
      {logs.length > 0 && (
        <>
          <div className="divider" />
          <div className="section-title" style={{ marginBottom: 4 }}>
            Журнал
          </div>
          <div className="mono" style={{ fontSize: 9, color: 'var(--text-faint)', maxHeight: 110, overflowY: 'auto' }}>
            {logs.slice(0, 30).map((line, index) => (
              <div key={index}>{line}</div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
