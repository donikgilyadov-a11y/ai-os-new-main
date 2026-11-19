import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

const PREFIX = 'GPENC1:'

/** Password-protected JSON for portable preset backups (AES-256-GCM + scrypt). */
export function encryptString(text: string, password: string): string {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(password, salt, 32)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + [salt.toString('base64'), iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':')
}

/** Decrypts a GPENC1 payload; plain JSON is returned as-is for backward compatibility. */
export function decryptString(payload: string, password: string): string {
  if (!payload.startsWith(PREFIX)) return payload
  const parts = payload.slice(PREFIX.length).split(':')
  if (parts.length !== 4) throw new Error('Повреждённый файл пресетов')
  const [salt, iv, tag, data] = parts.map((part) => Buffer.from(part, 'base64'))
  const key = scryptSync(password, salt, 32)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  try {
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('Неверный пароль или повреждённый файл')
  }
}

export function isEncrypted(payload: string): boolean {
  return payload.startsWith(PREFIX)
}
