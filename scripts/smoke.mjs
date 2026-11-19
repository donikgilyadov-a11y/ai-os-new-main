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

const dataDir = mkdtempSync(join(tmpdir(), 'gridpost-smoke-'))
const shotDir = process.env.SHOT_DIR ?? join(tmpdir(), 'gridpost-shots')
mkdirSync(shotDir, { recursive: true })

const log = (step, extra = '') => console.log(`✓ ${step}${extra ? ` — ${extra}` : ''}`)

async function launch() {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, GRIDPOST_DATA_DIR: dataDir },
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

  await page.getByRole('button', { name: 'Добавить аккаунт' }).click()
  await page.waitForSelector('.modal')
  await page.locator('.platform-tile', { hasText: 'Telegram' }).click()
  await page.getByPlaceholder('Например: X · EN продукт').fill('TG · RU канал')
  await page.getByPlaceholder('EN', { exact: true }).fill('RU')
  await page.getByPlaceholder('123456:ABC-DEF…').fill('123456:TEST-TOKEN')
  await page.getByPlaceholder('@my_channel или -1001234567890').fill('@gridpost_demo')
  await shot(page, '02-wizard.png')
  await page.getByRole('button', { name: 'Сохранить' }).click()
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

  await page.getByRole('button', { name: 'Настройки' }).click()
  await page.waitForSelector('.account-row')
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
  console.error('SMOKE FAILED:', error.message)
  if (process.env.SCREENSHOT_ON_FAIL) console.error('data dir:', dataDir)
  process.exit(1)
})
