import { contextBridge, ipcRenderer, webUtils } from 'electron'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>

const api = {
  getState: () => invoke('state:get'),
  refresh: () => invoke('state:refresh'),
  updateSettings: (patch: Record<string, unknown>) => invoke('settings:update', patch),

  addAccount: (payload: Record<string, unknown>) => invoke('accounts:add', payload),
  updateAccount: (id: string, patch: Record<string, unknown>) => invoke('accounts:update', id, patch),
  removeAccount: (id: string) => invoke('accounts:remove', id),
  testAccount: (id: string) => invoke('accounts:test', id),
  loginAccount: (id: string) => invoke('accounts:login', id),
  setProxy: (id: string, proxy: unknown) => invoke('accounts:proxy', id, proxy),

  importMedia: (paths: string[]) => invoke('media:import', paths),
  pickMedia: () => invoke('media:pick'),
  removeMedia: (id: string) => invoke('media:remove', id),
  updateMedia: (id: string, patch: Record<string, unknown>) => invoke('media:update', id, patch),
  pathForFile: (file: File) => webUtils.getPathForFile(file),

  saveDraft: (draft: unknown) => invoke('draft:save', draft),
  removeDraft: (id: string) => invoke('draft:remove', id),

  createPost: (payload: unknown) => invoke('post:create', payload),
  retryPost: (id: string) => invoke('post:retry', id),
  deletePost: (id: string) => invoke('post:delete', id),
  exportHistory: (ids?: string[]) => invoke('history:export', ids),
  ackPost: (id: string, action: string, scheduledAt?: number) => invoke('post:ack', id, action, scheduledAt),

  translate: (request: unknown) => invoke('ai:translate', request),
  checkAi: () => invoke('ai:check'),

  listPlugins: () => invoke('plugins:list'),
  platforms: () => invoke('platforms:list'),
  togglePlugin: (id: string, enabled: boolean) => invoke('plugins:toggle', id, enabled),
  reloadPlugins: () => invoke('plugins:reload'),
  openPluginsDir: () => invoke('plugins:openDir'),

  saveGroup: (group: unknown) => invoke('groups:save', group),
  removeGroup: (id: string) => invoke('groups:remove', id),
  saveAlias: (alias: unknown) => invoke('aliases:save', alias),
  removeAlias: (id: string) => invoke('aliases:remove', id),
  exportPresets: (password?: string) => invoke('presets:export', password),
  importPresets: (password?: string) => invoke('presets:import', password),

  fetchStats: (recordId: string, accountId: string) => invoke('stats:fetch', recordId, accountId),

  hideWindow: () => invoke('window:hide'),
  minimizeWindow: () => invoke('window:minimize'),
  pinWindow: (pin: boolean) => invoke('window:pin', pin),
  openExternal: (url: string) => invoke('window:openExternal', url),
  appInfo: () => invoke('app:info'),
  logs: () => invoke('logs:get'),
  probe: (url: string) => invoke('http:probe', url),

  onState: (cb: (state: unknown) => void) => {
    const listener = (_e: unknown, state: unknown) => cb(state)
    ipcRenderer.on('state:changed', listener)
    return () => ipcRenderer.removeListener('state:changed', listener)
  },
  onRecords: (cb: (records: unknown) => void) => {
    const listener = (_e: unknown, records: unknown) => cb(records)
    ipcRenderer.on('records:changed', listener)
    return () => ipcRenderer.removeListener('records:changed', listener)
  },
  onNotice: (cb: (payload: unknown) => void) => {
    const listener = (_e: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on('notice', listener)
    return () => ipcRenderer.removeListener('notice', listener)
  },
  onToast: (cb: (text: string) => void) => {
    const listener = (_e: unknown, text: string) => cb(text)
    ipcRenderer.on('toast', listener)
    return () => ipcRenderer.removeListener('toast', listener)
  },
  onLog: (cb: (line: string) => void) => {
    const listener = (_e: unknown, line: string) => cb(line)
    ipcRenderer.on('log', listener)
    return () => ipcRenderer.removeListener('log', listener)
  }
}

contextBridge.exposeInMainWorld('gridpost', api)

export type GridpostApi = typeof api
