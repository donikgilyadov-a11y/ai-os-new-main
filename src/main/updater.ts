import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '@shared/types'

export type { UpdateState } from '@shared/types'

let state: UpdateState = { status: 'idle' }
let getWindow: () => BrowserWindow | null = () => null
let enabled = false

function set(patch: Partial<UpdateState>): UpdateState {
  state = { ...state, ...patch }
  getWindow()?.webContents.send('update:state', state)
  return state
}

export function setupUpdater(win: () => BrowserWindow | null, log: (message: string) => void): void {
  getWindow = win
  // github.com releases are only reachable from a packaged Windows build.
  if (!app.isPackaged || process.platform !== 'win32') {
    state = { status: 'dev' }
    getWindow()?.webContents.send('update:state', state)
    return
  }
  enabled = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.logger = {
    info: (message: unknown) => log(String(message)),
    warn: (message: unknown) => log(String(message)),
    error: (message: unknown) => log(String(message)),
    debug: () => undefined
  } as unknown as typeof autoUpdater.logger

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: undefined }))
  autoUpdater.on('update-available', (info) => set({ status: 'available', version: info.version, error: undefined }))
  autoUpdater.on('update-not-available', (info) => set({ status: 'not-available', version: info.version }))
  autoUpdater.on('download-progress', (progress) =>
    set({ status: 'downloading', progress: Math.round(progress.percent) })
  )
  autoUpdater.on('update-downloaded', (info) => set({ status: 'downloaded', version: info.version, progress: 100 }))
  autoUpdater.on('error', (error) => set({ status: 'error', error: error.message }))

  setTimeout(() => void check(), 30_000).unref()
}

export function updateState(): UpdateState {
  return state
}

export async function check(): Promise<UpdateState> {
  if (!enabled) return state
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    set({ status: 'error', error: (error as Error).message })
  }
  return state
}

export async function download(): Promise<UpdateState> {
  if (!enabled) return state
  set({ status: 'downloading', progress: 0, error: undefined })
  try {
    await autoUpdater.downloadUpdate()
  } catch (error) {
    set({ status: 'error', error: (error as Error).message })
  }
  return state
}

export function install(): boolean {
  if (!enabled) return false
  autoUpdater.quitAndInstall(false, true)
  return true
}
