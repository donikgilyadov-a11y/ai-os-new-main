/**
 * Dependency-free unit checks for the pure main-process helpers.
 * TypeScript is transpiled in memory, so no build step is required.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

function loadTs(relativePath) {
  const source = readFileSync(join(root, relativePath), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    }
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', js)(require, module, module.exports)
  return module.exports
}

// ── password-encrypted preset backups ────────────────────────────────
const crypto = loadTs('src/main/crypto.ts')
const original = JSON.stringify({ app: 'gridpost', aliases: [{ token: 'lead' }] })
const encrypted = crypto.encryptString(original, 'p@ss')
assert.match(encrypted, /^GPENC1:/)
assert.equal(crypto.decryptString(encrypted, 'p@ss'), original)
assert.throws(() => crypto.decryptString(encrypted, 'wrong'), /Неверный пароль/)
assert.equal(crypto.decryptString(original, ''), original)
console.log('✓ crypto: round-trip, wrong password, plain compatibility')

// ── history CSV ───────────────────────────────────────────────────────
const { buildHistoryCsv } = loadTs('src/main/history-csv.ts')
const records = [
  {
    id: 'p1',
    createdAt: Date.UTC(2026, 0, 2, 3, 4),
    native: false,
    accountIds: ['a1'],
    variants: { RU: [{ id: 't1', text: 'Привет; "мир"\nвторая строка', mediaIds: [] }] },
    media: [],
    results: [
      {
        accountId: 'a1',
        lang: 'RU',
        status: 'sent',
        url: 'https://x.test/1',
        remoteId: 'r1',
        at: Date.UTC(2026, 0, 2, 3, 5)
      }
    ]
  },
  {
    id: 'p2',
    createdAt: Date.UTC(2026, 0, 3, 4, 0),
    native: true,
    accountIds: ['a2'],
    variants: { EN: [{ id: 't2', text: 'Second post', mediaIds: [] }] },
    media: [],
    results: [{ accountId: 'a2', lang: 'EN', status: 'error', error: 'HTTP 500' }]
  }
]
const accounts = [
  { id: 'a1', name: 'TG "основной"', platform: 'telegram' },
  { id: 'a2', name: 'Mastodon', platform: 'mastodon' }
]
const csv = buildHistoryCsv(records, accounts)
const lines = csv.split('\r\n')
assert.equal(lines.length, 3)
assert.ok(lines[0].startsWith('created_at;scheduled_at;published_at;platform'))
assert.ok(lines[1].includes('"TG ""основной"""'))
assert.ok(lines[1].includes('"Привет; ""мир""\nвторая строка"'))
assert.ok(lines[2].includes(';error;yes;Second post;;;HTTP 500'))
console.log('✓ csv: header, escaping, statuses, native flag')

console.log('\nAll unit checks passed')
