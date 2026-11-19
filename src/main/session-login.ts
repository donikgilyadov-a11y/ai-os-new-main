import { BrowserWindow, session as electronSession } from 'electron'
import type { Account } from '@shared/types'
import { applyProxy, sleep } from './util'

export interface SessionResult {
  cookies: string
  map: Record<string, string>
  url: string
}

/**
 * Opens an isolated browser window for the account (its own partition,
 * cookies, cache and proxy) and waits until the platform session cookies
 * appear. The captured cookie string is stored encrypted by the caller.
 */
export async function captureSession(
  account: Account,
  url: string,
  requiredCookies: string[]
): Promise<SessionResult> {
  await applyProxy(account.partition, account.proxy)
  const ses = electronSession.fromPartition(account.partition)
  await ses.clearStorageData({ storages: ['cookies'] }).catch(() => undefined)

  const win = new BrowserWindow({
    width: 980,
    height: 760,
    title: `Вход · ${account.name}`,
    autoHideMenuBar: true,
    backgroundColor: '#121316',
    webPreferences: {
      partition: account.partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })
  win.setMenuBarVisibility(false)

  try {
    await win.loadURL(url)
  } catch {
    /* user may navigate manually */
  }

  const deadline = Date.now() + 5 * 60_000
  return new Promise<SessionResult>((resolve, reject) => {
    let done = false
    const finish = async (reason?: string) => {
      if (done) return
      done = true
      clearInterval(poll)
      if (reason) {
        if (!win.isDestroyed()) win.destroy()
        reject(new Error(reason))
        return
      }
      const cookies = await ses.cookies.get({})
      const map: Record<string, string> = {}
      for (const cookie of cookies) map[cookie.name] = cookie.value
      const serialized = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
      const finalUrl = win.webContents.getURL()
      if (!win.isDestroyed()) win.destroy()
      resolve({ cookies: serialized, map, url: finalUrl })
    }

    const poll = setInterval(async () => {
      if (win.isDestroyed()) return finish('Окно входа закрыто')
      if (Date.now() > deadline) return finish('Время ожидания входа истекло (5 минут)')
      try {
        const cookies = await ses.cookies.get({})
        const names = new Set(cookies.map((c) => c.name))
        if (requiredCookies.length && requiredCookies.every((name) => names.has(name))) {
          await sleep(700)
          void finish()
        }
      } catch {
        /* keep polling */
      }
    }, 1500)

    win.on('closed', () => {
      if (!done) finish('Окно входа закрыто до завершения авторизации')
    })
  })
}
