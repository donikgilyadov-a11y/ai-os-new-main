import type { Account, PostRecord } from '@shared/types'

function cell(value: unknown): string {
  const text = value == null ? '' : String(value)
  return /[",;\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Semicolon-separated CSV with a UTF-8 BOM marker added by the caller. */
export function buildHistoryCsv(records: PostRecord[], accounts: Account[]): string {
  const rows: (string | number)[][] = [
    [
      'created_at',
      'scheduled_at',
      'published_at',
      'platform',
      'account',
      'lang',
      'status',
      'native',
      'text',
      'url',
      'remote_id',
      'error'
    ]
  ]
  for (const record of records) {
    for (const result of record.results) {
      const account = accounts.find((a) => a.id === result.accountId)
      const thread = record.variants[result.lang] ?? Object.values(record.variants)[0] ?? []
      rows.push([
        new Date(record.createdAt).toISOString(),
        record.scheduledAt ? new Date(record.scheduledAt).toISOString() : '',
        result.at ? new Date(result.at).toISOString() : '',
        account?.platform ?? '',
        account?.name ?? '',
        result.lang,
        result.status,
        result.native || record.native ? 'yes' : 'no',
        thread.map((post) => post.text).join('\n\n'),
        result.url ?? '',
        result.remoteId ?? '',
        result.error ?? ''
      ])
    }
  }
  return rows.map((row) => row.map(cell).join(';')).join('\r\n')
}
