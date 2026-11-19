import { app } from 'electron'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Adapter, Capabilities, PluginInfo } from '@shared/types'
import telegram from './telegram'
import x from './x'
import bluesky from './bluesky'
import mastodon from './mastodon'
import facebook from './facebook'

const nativeImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<any>

const FALLBACK_CAPS: Capabilities = {
  maxChars: 5000,
  media: { maxCount: 4, maxBytes: 10 * 1024 * 1024, mime: ['image/*'] },
  threads: false,
  nativeScheduling: false
}

interface PluginModule {
  id?: string
  name?: string
  color?: string
  capabilities?: Capabilities
  credentialFields?: Adapter['credentialFields']
  loginUrl?: string
  sessionCookies?: string[]
  authenticate?: Adapter['authenticate']
  publish?: Adapter['publish']
  fetchStats?: Adapter['fetchStats']
  default?: PluginModule
}

export class AdapterRegistry {
  private core = new Map<string, Adapter>()
  private loaded = new Map<string, Adapter>()
  private disabled = new Set<string>()
  plugins: PluginInfo[] = []

  constructor() {
    for (const adapter of [x, telegram, facebook, bluesky, mastodon]) {
      this.core.set(adapter.id, adapter)
      this.loaded.set(adapter.id, adapter)
    }
  }

  get(platform: string): Adapter | undefined {
    return this.loaded.get(platform) ?? this.core.get(platform)
  }

  listCore(): Adapter[] {
    return [...this.core.values()]
  }

  all(): Adapter[] {
    return [...this.loaded.values()]
  }

  private pluginDirs(): { dir: string; source: 'bundled' | 'user' }[] {
    const result: { dir: string; source: 'bundled' | 'user' }[] = []
    const userDir = join(app.getPath('userData'), 'plugins')
    const bundled = app.isPackaged
      ? join(process.resourcesPath, 'plugins')
      : join(app.getAppPath(), 'plugins')
    for (const [dir, source] of [[bundled, 'bundled'], [userDir, 'user']] as const) {
      if (!existsSync(dir)) continue
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) result.push({ dir: join(dir, entry.name), source })
      }
    }
    return result
  }

  async reload(): Promise<PluginInfo[]> {
    for (const id of [...this.loaded.keys()]) {
      if (!this.core.has(id)) this.loaded.delete(id)
    }
    const plugins: PluginInfo[] = []
    for (const { dir, source } of this.pluginDirs()) {
      const manifestPath = join(dir, 'manifest.json')
      const info: PluginInfo = {
        id: dir.split(/[\\/]/).pop() ?? dir,
        name: info_name(dir),
        version: '0.0.0',
        enabled: false,
        source,
        dir
      }
      try {
        if (!existsSync(manifestPath)) throw new Error('manifest.json не найден')
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, any>
        info.id = manifest.id ?? info.id
        info.name = manifest.name ?? info.name
        info.version = manifest.version ?? '0.0.0'
        info.description = manifest.description
        info.platform = manifest.platform ?? info.id
        info.enabled = !this.disabled.has(info.id)
        if (!info.enabled) {
          plugins.push(info)
          continue
        }
        const mainFile = join(dir, manifest.main ?? 'adapter.js')
        if (!existsSync(mainFile)) throw new Error('точка входа плагина не найдена')
        const module = (await nativeImport(pathToFileURL(mainFile).href)) as PluginModule
        const impl = module.default ?? module
        if (typeof impl.publish !== 'function') throw new Error('плагин не реализует publish()')
        const adapter: Adapter = {
          id: manifest.id ?? info.id,
          name: manifest.name ?? info.name,
          color: manifest.color ?? '#8b93a7',
          capabilities: impl.capabilities ?? FALLBACK_CAPS,
          credentialFields: impl.credentialFields ?? [],
          loginUrl: impl.loginUrl,
          sessionCookies: impl.sessionCookies,
          authenticate: impl.authenticate,
          publish: impl.publish,
          fetchStats: impl.fetchStats
        }
        info.platform = adapter.id
        info.capabilities = adapter.capabilities
        this.loaded.set(adapter.id, adapter)
        plugins.push(info)
      } catch (error) {
        info.error = (error as Error).message
        info.enabled = false
        plugins.push(info)
      }
    }
    this.plugins = plugins
    return plugins
  }

  setEnabled(id: string, enabled: boolean): void {
    if (enabled) this.disabled.delete(id)
    else {
      this.disabled.add(id)
      if (!this.core.has(id)) this.loaded.delete(id)
    }
  }
}

function info_name(dir: string): string {
  return dir.split(/[\\/]/).pop() ?? dir
}

export const registry = new AdapterRegistry()
