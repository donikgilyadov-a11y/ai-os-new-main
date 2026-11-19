/**
 * Smoke test for the packaged renderer: launches Electron with playwright-core,
 * walks through the add-account wizard, composes a post, checks persistence
 * across restarts and saves screenshots.
 *
 *   npm run build && node scripts/smoke.mjs
 */
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'

const dataDir = mkdtempSync(join(tmpdir(), 'gridpost-smoke-'))
const shotDir = process.env.SHOT_DIR ?? join(tmpdir(), 'gridpost-shots')
mkdirSync(shotDir, { recursive: true })

const log = (step, extra = '') => console.log(`✓ ${step}${extra ? ` — ${extra}` : ''}`)

// Local Telegram Bot API stand-in so the real adapter + publisher can be exercised.
const mockRequests = []
const mockServer = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    mockRequests.push({ url: req.url ?? '', body })
    const isMe = req.url?.includes('/getMe')
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        ok: true,
        result: isMe
          ? { id: 1, is_bot: true, username: 'gridpost_test_bot', first_name: 'Test' }
          : { message_id: 1000 + mockRequests.length }
      })
    )
  })
})
await new Promise((resolve, reject) => {
  mockServer.once('error', reject)
  mockServer.listen(0, '127.0.0.1', resolve)
})
const mockApi = `http://127.0.0.1:${mockServer.address().port}`

async function launch() {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, GRIDPOST_DATA_DIR: dataDir, GRIDPOST_TELEGRAM_API: mockApi },
    timeout: 60000
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30000 })
  await page.waitForTimeout(600)
  return { app, page }
}

async function shot(page, name) {
  await page.screenshot({ path: join(shotDir, name) })
}

async function run() {
  let { app, page } = await launch()
  log('app launched', dataDir)

  const body = await page.textContent('body')
  if (!body?.includes('Аккаунтов пока нет')) throw new Error('empty state missing')
  await shot(page, '01-empty.png')
  log('empty state rendered')

  const platforms = await page.evaluate(() => window.gridpost.platforms())
  const pluginInfo = await page.evaluate(() => window.gridpost.listPlugins())
  if (process.env.DEBUG_PLUGINS) console.log(JSON.stringify(pluginInfo, null, 2))
  for (const id of ['instagram', 'webhook']) {
    if (!platforms.some((p) => p.id === id))
      throw new Error(`plugin ${id} not loaded: ${platforms.map((p) => p.id).join(', ')}`)
  }
  log('plugins discovered', platforms.map((p) => p.id).join(', '))

  const updater = await page.evaluate(() => window.gridpost.updateState())
  if (updater?.status !== 'dev') throw new Error(`updater should be disabled in dev, got ${updater?.status}`)
  log('updater dev-mode guard')

  await page.getByRole('button', { name: 'Добавить аккаунт' }).click()
  await page.waitForSelector('.modal')
  await page.locator('.platform-tile', { hasText: 'Telegram' }).click()
  await page.getByPlaceholder('Например: X · EN продукт').fill('TG · RU канал')
  await page.getByPlaceholder('EN', { exact: true }).fill('RU')
  await page.getByPlaceholder('123456:ABC-DEF…').fill('123456:TEST-TOKEN')
  await page.getByPlaceholder('@my_channel или -1001234567890').fill('@gridpost_demo')
  await shot(page, '02-wizard.png')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await page.waitForSelector('.modal', { state: 'detached' })
  await page.waitForTimeout(400)
  const chip = page.locator('.chip', { hasText: 'TG · RU канал' })
  if (!(await chip.count())) throw new Error('account chip not rendered')
  if (!(await chip.getAttribute('class'))?.includes('on')) await chip.click()
  log('account created via wizard')

  const area = page.locator('.post-card textarea').first()
  await area.fill('Привет, {lead}! Это тестовый пост из Gridpost.')
  await page.getByRole('button', { name: 'Пост в ветке' }).click()
  await page.locator('.post-card textarea').nth(1).fill('Второй пост ветки: детали и ссылка https://example.com')
  await page.getByRole('button', { name: 'Превью' }).click()
  await page.waitForSelector('.preview-card')
  await shot(page, '03-compose.png')
  const counter = await page.locator('.counter').first().textContent()
  if (!counter?.includes('/4096')) throw new Error(`unexpected counter: ${counter}`)
  log('composer + thread + preview', `counter ${counter}`)

  await page.getByRole('button', { name: 'Опубликовать' }).click()
  let published = null
  let results = []
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const snapshot = await page.evaluate(async () => {
      const state = await window.gridpost.getState()
      return state.records.flatMap((record) => record.results)
    })
    results = snapshot
    published = snapshot.find((result) => result.status === 'sent') ?? null
    if (published || snapshot.some((result) => result.status === 'error')) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (!published)
    throw new Error(`publish did not succeed: ${JSON.stringify(results.map((r) => ({ status: r.status, error: r.error })))}`)
  const sends = mockRequests.filter((request) => request.url.includes('/sendMessage'))
  if (sends.length < 2)
    throw new Error(
      `expected 2 Telegram messages, got ${sends.length}; urls=${JSON.stringify(mockRequests.map((r) => r.url))}`
    )
  if (!sends[0].body.includes('тестовый пост')) throw new Error('first message text was not delivered')
  if (!sends[1].body.includes('Второй пост ветки')) throw new Error('second thread post was not delivered')
  if (!published.url?.includes('t.me/gridpost_demo/')) throw new Error('missing Telegram post URL')
  log('real publish via Telegram adapter', `${sends.length} messages, ${published.url}`)

  await page.getByTitle('Сохранить черновик').click()
  await page.waitForTimeout(300)
  await page.getByTitle('Черновики').click()
  await page.waitForSelector('.modal')
  await page.waitForTimeout(300)
  const draftRecord = page.locator('.record', { hasText: 'тестовый пост' })
  if (!(await draftRecord.count())) throw new Error('manual draft not saved')
  await shot(page, '03b-drafts.png')
  log('drafts panel + manual save')
  await page.locator('.modal .icon-btn').click()
  await page.waitForSelector('.modal', { state: 'detached' })

  const accountId = await page.evaluate(async () => (await window.gridpost.getState()).accounts[0].id)
  await page.evaluate(
    (id) =>
      window.gridpost.createPost({
        accountIds: [id],
        variants: { RU: [{ id: 'hist1', text: 'Историческая запись для smoke', mediaIds: [] }] },
        mediaIds: [],
        scheduledAt: Date.now() + 3_600_000
      }),
    accountId
  )
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'История' }).click()
  await page.waitForSelector('.history-search')
  const historyRecord = page.locator('.record', { hasText: 'Историческая запись для smoke' })
  if (!(await historyRecord.count())) throw new Error('history record not rendered')
  await shot(page, '03c-history.png')
  log('history tab + search + filters')
  await historyRecord.getByRole('button', { name: 'в композер' }).click()
  await page.waitForTimeout(300)
  const repostText = await page.locator('.post-card textarea').first().inputValue()
  if (!repostText.includes('Историческая запись')) throw new Error('repost did not load into composer')
  log('history repost → composer')

  await page.getByRole('button', { name: 'Настройки' }).click()
  await page.waitForSelector('.account-row')
  const settingsText = await page.textContent('body')
  if (!settingsText?.includes('Обновления')) throw new Error('updates section missing')
  await shot(page, '04-settings.png')
  log('settings tab rendered')

  await app.evaluate(({ app: electronApp }) => electronApp.quit())
  await app.waitForEvent('close', { timeout: 20000 }).catch(() => undefined)
  await new Promise((resolve) => setTimeout(resolve, 1200))
  await new Promise((resolve) => setTimeout(resolve, 1200))

  ;({ app, page } = await launch())
  const chip2 = page.locator('.chip', { hasText: 'TG · RU канал' })
  if (!(await chip2.count())) throw new Error('account lost after restart')
  const title = await page.textContent('.titlebar')
  if (!title?.includes('local')) throw new Error('store is not encrypted')
  await shot(page, '05-persist.png')
  log('persistence + encryption verified')

  const files = readdirSync(dataDir)
  if (!files.includes('gridpost.store')) throw new Error('store file missing')
  log('store file present', files.filter((f) => f.startsWith('gridpost')).join(', '))

  await app.evaluate(({ app: electronApp }) => electronApp.quit())
  mockServer.close()
  console.log(`\nScreenshots: ${shotDir}`)
  if (!process.env.KEEP_DATA) {
    try {
      rmSync(dataDir, { recursive: true, force: true })
    } catch {
      /* Windows may keep a Chromium handle briefly */
    }
  }
}

run().catch(async (error) => {
  mockServer.close()
  console.error('SMOKE FAILED:', error.message)
  if (process.env.SCREENSHOT_ON_FAIL) console.error('data dir:', dataDir)
  process.exit(1)
})
