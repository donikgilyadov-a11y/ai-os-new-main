import { app, BrowserWindow, globalShortcut, Menu, nativeImage, Notification, safeStorage, session, shell, Tray } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { existsSync, writeFileSync } from 'node:fs'
import { store } from './store'
import { registerIpc } from './ipc'
import { Publisher } from './publisher'
import { registry } from './adapters'
import { applyProxy, isSafeExternalUrl } from './util'
import { setupUpdater } from './updater'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let registeredHotkey = ''

function trayIcon(): Electron.NativeImage {
  const candidates = [
    join(process.resourcesPath ?? '', 'tray.png'),
    join(app.getAppPath(), 'resources', 'tray.png'),
    join(process.resourcesPath ?? '', 'icon.png'),
    join(app.getAppPath(), 'resources', 'icon.png')
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const image = nativeImage.createFromPath(candidate)
      if (!image.isEmpty()) return image.resize({ width: 16, height: 16 })
    }
  }
  return nativeImage.createEmpty()
}

function appIconPath(): string | undefined {
  const candidates = [join(process.resourcesPath ?? '', 'icon.png'), join(app.getAppPath(), 'resources', 'icon.png')]
  return candidates.find((candidate) => candidate && existsSync(candidate))
}

function createWindow(): BrowserWindow {
  const rendererEntry = join(__dirname, '../renderer/index.html')
  const expectedRendererUrl = process.env['ELECTRON_RENDERER_URL'] ?? pathToFileURL(rendererEntry).href
  const win = new BrowserWindow({
    width: 460,
    height: 720,
    minWidth: 420,
    minHeight: 560,
    show: false,
    frame: false,
    backgroundColor: '#121316',
    title: 'Gridpost',
    icon: appIconPath(),
    alwaysOnTop: store.state.settings.pin,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.webContents.on('will-navigate', (event, url) => {
    try {
      const destination = new URL(url)
      const expected = new URL(expectedRendererUrl)
      const trusted = expected.protocol === 'file:'
        ? destination.protocol === 'file:' && destination.pathname === expected.pathname
        : destination.origin === expected.origin
      if (!trusted) event.preventDefault()
    } catch {
      event.preventDefault()
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(rendererEntry)
  }

  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })

  win.on('close', (event) => {
    if (store.state.settings.hideOnClose && !(app as unknown as { isQuitting?: boolean }).isQuitting) {
      event.preventDefault()
      win.hide()
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  return win
}

function toggleWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide()
  else {
    mainWindow.show()
    mainWindow.focus()
  }
}

function registerHotkey(accelerator: string): { ok: boolean; message?: string } {
  if (accelerator === registeredHotkey) return { ok: true }
  try {
    const ok = globalShortcut.register(accelerator, toggleWindow)
    if (ok) {
      if (registeredHotkey) globalShortcut.unregister(registeredHotkey)
      registeredHotkey = accelerator
      return { ok }
    }
    return { ok: false, message: 'Комбинация занята другой программой' }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
}

function buildTray(): void {
  tray = new Tray(trayIcon())
  tray.setToolTip('Gridpost — социальная сетка')
  const refresh = () => {
    const pending = store.state.records.filter((r) => r.results.some((x) => x.status === 'pending')).length
    const errors = store.state.records.filter((r) => r.results.some((x) => x.status === 'error')).length
    tray?.setToolTip(`Gridpost · в очереди: ${pending} · ошибок: ${errors}`)
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Открыть Gridpost', click: () => { mainWindow?.show(); mainWindow?.focus() } },
        { label: 'Скрыть', click: () => mainWindow?.hide() },
        { type: 'separator' },
        {
          label: 'Поверх всех окон',
          type: 'checkbox',
          checked: Boolean(store.state.settings.pin),
          click: (item) => {
            store.state.settings.pin = item.checked
            store.save()
            mainWindow?.setAlwaysOnTop(item.checked)
          }
        },
        { label: `В очереди: ${pending} · ошибок: ${errors}`, enabled: false },
        { type: 'separator' },
        {
          label: 'Выход',
          click: () => {
            ;(app as unknown as { isQuitting?: boolean }).isQuitting = true
            app.quit()
          }
        }
      ])
    )
  }
  refresh()
  setInterval(refresh, 15_000)
  tray.on('click', toggleWindow)
}

async function bootstrap(): Promise<void> {
  store.load()
  await registry.reload()
  for (const account of store.state.accounts) await applyProxy(account.partition, account.proxy)

  mainWindow = createWindow()
  const publisher = new Publisher(
    () => store.state,
    () => store.save(),
    (event, payload) => {
      if (!mainWindow) return
      if (event === 'records') mainWindow.webContents.send('records:changed', payload)
      else mainWindow.webContents.send('notice', payload)
    },
    (message) => {
      console.log('[publisher]', message)
      mainWindow?.webContents.send('log', message)
    }
  )
  publisher.start()

  registerIpc({
    getWindow: () => mainWindow,
    publisher,
    toggleWindow,
    registerHotkey,
    resendState: () => mainWindow?.webContents.send('state:changed', publicState())
  })

  setupUpdater(
    () => mainWindow,
    (message) => {
      console.log('[updater]', message)
      mainWindow?.webContents.send('log', message)
    }
  )

  registerHotkey(store.state.settings.hotkey)
  buildTray()

  if (store.state.settings.pin) mainWindow.setAlwaysOnTop(true)

  if (process.argv.includes('--hidden')) mainWindow.hide()

  const shotPath = process.env.GRIDPOST_SHOT
  if (shotPath) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const image = await mainWindow!.webContents.capturePage()
          writeFileSync(shotPath, image.toPNG())
          console.log('[gridpost] screenshot saved', shotPath)
        } catch (error) {
          console.error('[gridpost] screenshot failed', error)
        }
      }, 2500)
    })
  }
}

export function publicState(): unknown {
  return {
    ...store.state,
    plugins: registry.plugins,
    encrypted: safeStorage.isEncryptionAvailable()
  }
}

app.whenReady().then(async () => {
  app.setAppUserModelId('app.gridpost.desktop')
  app.setName('Gridpost')
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }
  app.on('second-instance', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })

  // Proxy authentication for account-scoped sessions.
  app.on('login', (event, webContents, _details, authInfo, callback) => {
    if (!authInfo.isProxy) return
    const account = store.state.accounts.find((a) => a.proxy?.enabled && webContents.session === session.fromPartition(a.partition))
    if (account?.proxy?.username) {
      event.preventDefault()
      callback(account.proxy.username, account.proxy.password ?? '')
    }
  })

  await bootstrap()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    else mainWindow?.show()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Keep running in tray; explicit quit is handled from the tray menu.
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('before-quit', () => {
  ;(app as unknown as { isQuitting?: boolean }).isQuitting = true
})

export { Notification }
