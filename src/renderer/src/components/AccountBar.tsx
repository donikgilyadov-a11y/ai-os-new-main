import { Plus, Users } from 'lucide-react'
import { useStore } from '../store'
import { platformShort } from '../lib/platform'

export default function AccountBar(): JSX.Element {
  const data = useStore((s) => s.data)
  const selected = useStore((s) => s.selected)
  const toggle = useStore((s) => s.toggleAccount)
  const applyGroup = useStore((s) => s.applyGroup)
  const openWizard = useStore((s) => s.openWizard)

  if (!data) return <div className="account-bar" />

  const accounts = data.accounts

  if (!accounts.length) {
    return (
      <div className="account-bar">
        <div className="bar-row">
          <span>Аккаунтов пока нет</span>
          <span className="spacer" />
          <button className="mini-btn" onClick={() => openWizard(null)}>
            <Plus size={11} /> Добавить аккаунт
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="account-bar">
      <div className="account-scroll">
        {accounts.map((account) => {
          const on = selected.includes(account.id)
          return (
            <button
              key={account.id}
              className={`chip ${on ? 'on' : ''}`}
              onClick={() => toggle(account.id)}
              title={`${account.name} · ${account.platform}`}
            >
              <span className="dot" style={{ background: account.color, color: account.color }} />
              <span className="plat">{platformShort(account.platform)}</span>
              <span className="acct-name">{account.name}</span>
              <span className="lang">{account.lang}</span>
            </button>
          )
        })}
        <button className="chip" onClick={() => openWizard(null)} title="Добавить аккаунт">
          <Plus size={13} />
        </button>
      </div>
      <div className="bar-row">
        <span>{selected.length} из {accounts.length} выбрано</span>
        <span className="spacer" />
        {data.groups.slice(0, 3).map((group) => (
          <button key={group.id} className="mini-btn" onClick={() => applyGroup(group.accountIds)} title="Применить пресет">
            <Users size={10} /> {group.name}
          </button>
        ))}
        {accounts.length > 1 && (
          <button
            className="mini-btn"
            onClick={() => applyGroup(selected.length === accounts.length ? [] : accounts.map((a) => a.id))}
          >
            {selected.length === accounts.length ? 'Снять все' : 'Все'}
          </button>
        )}
      </div>
    </div>
  )
}
