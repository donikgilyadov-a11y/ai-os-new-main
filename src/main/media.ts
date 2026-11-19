import { nativeImage } from 'electron'
import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import type { Capabilities, MediaAsset, MediaItem } from '@shared/types'
import { newId, truncate } from './util'
import { store } from './store'

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.m4v'])

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m4v': 'video/mp4'
}

export function importMediaFile(path: string): MediaItem {
  const ext = extname(path).toLowerCase()
  const mime = MIME[ext] ?? 'application/octet-stream'
  const size = statSync(path).size
  const id = newId('media')
  const stored = store.saveMediaFile(path, id, ext)
  const isVideo = VIDEO_EXT.has(ext)
  let thumb = ''
  let width: number | undefined
  let height: number | undefined
  if (!isVideo && IMAGE_EXT.has(ext)) {
    try {
      const image = nativeImage.createFromBuffer(readFileSync(path))
      if (!image.isEmpty()) {
        const dimensions = image.getSize()
        width = dimensions.width
        height = dimensions.height
        thumb = image.resize({ width: 120, quality: 'good' }).toDataURL()
      }
    } catch {
      /* ignore preview errors */
    }
  }
  const item: MediaItem = {
    id,
    name: basename(path),
    mime,
    size,
    width,
    height,
    path: stored,
    thumb,
    isVideo
  }
  store.updateMedia(item)
  return item
}

function fits(mime: string, allowed: string[]): boolean {
  return allowed.some((rule) => (rule.endsWith('/*') ? mime.startsWith(rule.slice(0, -1)) : rule === mime))
}

/**
 * Pre-flight processing: compress/resize a single asset so it fits the
 * target platform limits, keeping the original file for the others.
 */
export function prepareAsset(item: MediaItem, caps: Capabilities): MediaAsset {
  let buffer: Buffer
  try {
    buffer = readFileSync(item.path)
  } catch {
    throw new Error(`Файл не найден: ${truncate(item.name, 40)}`)
  }

  if (!fits(item.mime, caps.media.mime)) {
    throw new Error(`${item.name}: формат ${item.mime} не поддерживается`)
  }

  if (item.mime.startsWith('image/') && item.mime !== 'image/gif') {
    let image = nativeImage.createFromBuffer(buffer)
    if (!image.isEmpty()) {
      const maxSide = 2048
      const size = image.getSize()
      if (size.width > maxSide || size.height > maxSide) {
        const scale = maxSide / Math.max(size.width, size.height)
        image = image.resize({
          width: Math.round(size.width * scale),
          height: Math.round(size.height * scale),
          quality: 'best'
        })
      }
      let quality = 88
      let encoded = buffer
      let mimeOut = item.mime
      if (buffer.length > caps.media.maxBytes) {
        encoded = image.toJPEG(quality)
        mimeOut = 'image/jpeg'
        while (encoded.length > caps.media.maxBytes && quality > 40) {
          quality -= 8
          encoded = image.toJPEG(quality)
        }
      }
      if (encoded.length > caps.media.maxBytes) {
        throw new Error(`${item.name}: не удалось сжать до ${(caps.media.maxBytes / 1024 / 1024).toFixed(0)} МБ`)
      }
      return {
        id: item.id,
        buffer: encoded,
        mime: mimeOut,
        name: mimeOut === 'image/jpeg' ? item.name.replace(/\.[^.]+$/, '') + '.jpg' : item.name,
        alt: item.alt
      }
    }
  }

  if (buffer.length > caps.media.maxBytes) {
    throw new Error(`${item.name}: превышен лимит ${(caps.media.maxBytes / 1024 / 1024).toFixed(1)} МБ`)
  }
  return { id: item.id, buffer, mime: item.mime, name: item.name, alt: item.alt }
}

export function prepareThreadMedia(items: MediaItem[], caps: Capabilities): MediaAsset[] {
  const limited = items.slice(0, caps.media.maxCount)
  const assets: MediaAsset[] = []
  for (const item of limited) assets.push(prepareAsset(item, caps))
  return assets
}
