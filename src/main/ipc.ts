import { app, dialog, ipcMain, Notification, safeStorage, shell } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  Account,
  AccountGroup,
  Alias,
  AppState,
  Draft,
  MediaItem,
  ProxyConfig,
  Settings,
  ThreadPost,
  TranslateRequest
} from '@shared/types'
import { accountSession, applyProxy, newId, scopedFetch } from './util'
import { store } from './store'
import { registry } from './adapters'
import { importMediaFile } from './media'
import { captureSession } from './session-login'
import { encryptString, decryptString, isEncrypted } from './crypto'
import { buildHistoryCsv } from './history-csv'
import { translateText, checkProvider } from './ai'
import type { Publisher } from './publisher'

interface Deps {
  getWindow: () => Electron.BrowserWindow | null
  publisher: Publisher
  toggleWindow: () => void
  registerHotkey: (accelerator: string) => { ok: boolean; message?: string }
  resendState: () => void
}

const logs: string[] = []

function log(message: string): void {
  logs.unshift(`${new Date().toLocaleTimeString()} · ${message}`)
  logs.splice(400)
  console.log('[ipc]', message)
}

function state(): AppState {
  return store.state
}

function withPlugins(): AppState & { encrypted: boolean } {
  return { ...store.state, plugins: registry.plugins, encrypted: safeStorage.isEncryptionAvailable() }
}

export function registerIpc(deps: Deps): void {
  const notify = (text: string) => {
    deps.getWindow()?.webContents.send('toast', text)
  }

  ipcMain.handle('state:get', () => withPlugins())

  ipcMain.handle('state:refresh', () => {
    deps.resendState()
    return withPlugins()
  })

  ipcMain.handle('settings:update', (_event, patch: Partial<Settings>) => {
    const settings = state().settings
    if (patch.ai) patch.ai = { ...settings.ai, ...patch.ai }
    state().settings = { ...settings, ...patch }
    store.save()
    deps.getWindow()?.setAlwaysOnTop(state().settings.pin)
    if (patch.hotkey) {
      const result = deps.registerHotkey(state().settings.hotkey)
      if (!result.ok) notify(`Горячая клавиша не зарегистрирована: ${result.message ?? ''}`)
    }
    deps.resendState()
    return withPlugins()
  })

  ipcMain.handle('accounts:add', async (_event, payload: Partial<Account>) => {
    const id = newId('acct')
    const account: Account = {
      id,
      platform: payload.platform ?? 'x',
      method: payload.method ?? 'api',
      name: payload.name ?? 'Новый аккаунт',
      lang: (payload.lang ?? 'EN').toUpperCase(),
      color: payload.color ?? '#8b93a7',
      credentials: payload.credentials ?? {},
      proxy: payload.proxy ?? { enabled: false, url: '' },
      partition: `persist:acct_${id}`,
      createdAt: Date.now(),
      status: 'unknown'
    }
    state().accounts.push(account)
    await applyProxy(account.partition, account.proxy)
    store.save()
    deps.resendState()
    return account
  })

  ipcMain.handle('accounts:update', async (_event, id: string, patch: Partial<Account>) => {
    const account = state().accounts.find((a) => a.id === id)
    if (!account) throw new Error('Аккаунт не найден')
    const previousProxy = JSON.stringify(account.proxy)
    Object.assign(account, patch, { id: account.id, partition: account.partition })
    if (patch.proxy && JSON.stringify(patch.proxy) !== previousProxy) {
      await applyProxy(account.partition, account.proxy)
    }
    store.save()
    deps.resendState()
    return account
  })

  ipcMain.handle('accounts:remove', async (_event, id: string) => {
    const account = state().accounts.find((a) => a.id === id)
    state().accounts = state().accounts.filter((a) => a.id !== id)
    state().groups = state().groups.map((g) => ({ ...g, accountIds: g.accountIds.filter((x) => x !== id) }))
    if (account) await accountSession(account.partition).clearStorageData().catch(() => undefined)
    store.save()
    deps.resendState()
    return true
  })

  ipcMain.handle('accounts:test', async (_event, id: string) => {
    const account = state().accounts.find((a) => a.id === id)
    if (!account) return { ok: false, message: 'Аккаунт не найден' }
    const adapter = registry.get(account.platform)
    if (!adapter?.authenticate) return { ok: false, message: 'Проверка не поддерживается плагином' }
    const result = await adapter.authenticate(account.credentials, {
      fetch: scopedFetch(account.partition),
      log
    })
    account.status = result.ok ? 'ok' : 'error'
    account.statusMessage = result.message
    store.save()
    deps.resendState()
    return result
  })

  ipcMain.handle('accounts:login', async (_event, id: string) => {
    const account = state().accounts.find((a) => a.id === id)
    if (!account) throw new Error('Аккаунт не найден')
    const adapter = registry.get(account.platform)
    if (!adapter?.loginUrl) throw new Error('Платформа не поддерживает вход через WebView')
    const result = await captureSession(account, adapter.loginUrl, adapter.sessionCookies ?? [])
    account.method = 'session'
    account.credentials = {
      ...account.credentials,
      cookies: result.cookies,
      cookieMap: JSON.stringify(result.map),
      lastLoginUrl: result.url
    }
    account.status = 'ok'
    account.statusMessage = 'Сессия захвачена'
    store.save()
    deps.resendState()
    return { ok: true, cookies: Object.keys(result.map).length }
  })

  ipcMain.handle('accounts:proxy', async (_event, id: string, proxy: ProxyConfig) => {
    const account = state().accounts.find((a) => a.id === id)
    if (!account) throw new Error('Аккаунт не найден')
    account.proxy = proxy
    await applyProxy(account.partition, proxy)
    store.save()
    deps.resendState()
    return true
  })

  ipcMain.handle('media:import', async (_event, paths: string[]) => {
    const imported: MediaItem[] = []
    for (const path of paths) {
      try {
        imported.push(importMediaFile(path))
      } catch (error) {
        log(`media import failed: ${(error as Error).message}`)
      }
    }
    deps.resendState()
    return imported
  })

  ipcMain.handle('media:pick', async () => {
    const win = deps.getWindow()
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Добавить медиа',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Медиа', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov', 'webm'] }]
    })
    if (result.canceled) return []
    const imported = result.filePaths.map((path) => importMediaFile(path))
    deps.resendState()
    return imported
  })

  ipcMain.handle('media:remove', (_event, id: string) => {
    state().media = state().media.filter((m) => m.id !== id)
    store.save()
    deps.resendState()
    return true
  })

  ipcMain.handle('media:update', (_event, id: string, patch: Partial<MediaItem>) => {
    const item = state().media.find((m) => m.id === id)
    if (!item) return null
    Object.assign(item, patch, { id: item.id, path: item.path })
    store.save()
    deps.resendState()
    return item
  })

  ipcMain.handle('draft:save', (_event, draft: Draft) => {
    const existing = state().drafts.findIndex((d) => d.id === draft.id)
    const next = { ...draft, updatedAt: Date.now() }
    if (existing >= 0) state().drafts[existing] = next
    else state().drafts.unshift(next)
    state().drafts = state().drafts.slice(0, 50)
    store.save()
    deps.resendState()
    return next
  })

  ipcMain.handle('draft:remove', (_event, id: string) => {
    state().drafts = state().drafts.filter((d) => d.id !== id)
    store.save()
    deps.resendState()
    return true
  })

  ipcMain.handle(
    'post:create',
    async (
      _event,
      payload: { accountIds: string[]; variants: Record<string, ThreadPost[]>; mediaIds: string[]; scheduledAt?: number }
    ) => {
      const media = state().media.filter((m) => payload.mediaIds.includes(m.id))
      const record = await deps.publisher.createRecord({
        accountIds: payload.accountIds,
        variants: payload.variants,
        media,
        scheduledAt: payload.scheduledAt
      })
      log(`record ${record.id} created for ${payload.accountIds.length} accounts`)
      if (payload.scheduledAt) {
        const native = await deps.publisher.publishNative(record)
        const nativeCount = native.results.filter((r) => r.native).length
        if (nativeCount) log(`${nativeCount} results scheduled natively by their platforms`)
      } else {
        void deps.publisher.publishNow(record).then(() => {
          const errors = record.results.filter((r) => r.status === 'error')
          if (errors.length) {
            new Notification({
              title: 'Gridpost: часть публикаций не удалась',
              body: errors.map((e) => e.error).join('\n').slice(0, 200)
            }).show()
          }
        })
      }
      return record
    }
  )

  ipcMain.handle('post:retry', async (_event, id: string) => {
    const record = await deps.publisher.retryFailed(id)
    return record ?? null
  })

  ipcMain.handle('history:export', async (_event, ids?: string[]) => {
    const win = deps.getWindow()
    if (!win) return null
    const result = await dialog.showSaveDialog(win, {
      title: 'Экспорт истории',
      defaultPath: `gridpost-history-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (result.canceled || !result.filePath) return null

    const wanted = ids ? new Set(ids) : null
    const records = wanted ? state().records.filter((r) => wanted.has(r.id)) : state().records
    const csv = buildHistoryCsv(records, state().accounts)
    writeFileSync(result.filePath, `\uFEFF${csv}`, 'utf8')
    const rowCount = records.reduce((sum, record) => sum + record.results.length, 0)
    log(`history exported: ${rowCount} rows to ${result.filePath}`)
    return rowCount
  })

  ipcMain.handle('post:delete', (_event, id: string) => {
    state().records = state().records.filter((r) => r.id !== id)
    store.save()
    deps.resendState()
    return true
  })

  ipcMain.handle('post:ack', async (_event, id: string, action: 'now' | 'reschedule' | 'draft', scheduledAt?: number) => {
    const record = state().records.find((r) => r.id === id)
    if (!record) return null
    record.ackMissed = true
    if (action === 'now') {
      record.scheduledAt = undefined
      await deps.publisher.publishNow(record)
    } else if (action === 'reschedule' && scheduledAt) {
      record.scheduledAt = scheduledAt
      store.save()
    } else if (action === 'draft') {
      const draft: Draft = {
        id: newId('draft'),
        mode: 'languages',
        text: Object.values(record.variants)[0]?.map((p) => p.text).join('\n\n') ?? '',
        variants: Object.entries(record.variants).map(([lang, thread]) => ({ lang, thread })),
        accountIds: record.accountIds,
        media: record.media,
        updatedAt: Date.now()
      }
      state().drafts.unshift(draft)
      record.results = record.results.map((r) => ({ ...r, status: 'skipped' }))
    }
    store.save()
    deps.resendState()
    return record
  })

  ipcMain.handle('ai:translate', async (_event, request: TranslateRequest) => {
    const results: Record<string, string[]> = {}
    for (const lang of request.targetLangs) {
      const translated: string[] = []
      for (const text of request.texts) {
        translated.push(await translateText(state().settings, text, lang, request.platform))
      }
      results[lang] = translated
    }
    return results
  })

  ipcMain.handle('ai:check', async () => checkProvider(state().settings))

  ipcMain.handle('plugins:list', () => registry.plugins)

  ipcMain.handle('platforms:list', () =>
    registry.all().map((adapter) => ({
      id: adapter.id,
      name: adapter.name,
      color: adapter.color,
      capabilities: adapter.capabilities,
      credentialFields: adapter.credentialFields ?? [],
      loginUrl: adapter.loginUrl ?? null,
      core: registry.listCore().some((c) => c.id === adapter.id)
    }))
  )

  ipcMain.handle('plugins:toggle', async (_event, id: string, enabled: boolean) => {
    registry.setEnabled(id, enabled)
    await registry.reload()
    deps.resendState()
    return registry.plugins
  })

  ipcMain.handle('plugins:reload', async () => {
    const plugins = await registry.reload()
    deps.resendState()
    return plugins
  })

  ipcMain.handle('plugins:openDir', async () => {
    const dir = join(app.getPath('userData'), 'plugins')
    await shell.openPath(dir)
    return dir
  })

  ipcMain.handle('groups:save', (_event, group: AccountGroup) => {
    const index = state().groups.findIndex((g) => g.id === group.id)
    if (index >= 0) state().groups[index] = group
    else state().groups.push(group)
    store.save()
    deps.resendState()
    return group
  })

  ipcMain.handle('groups:remove', (_event, id: string) => {
    state().groups = state().groups.filter((g) => g.id !== id)
    store.save()
    deps.resendState()
    return true
  })

  ipcMain.handle('aliases:save', (_event, alias: Alias) => {
    const index = state().aliases.findIndex((a) => a.id === alias.id)
    if (index >= 0) state().aliases[index] = alias
    else state().aliases.push(alias)
    store.save()
    deps.resendState()
    return alias
  })

  ipcMain.handle('aliases:remove', (_event, id: string) => {
    state().aliases = state().aliases.filter((a) => a.id !== id)
    store.save()
    deps.resendState()
    return true
  })

  ipcMain.handle('presets:export', async (_event, password?: string) => {
    const win = deps.getWindow()
    if (!win) return null
    const result = await dialog.showSaveDialog(win, {
      title: 'Экспорт пресетов',
      defaultPath: 'gridpost-presets.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    const payload = {
      app: 'gridpost',
      version: app.getVersion(),
      exportedAt: new Date().toISOString(),
      aliases: state().aliases,
      groups: state().groups.map((group) => ({
        ...group,
        accountNames: group.accountIds
          .map((id) => state().accounts.find((a) => a.id === id)?.name)
          .filter(Boolean)
      })),
      profiles: state().accounts.map((account) => ({
        platform: account.platform,
        name: account.name,
        lang: account.lang,
        color: account.color,
        method: account.method
      })),
      settings: {
        hotkey: state().settings.hotkey,
        jitterMinSec: state().settings.jitterMinSec,
        jitterMaxSec: state().settings.jitterMaxSec,
        ai: { ...state().settings.ai, apiKey: '' }
      }
    }
    const json = JSON.stringify(payload, null, 2)
    writeFileSync(result.filePath, password ? encryptString(json, password) : json, 'utf8')
    log(`presets exported to ${result.filePath}${password ? ' (encrypted)' : ''}`)
    return result.filePath
  })

  ipcMain.handle('presets:import', async (_event, password?: string) => {
    const win = deps.getWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Импорт пресетов',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePaths.length) return null
    const raw = readFileSync(result.filePaths[0], 'utf8')
    if (isEncrypted(raw) && !password) throw new Error('Файл зашифрован — введите пароль в настройках')
    const payload = JSON.parse(decryptString(raw, password ?? '')) as Record<string, any>
    if (payload.app && payload.app !== 'gridpost') throw new Error('Это не файл пресетов Gridpost')

    let aliases = 0
    for (const alias of payload.aliases ?? []) {
      if (!alias?.token) continue
      const existing = state().aliases.find((a) => a.token === alias.token)
      if (existing) {
        existing.values = { ...existing.values, ...(alias.values ?? {}) }
      } else {
        state().aliases.push({
          id: `alias_${Date.now()}_${aliases}`,
          token: String(alias.token),
          values: alias.values ?? {}
        })
      }
      aliases += 1
    }

    let groups = 0
    for (const group of payload.groups ?? []) {
      if (!group?.name) continue
      const ids: string[] = []
      for (const accountId of group.accountIds ?? []) {
        if (state().accounts.some((a) => a.id === accountId)) ids.push(accountId)
      }
      for (const name of group.accountNames ?? []) {
        const match = state().accounts.find((a) => a.name === name)
        if (match && !ids.includes(match.id)) ids.push(match.id)
      }
      const existing = state().groups.find((g) => g.name === group.name)
      if (existing) existing.accountIds = ids
      else state().groups.push({ id: `group_${Date.now()}_${groups}`, name: String(group.name), accountIds: ids })
      groups += 1
    }

    const importedSettings = payload.settings
    if (importedSettings) {
      const settings = state().settings
      if (typeof importedSettings.hotkey === 'string') settings.hotkey = importedSettings.hotkey
      if (Number.isFinite(importedSettings.jitterMinSec)) settings.jitterMinSec = importedSettings.jitterMinSec
      if (Number.isFinite(importedSettings.jitterMaxSec)) settings.jitterMaxSec = importedSettings.jitterMaxSec
      if (importedSettings.ai) {
        settings.ai = {
          ...settings.ai,
          ...importedSettings.ai,
          apiKey: settings.ai.apiKey || importedSettings.ai.apiKey || ''
        }
      }
    }

    store.save()
    deps.resendState()
    log(`presets imported: ${aliases} aliases, ${groups} groups`)
    return { aliases, groups }
  })

  ipcMain.handle('stats:fetch', async (_event, recordId: string, accountId: string) => {
    const record = state().records.find((r) => r.id === recordId)
    const account = state().accounts.find((a) => a.id === accountId)
    if (!record || !account) return {}
    const result = record.results.find((r) => r.accountId === accountId)
    const adapter = registry.get(account.platform)
    if (!adapter?.fetchStats || !result?.remoteId) return {}
    try {
      return await adapter.fetchStats(account, result.remoteId, { fetch: scopedFetch(account.partition), log })
    } catch (error) {
      return { error: (error as Error).message }
    }
  })

  ipcMain.handle('window:hide', () => deps.getWindow()?.hide())
  ipcMain.handle('window:minimize', () => deps.getWindow()?.minimize())
  ipcMain.handle('window:pin', (_event, pin: boolean) => {
    state().settings.pin = pin
    store.save()
    deps.getWindow()?.setAlwaysOnTop(pin)
    deps.resendState()
    return pin
  })
  ipcMain.handle('window:openExternal', (_event, url: string) => shell.openExternal(url))
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    userData: app.getPath('userData'),
    encrypted: safeStorage.isEncryptionAvailable(),
    storePath: store.path
  }))
  ipcMain.handle('logs:get', () => logs)

  ipcMain.handle('http:probe', async (_event, url: string) => {
    try {
      const res = await fetch(url, { method: 'HEAD' })
      return { ok: res.ok, status: res.status }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  })
}
