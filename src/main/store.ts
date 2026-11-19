import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppState, MediaItem, Settings } from '@shared/types'

const DEFAULT_SETTINGS: Settings = {
  hotkey: 'Alt+Shift+P',
  pin: false,
  hideOnClose: true,
  jitterMinSec: 10,
  jitterMaxSec: 40,
  ai: {
    provider: 'ollama',
    baseUrl: 'http://localhost:11434',
    model: 'qwen2.5:7b',
    apiKey: '',
    toneAdaptation: true
  },
  activeTab: 'compose'
}

function defaultState(): AppState {
  return {
    accounts: [],
    groups: [],
    aliases: [],
    drafts: [],
    media: [],
    records: [],
    settings: { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai } },
    plugins: []
  }
}

const MAGIC_ENC = 'GP1:'
const MAGIC_PLAIN = 'GP0:'

export class Store {
  private file: string
  private mediaDir: string
  state: AppState = defaultState()
  encrypted = false

  constructor() {
    if (process.env.GRIDPOST_DATA_DIR) {
      app.setPath('userData', process.env.GRIDPOST_DATA_DIR)
    }
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'gridpost.store')
    this.mediaDir = join(dir, 'media')
    mkdirSync(this.mediaDir, { recursive: true })
  }

  get path(): string {
    return this.file
  }

  get mediaPath(): string {
    return this.mediaDir
  }

  load(): AppState {
    try {
      if (existsSync(this.file)) {
        const raw = readFileSync(this.file, 'utf8')
        if (raw.startsWith(MAGIC_ENC)) {
          const json = safeStorage.decryptString(Buffer.from(raw.slice(MAGIC_ENC.length), 'base64'))
          this.state = this.normalize(JSON.parse(json))
          this.encrypted = true
          return this.state
        }
        if (raw.startsWith(MAGIC_PLAIN)) {
          const json = Buffer.from(raw.slice(MAGIC_PLAIN.length), 'base64').toString('utf8')
          this.state = this.normalize(JSON.parse(json))
          return this.state
        }
        this.state = this.normalize(JSON.parse(raw))
      }
    } catch (error) {
      console.error('[store] failed to load, starting fresh', error)
      this.state = defaultState()
    }
    return this.state
  }

  private normalize(parsed: Partial<AppState>): AppState {
    const base = defaultState()
    return {
      ...base,
      ...parsed,
      settings: {
        ...base.settings,
        ...(parsed.settings ?? {}),
        ai: { ...base.settings.ai, ...(parsed.settings?.ai ?? {}) }
      },
      accounts: parsed.accounts ?? [],
      groups: parsed.groups ?? [],
      aliases: parsed.aliases ?? [],
      drafts: parsed.drafts ?? [],
      media: parsed.media ?? [],
      records: (parsed.records ?? []).slice(0, 300),
      plugins: []
    }
  }

  save(): void {
    const json = JSON.stringify(this.state)
    let payload: string
    if (safeStorage.isEncryptionAvailable()) {
      payload = MAGIC_ENC + safeStorage.encryptString(json).toString('base64')
      this.encrypted = true
    } else {
      payload = MAGIC_PLAIN + Buffer.from(json, 'utf8').toString('base64')
    }
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, payload, 'utf8')
    try {
      renameSync(tmp, this.file)
    } catch {
      copyFileSync(tmp, this.file)
    }
  }

  saveMediaFile(sourcePath: string, mediaId: string, ext: string): string {
    const dest = join(this.mediaDir, `${mediaId}${ext}`)
    copyFileSync(sourcePath, dest)
    return dest
  }

  updateMedia(item: MediaItem): void {
    const index = this.state.media.findIndex((m) => m.id === item.id)
    if (index === -1) this.state.media.unshift(item)
    else this.state.media[index] = item
    this.save()
  }

  addRecord(record: AppState['records'][number]): void {
    this.state.records.unshift(record)
    this.state.records = this.state.records.slice(0, 300)
    this.save()
  }
}

export const store = new Store()
