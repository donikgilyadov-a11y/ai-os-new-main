import { useEffect } from 'react'
import { useStore } from './store'
import TitleBar from './components/TitleBar'
import AccountBar from './components/AccountBar'
import TabBar from './components/TabBar'
import Toasts from './components/Toasts'
import MissedDialog from './components/MissedDialog'
import AccountWizard from './components/AccountWizard'
import Compose from './views/Compose'
import Queue from './views/Queue'
import History from './views/History'
import Pulse from './views/Pulse'
import Settings from './views/Settings'

export default function App(): JSX.Element {
  const ready = useStore((s) => s.ready)
  const tab = useStore((s) => s.tab)
  const init = useStore((s) => s.init)
  const wizardOpen = useStore((s) => s.wizard.open)

  useEffect(() => {
    void init()
  }, [init])

  return (
    <div className="app">
      <TitleBar />
      {ready && tab === 'compose' && <AccountBar />}
      <main className="main">
        {!ready ? null : tab === 'compose' ? (
          <Compose />
        ) : tab === 'queue' ? (
          <Queue />
        ) : tab === 'history' ? (
          <History />
        ) : tab === 'pulse' ? (
          <Pulse />
        ) : (
          <Settings />
        )}
      </main>
      <TabBar />
      <Toasts />
      <MissedDialog />
      {wizardOpen && <AccountWizard />}
    </div>
  )
}
