import { create } from 'zustand'
import type {
  Account,
  AppState,
  Capabilities,
  CredentialField,
  Draft,
  MediaItem,
  PostRecord,
  ThreadPost,
  UpdateState
} from '@shared/types'

export interface PlatformInfo {
  id: string
  name: string
  color: string
  capabilities: Capabilities
  credentialFields: CredentialField[]
  loginUrl: string | null
  core: boolean
}

export interface UiPost {
  id: string
  text: string
  mediaIds: string[]
}

export type TabId = 'compose' | 'queue' | 'history' | 'pulse' | 'settings'

interface Composer {
  mode: 'broadcast' | 'languages'
  threads: Record<string, UiPost[]>
  activeKey: string
  preview: boolean
  scheduleAt: number | null
}

interface WizardState {
  open: boolean
  editId: string | null
}

interface ToastItem {
  id: number
  text: string
  kind: 'info' | 'error'
}

interface Store {
  ready: boolean
  data: AppState | null
  platforms: PlatformInfo[]
  encrypted: boolean
  tab: TabId
  selected: string[]
  composer: Composer
  wizard: WizardState
  missed: { records: { id: string; scheduledAt?: number }[] } | null
  toasts: ToastItem[]
  publishing: boolean
  logs: string[]
  update: UpdateState | null

  init: () => Promise<void>
  setTab: (tab: TabId) => void
  toast: (text: string, kind?: 'info' | 'error') => void
  dismissToast: (id: number) => void

  toggleAccount: (id: string) => void
  setSelected: (ids: string[]) => void
  applyGroup: (ids: string[]) => void

  setMode: (mode: 'broadcast' | 'languages') => void
  setActiveKey: (key: string) => void
  ensureLang: (lang: string) => void
  updatePost: (key: string, postId: string, patch: Partial<UiPost>) => void
  addPost: (key: string) => void
  removePost: (key: string, postId: string) => void
  attachMedia: (key: string, postId: string, files: File[]) => Promise<void>
  attachMediaDialog: (key: string, postId: string) => Promise<void>
  detachMedia: (key: string, postId: string, mediaId: string) => void
  setPreview: (on: boolean) => void
  setSchedule: (at: number | null) => void
  resetComposer: () => void
  loadDraft: (draft: Draft, message?: string) => void
  loadRecord: (record: PostRecord) => void
  saveDraftAs: () => Promise<void>
  deleteDraft: (id: string) => Promise<void>
  setMediaAlt: (mediaId: string, alt: string) => Promise<void>

  publish: () => Promise<void>
  saveDraft: () => Promise<void>

  openWizard: (id?: string | null) => void
  closeWizard: () => void
  setMissed: (payload: Store['missed']) => void
  clearLogs: () => void
  checkUpdate: () => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
}

let toastSeq = 0
let draftTimer: ReturnType<typeof setTimeout> | undefined

const uid = (): string => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2))

function newPost(): UiPost {
  return { id: uid(), text: '', mediaIds: [] }
}

function emptyComposer(): Composer {
  return { mode: 'broadcast', threads: { '*': [newPost()] }, activeKey: '*', preview: false, scheduleAt: null }
}

export const useStore = create<Store>((set, get) => ({
  ready: false,
  data: null,
  platforms: [],
  encrypted: false,
  tab: 'compose',
  selected: [],
  composer: emptyComposer(),
  wizard: { open: false, editId: null },
  missed: null,
  toasts: [],
  publishing: false,
  logs: [],
  update: null,

  init: async () => {
    const api = window.gridpost
    const [state, platforms, update] = await Promise.all([api.getState(), api.platforms(), api.updateState()])
    const s = state as AppState & { encrypted: boolean; missed?: { id: string; scheduledAt?: number }[] }
    const selected = s.accounts.slice(0, 6).map((a) => a.id)
    set({
      ready: true,
      data: s,
      platforms: platforms as PlatformInfo[],
      encrypted: Boolean(s.encrypted),
      selected,
      update: update as UpdateState,
      missed: s.missed?.length ? { records: s.missed } : null,
      tab: (s.settings.activeTab as TabId) || 'compose'
    })
    api.onState((next) => {
      const incoming = next as AppState & { encrypted: boolean }
      set((prev) => ({
        data: incoming,
        encrypted: Boolean(incoming.encrypted),
        selected: prev.selected.filter((id) => incoming.accounts.some((a) => a.id === id))
      }))
    })
    api.onRecords((records) => {
      set((prev) => (prev.data ? { data: { ...prev.data, records: records as PostRecord[] } } : {}))
    })
    api.onNotice((payload) => {
      const notice = payload as { kind?: string; message?: string; records?: { id: string; scheduledAt?: number }[] }
      if (notice.message) get().toast(notice.message)
      if (notice.kind === 'missed' && notice.records) set({ missed: { records: notice.records } })
    })
    api.onToast((text) => get().toast(text))
    api.onLog((line) => set((prev) => ({ logs: [line, ...prev.logs].slice(0, 200) })))
    api.onUpdate((next) => set({ update: next as UpdateState }))
  },

  setTab: (tab) => {
    set({ tab })
    void window.gridpost.updateSettings({ activeTab: tab })
  },

  toast: (text, kind = 'info') => {
    const id = ++toastSeq
    set((prev) => ({ toasts: [...prev.toasts, { id, text, kind }] }))
    setTimeout(() => {
      set((prev) => ({ toasts: prev.toasts.filter((t) => t.id !== id) }))
    }, 3200)
  },

  dismissToast: (id) => set((prev) => ({ toasts: prev.toasts.filter((t) => t.id !== id) })),

  toggleAccount: (id) =>
    set((prev) => ({
      selected: prev.selected.includes(id) ? prev.selected.filter((x) => x !== id) : [...prev.selected, id]
    })),

  setSelected: (ids) => set({ selected: ids }),

  applyGroup: (ids) => {
    set({ selected: ids })
    get().toast(`Пресет применён: ${ids.length} аккаунтов`)
  },

  setMode: (mode) => {
    const { composer, data, selected } = get()
    const threads = { ...composer.threads }
    if (mode === 'broadcast' && !threads['*']) threads['*'] = [newPost()]
    if (mode === 'languages' && data) {
      const langs = new Set(
        data.accounts.filter((a) => selected.includes(a.id)).map((a) => a.lang.toUpperCase())
      )
      for (const lang of langs) if (!threads[lang]) threads[lang] = []
    }
    const activeKey = mode === 'broadcast' ? '*' : composer.activeKey === '*' ? Object.keys(threads)[0] : composer.activeKey
    set({ composer: { ...composer, mode, threads, activeKey } })
  },

  setActiveKey: (key) => set((prev) => ({ composer: { ...prev.composer, activeKey: key } })),

  ensureLang: (lang) => {
    const key = lang.toUpperCase()
    set((prev) => {
      if (prev.composer.threads[key]) return {}
      return { composer: { ...prev.composer, threads: { ...prev.composer.threads, [key]: [] } } }
    })
  },

  updatePost: (key, postId, patch) => {
    set((prev) => {
      const threads = { ...prev.composer.threads }
      threads[key] = (threads[key] ?? []).map((p) => (p.id === postId ? { ...p, ...patch } : p))
      return { composer: { ...prev.composer, threads } }
    })
    scheduleDraftSave()
  },

  addPost: (key) => {
    set((prev) => {
      const threads = { ...prev.composer.threads }
      threads[key] = [...(threads[key] ?? []), newPost()]
      return { composer: { ...prev.composer, threads } }
    })
    scheduleDraftSave()
  },

  removePost: (key, postId) => {
    set((prev) => {
      const threads = { ...prev.composer.threads }
      const list = threads[key] ?? []
      threads[key] = list.length > 1 ? list.filter((p) => p.id !== postId) : [newPost()]
      return { composer: { ...prev.composer, threads } }
    })
    scheduleDraftSave()
  },

  attachMedia: async (key, postId, files) => {
    const paths = files.map((file) => window.gridpost.pathForFile(file)).filter(Boolean)
    if (!paths.length) return
    const imported = (await window.gridpost.importMedia(paths)) as MediaItem[]
    if (!imported.length) {
      get().toast('Не удалось добавить медиа', 'error')
      return
    }
    set((prev) => {
      const threads = { ...prev.composer.threads }
      threads[key] = (threads[key] ?? []).map((p) =>
        p.id === postId ? { ...p, mediaIds: [...p.mediaIds, ...imported.map((m) => m.id)] } : p
      )
      const data = prev.data
      return {
        composer: { ...prev.composer, threads },
        data: data ? { ...data, media: [...imported, ...data.media] } : data
      }
    })
  },

  attachMediaDialog: async (key, postId) => {
    const imported = (await window.gridpost.pickMedia()) as MediaItem[]
    if (!imported.length) return
    set((prev) => {
      const threads = { ...prev.composer.threads }
      threads[key] = (threads[key] ?? []).map((p) =>
        p.id === postId ? { ...p, mediaIds: [...p.mediaIds, ...imported.map((m) => m.id)] } : p
      )
      const data = prev.data
      return {
        composer: { ...prev.composer, threads },
        data: data ? { ...data, media: [...imported, ...data.media] } : data
      }
    })
  },

  detachMedia: (key, postId, mediaId) => {
    set((prev) => {
      const threads = { ...prev.composer.threads }
      threads[key] = (threads[key] ?? []).map((p) =>
        p.id === postId ? { ...p, mediaIds: p.mediaIds.filter((id) => id !== mediaId) } : p
      )
      return { composer: { ...prev.composer, threads } }
    })
  },

  setPreview: (on) => set((prev) => ({ composer: { ...prev.composer, preview: on } })),

  setSchedule: (at) => set((prev) => ({ composer: { ...prev.composer, scheduleAt: at } })),

  resetComposer: () => set({ composer: emptyComposer() }),

  loadDraft: (draft, message = 'Черновик загружен') => {
    const threads: Record<string, UiPost[]> = {}
    for (const variant of draft.variants ?? []) {
      threads[variant.lang] = (variant.thread ?? []).map((post) => ({
        id: post.id || uid(),
        text: post.text ?? '',
        mediaIds: post.mediaIds ?? []
      }))
    }
    if (!Object.keys(threads).length) threads['*'] = [newPost()]
    const mode = draft.mode ?? (threads['*'] ? 'broadcast' : 'languages')
    const activeKey = mode === 'broadcast' ? '*' : Object.keys(threads)[0]
    set((prev) => {
      const data = prev.data
      const known = new Set(data?.media.map((m) => m.id) ?? [])
      const extra = (draft.media ?? []).filter((m) => !known.has(m.id))
      const ids = data ? draft.accountIds?.filter((id) => data.accounts.some((a) => a.id === id)) ?? [] : []
      return {
        composer: {
          mode,
          threads,
          activeKey,
          preview: false,
          scheduleAt: null
        },
        selected: ids.length ? ids : prev.selected,
        data: data && extra.length ? { ...data, media: [...extra, ...data.media] } : data
      }
    })
    get().toast(message)
  },

  loadRecord: (record) => {
    const draft: Draft = {
      id: `repost_${record.id}_${Date.now()}`,
      mode: 'languages',
      text: Object.values(record.variants)[0]?.map((p) => p.text).join('\n\n') ?? '',
      variants: Object.entries(record.variants).map(([lang, thread]) => ({ lang, thread })),
      accountIds: record.accountIds,
      media: record.media,
      updatedAt: Date.now()
    }
    get().loadDraft(draft, 'Пост загружен в композер')
    set({ tab: 'compose' })
    void window.gridpost.updateSettings({ activeTab: 'compose' })
  },

  saveDraftAs: async () => {
    const { composer, data } = get()
    if (!data) return
    const draft: Draft = {
      id: `draft_${Date.now()}`,
      mode: composer.mode,
      text: (composer.threads['*'] ?? []).map((p) => p.text).join('\n\n'),
      variants: Object.entries(composer.threads).map(([lang, thread]) => ({
        lang,
        thread: thread.map((p) => ({ id: p.id, text: p.text, mediaIds: p.mediaIds }))
      })),
      accountIds: get().selected,
      media: data.media,
      updatedAt: Date.now()
    }
    await window.gridpost.saveDraft(draft)
    get().toast('Черновик сохранён')
  },

  deleteDraft: async (id) => {
    await window.gridpost.removeDraft(id)
    get().toast('Черновик удалён')
  },

  setMediaAlt: async (mediaId, alt) => {
    await window.gridpost.updateMedia(mediaId, { alt })
    set((prev) => {
      if (!prev.data) return {}
      return {
        data: {
          ...prev.data,
          media: prev.data.media.map((m) => (m.id === mediaId ? { ...m, alt } : m))
        }
      }
    })
  },

  publish: async () => {
    const { composer, data, selected } = get()
    if (!data) return
    const accounts = data.accounts.filter((a) => selected.includes(a.id))
    if (!accounts.length) {
      get().toast('Выберите хотя бы один аккаунт', 'error')
      return
    }
    const variants: Record<string, ThreadPost[]> = {}
    const broadcast = composer.threads['*'] ?? []
    const sourceFor = (lang: string): UiPost[] => {
      if (composer.mode === 'broadcast') return broadcast
      return composer.threads[lang] ?? composer.threads[lang.toUpperCase()] ?? broadcast
    }
    for (const account of accounts) {
      const lang = account.lang.toUpperCase()
      if (variants[lang]) continue
      const posts = sourceFor(lang).filter((p) => p.text.trim() || p.mediaIds.length)
      if (!posts.length) continue
      variants[lang] = posts.map((p) => ({ id: p.id, text: p.text, mediaIds: p.mediaIds }))
    }
    if (!Object.keys(variants).length) {
      get().toast('Добавьте текст или медиа', 'error')
      return
    }
    const mediaIds = new Set<string>()
    Object.values(variants).forEach((thread) => thread.forEach((p) => p.mediaIds.forEach((id) => mediaIds.add(id))))
    for (const [lang, thread] of Object.entries(variants)) {
      const accountsOfLang = accounts.filter((a) => a.lang.toUpperCase() === lang)
      const limit = strictestLimit(accountsOfLang, get().platforms)
      if (thread.some((post) => post.text.length > limit)) {
        get().toast(`Вариант ${lang}: одно из сообщений превышает лимит ${limit} символов`, 'error')
        return
      }
    }
    const targetAccounts = accounts.filter((account) => variants[account.lang.toUpperCase()])
    if (!targetAccounts.length) {
      get().toast('Нет аккаунтов с заполненным вариантом публикации', 'error')
      return
    }
    set({ publishing: true })
    try {
      await window.gridpost.createPost({
        accountIds: targetAccounts.map((a) => a.id),
        variants,
        mediaIds: [...mediaIds],
        scheduledAt: composer.scheduleAt ?? undefined
      })
      get().toast(composer.scheduleAt ? 'Запланировано' : 'Отправка запущена')
      set((prev) => ({ composer: { ...prev.composer, preview: false } }))
    } catch (error) {
      get().toast(`Ошибка: ${(error as Error).message}`, 'error')
    } finally {
      set({ publishing: false })
    }
  },

  saveDraft: async () => {
    const { composer, data } = get()
    if (!data) return
    const broadcast = composer.threads['*'] ?? []
    const draft: Draft = {
      id: 'composer-draft',
      mode: composer.mode,
      text: broadcast.map((p) => p.text).join('\n\n'),
      variants: Object.entries(composer.threads).map(([lang, thread]) => ({
        lang,
        thread: thread.map((p) => ({ id: p.id, text: p.text, mediaIds: p.mediaIds }))
      })),
      accountIds: get().selected,
      media: data.media,
      updatedAt: Date.now()
    }
    await window.gridpost.saveDraft(draft)
  },

  openWizard: (id = null) => set({ wizard: { open: true, editId: id } }),
  closeWizard: () => set({ wizard: { open: false, editId: null } }),
  setMissed: (payload) => set({ missed: payload }),
  clearLogs: () => set({ logs: [] }),

  checkUpdate: async () => {
    set({ update: { status: 'checking' } })
    try {
      set({ update: (await window.gridpost.checkUpdate()) as UpdateState })
    } catch (error) {
      set({ update: { status: 'error', error: (error as Error).message } })
    }
  },

  downloadUpdate: async () => {
    try {
      set({ update: (await window.gridpost.downloadUpdate()) as UpdateState })
    } catch (error) {
      set({ update: { status: 'error', error: (error as Error).message } })
    }
  },

  installUpdate: async () => {
    await window.gridpost.installUpdate()
  }
}))

function scheduleDraftSave(): void {
  if (draftTimer) clearTimeout(draftTimer)
  draftTimer = setTimeout(() => {
    void useStore.getState().saveDraft()
  }, 1400)
}

export function strictestLimit(accounts: Account[], platforms: PlatformInfo[]): number {
  const limits = accounts
    .map((a) => platforms.find((p) => p.id === a.platform)?.capabilities.maxChars)
    .filter((n): n is number => typeof n === 'number')
  return limits.length ? Math.min(...limits) : 280
}
