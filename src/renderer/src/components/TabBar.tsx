import { Activity, ListOrdered, PenLine, Settings as SettingsIcon } from 'lucide-react'
import { useStore, type TabId } from '../store'

export default function TabBar(): JSX.Element {
  const tab = useStore((s) => s.tab)
  const setTab = useStore((s) => s.setTab)
  const storedRecords = useStore((s) => s.data?.records)
  const records = storedRecords ?? []

  const pending = records.filter((r) => r.scheduledAt && r.results.some((x) => x.status === 'pending')).length
  const errors = records.filter((r) => r.results.some((x) => x.status === 'error')).length

  const tabs: { id: TabId; label: string; icon: JSX.Element; badge?: number; err?: boolean }[] = [
    { id: 'compose', label: 'Пост', icon: <PenLine size={17} /> },
    { id: 'queue', label: 'Очередь', icon: <ListOrdered size={17} />, badge: pending || errors, err: !pending && Boolean(errors) },
    { id: 'pulse', label: 'Пульс', icon: <Activity size={17} /> },
    { id: 'settings', label: 'Настройки', icon: <SettingsIcon size={17} /> }
  ]

  return (
    <nav className="tabbar">
      {tabs.map((item) => (
        <button key={item.id} className={`tab ${tab === item.id ? 'on' : ''}`} onClick={() => setTab(item.id)}>
          {item.icon}
          <span>{item.label}</span>
          {item.badge ? <span className={`tab-badge ${item.err ? 'err' : ''}`}>{item.badge}</span> : null}
        </button>
      ))}
    </nav>
  )
}
