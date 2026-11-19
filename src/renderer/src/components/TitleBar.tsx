import { useEffect, useState } from 'react'
import { Minus, Pin, ShieldCheck, X } from 'lucide-react'
import { useStore } from '../store'

export default function TitleBar(): JSX.Element {
  const data = useStore((s) => s.data)
  const encrypted = useStore((s) => s.encrypted)
  const [pin, setPin] = useState(false)
  const [version, setVersion] = useState('0.1.0')

  useEffect(() => {
    if (data) setPin(data.settings.pin)
    void window.gridpost.appInfo().then((info) => setVersion((info as { version: string }).version))
  }, [data])

  const togglePin = async (): Promise<void> => {
    const next = !pin
    setPin(next)
    await window.gridpost.pinWindow(next)
  }

  return (
    <header className="titlebar">
      <div className="brand">
        <span className="brand-mark">G</span>
        Gridpost
      </div>
      <span className="brand-dot">v{version}</span>
      <div className="titlebar-spacer" />
      {encrypted ? (
        <span className="pill ok" title="Хранилище зашифровано системным ключом ОС">
          <ShieldCheck size={10} style={{ verticalAlign: '-1px' }} /> local
        </span>
      ) : (
        <span className="pill err" title="Системное шифрование недоступно">
          plain
        </span>
      )}
      <div className="win-actions">
        <button className={`icon-btn ${pin ? 'active' : ''}`} title="Поверх всех окон" onClick={togglePin}>
          <Pin size={13} />
        </button>
        <button className="icon-btn" title="Свернуть" onClick={() => void window.gridpost.minimizeWindow()}>
          <Minus size={14} />
        </button>
        <button className="icon-btn" title="Скрыть в трей" onClick={() => void window.gridpost.hideWindow()}>
          <X size={14} />
        </button>
      </div>
    </header>
  )
}
