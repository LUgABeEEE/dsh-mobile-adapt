#!/usr/bin/env node
/**
 * A phone-shaped instance of the *real* DSH mobile page, on the development
 * machine (Linux, macOS or Windows).
 *
 *   node tools/phone-instance.mjs                      # just open it and screenshot
 *   node tools/phone-instance.mjs --inject packs/core-panel
 *   node tools/phone-instance.mjs --inject packs/core-panel --measure
 *   node tools/phone-instance.mjs --fresh              # forget the cached device, pair again
 *
 * Why this exists: `tools/check-pack.mjs` measures a fixture that reproduces the
 * shell's DOM. This one loads the page the phone would load — dsh-mobile's gateway,
 * its boot graph, its layout module — so a rule that only fails on the real DOM
 * fails here too, in seconds, without a device.
 *
 * Two things it does NOT replace: a real thumb, and the real WebView quirk set.
 *
 * Platform: the script is plain Node and does not need a POSIX shell; the only
 * native dependency is Playwright. `$DSH_HOME` defaults to `~/.dsh`
 * (`%USERPROFILE%\.dsh` on Windows) and is expanded the same way as in
 * `tools/install.mjs`. Playwright is resolved from `DSH_PLAYWRIGHT`, then
 * `$DSH_HOME/profiles/{web,desktop,headless}/node_modules`, then this repo.
 *
 * Authentication: a device is paired once and its cookies are cached in
 * `.cache/phone-state.json` (git-ignored). Pairing uses the loopback admin API to
 * open a one-time window, then the same form the phone would use. Nothing here
 * writes to $DSH_HOME's configuration; the only persisted change is one extra
 * device entry, revocable from the desktop Mobile access panel.
 *
 * The first new device also needs a device-scoped module selection: this profile's
 * `excludedClientModules` contain modules that no longer exist, and the gateway
 * refuses to boot the page for a device that inherits them. The recovery button on
 * that page does the same thing — `{excludedClientModules: []}` for this device only.
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 展开 `~` / `~/…`（Windows 用 `~\…`），与 install.mjs 的 DSH_HOME 语义保持一致。 */
function expandHome(value) {
  const trimmed = String(value).trim()
  if (trimmed === '~') return homedir()
  return /^~[\\/]/.test(trimmed) ? join(homedir(), trimmed.slice(2)) : trimmed
}

function resolveDshHome() {
  const configured = process.env.DSH_HOME
  const value = configured !== undefined && configured.trim() !== '' ? expandHome(configured) : join(homedir(), '.dsh')
  return resolve(value)
}

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const STATE = join(ROOT, '.cache', 'phone-state.json')
const SHOTS = join(ROOT, '.cache', 'shots')
const DSH_HOME = resolveDshHome()
const DEVICE_LABEL = process.platform === 'win32' ? 'windows-headless' : `${process.platform}-headless`
const VIEWPORT = { width: 390, height: 844 }
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1'

const argv = process.argv.slice(2)
const flag = name => argv.includes(`--${name}`)
const value = name => {
  const at = argv.indexOf(`--${name}`)
  return at < 0 ? undefined : argv[at + 1]
}

/**
 * `DSH_PLAYWRIGHT` may point at the package directory or at its entry file
 * (`…/node_modules/playwright` or `…/node_modules/playwright/index.js`): both are
 * valid with `createRequire` on every platform, including Windows drive paths.
 */
function loadPlaywright() {
  const configured = process.env.DSH_PLAYWRIGHT?.trim()
  if (configured !== undefined && configured !== '') {
    const target = resolve(expandHome(configured))
    try {
      return createRequire(import.meta.url)(target)
    } catch (error) {
      throw new Error([
        `DSH_PLAYWRIGHT 指向的 Playwright 无法加载：${target}`,
        error instanceof Error ? error.message : String(error),
        '它可以指向 playwright 的 index.js，也可以指向 playwright 包目录。',
      ].join('\n'))
    }
  }
  const tried = []
  for (const profile of ['web', 'desktop', 'headless']) {
    const anchor = join(DSH_HOME, 'profiles', profile, 'package.json')
    tried.push(anchor)
    if (!existsSync(anchor)) continue
    try { return createRequire(anchor)('playwright') } catch { /* next anchor */ }
  }
  throw new Error([
    'playwright not found：这个工具需要 Playwright（以及它自己的浏览器）。',
    `DSH_HOME：${DSH_HOME}`,
    '已尝试：',
    ...tried.map(item => `  - ${item}`),
    '安装：npm install --no-save --no-package-lock playwright && npx playwright install chromium',
    '或用 DSH_PLAYWRIGHT 指向已有的 playwright（index.js 或包目录）。',
  ].join('\n'))
}

/** The gateway origin comes from the plugin itself, never from a guess. */
async function gatewayOrigin() {
  let response
  try {
    response = await fetch('http://127.0.0.1:3080/api/mobile-access/status')
  } catch (error) {
    const detail = error instanceof Error && error.cause instanceof Error ? error.cause.message : error instanceof Error ? error.message : String(error)
    console.error(`无法连接本机 DSH 管理 API（127.0.0.1:3080）：${detail}`)
    console.error('请确认桌面端 DSH 正在运行，且「移动访问 → 局域网」已开启（见 docs/phone-instance.md）。')
    process.exit(1)
  }
  if (!response.ok) throw new Error(`mobile access status ${response.status}`)
  const status = await response.json()
  const origin = status?.gateway?.origin
  if (typeof origin !== 'string') throw new Error('mobile access gateway is not running (启用 移动访问 → 局域网)')
  return origin
}

async function openPairingWindow() {
  const response = await fetch('http://127.0.0.1:3080/api/mobile-access/pairing/open', {
    method: 'POST',
    headers: {
      origin: 'http://127.0.0.1:3080',
      'content-type': 'application/json',
      'x-dsh-mobile-web-admin': 'same-origin-json',
      'sec-fetch-site': 'same-origin',
    },
    body: '{}',
  })
  if (response.status !== 200 && response.status !== 201) throw new Error(`pairing/open ${response.status}`)
  return response.json()
}

async function needsPairing(page) {
  const url = page.url()
  if (url.includes('/mobile-access/pair')) return true
  const shell = await page.evaluate(() => document.querySelector('.dshm-shell') !== null).catch(() => false)
  return !shell
}

async function pair(ctx, page, origin) {
  const opened = await openPairingWindow()
  await page.goto(`${origin}/mobile-access/pair`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.fill('#pair-token', opened.token)
  await page.fill('#device-label', DEVICE_LABEL)
  await page.click('button[type=submit]')
  await page.waitForTimeout(1_200)

  const selection = await page.evaluate(async () => {
    const csrf = document.cookie.split(';').map(part => part.trim())
      .filter(part => part.startsWith('__Host-dsh_ma_csrf=') || part.startsWith('dsh_ma_csrf='))
      .map(part => part.slice(part.indexOf('=') + 1))[0]
    if (csrf === undefined) return 'no-csrf'
    const response = await fetch('/mobile-access/client-modules', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-dsh-mobile-csrf': csrf },
      body: JSON.stringify({ excludedClientModules: [] }),
    })
    return `client-modules ${response.status}`
  })
  console.log(`  paired as ${DEVICE_LABEL} (${selection})`)
  mkdirSync(dirname(STATE), { recursive: true })
  await ctx.storageState({ path: STATE })
  return opened
}

async function injectPack(page, packPath) {
  const dir = resolve(ROOT, packPath)
  const manifestPath = join(dir, 'extension.json')
  if (!existsSync(manifestPath)) throw new Error(`no pack at ${dir}`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const cssPath = join(dir, 'mobile.css')
  const jsPath = join(dir, 'mobile.js')
  if (existsSync(cssPath)) {
    const css = readFileSync(cssPath, 'utf8')
    const tag = await page.addStyleTag({ content: css })
    await tag.evaluate((node, id) => { node.dataset.injectedPack = id }, manifest.id)
    console.log(`  injected ${manifest.id}/mobile.css (${css.length} bytes)`)
  }
  if (existsSync(jsPath)) {
    const js = readFileSync(jsPath, 'utf8')
    await page.evaluate(source => {
      const script = document.createElement('script')
      script.textContent = `${source}\n//# sourceURL=phone-instance-injected.js`
      document.head.append(script)
      script.remove()
    }, js)
    console.log(`  injected ${manifest.id}/mobile.js (${js.length} bytes)`)
  }
  return manifest
}

let chromium
try {
  ({ chromium } = loadPlaywright())
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
const origin = await gatewayOrigin()
console.log(`phone instance · ${origin} · ${VIEWPORT.width}×${VIEWPORT.height} touch`)

const browser = await chromium.launch()
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: VIEWPORT,
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
  userAgent: UA,
  ...(flag('fresh') || !existsSync(STATE) ? {} : { storageState: STATE }),
})
const page = await ctx.newPage()
const consoleErrors = []
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200)) })

await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
await page.waitForTimeout(3_000)
if (await needsPairing(page)) {
  await pair(ctx, page, origin)
  // The pair page redirects, but the app document has to be fetched again now
  // that the device/session cookies exist.
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
}
await page.waitForSelector('.dshm-shell', { timeout: 30_000 }).catch(() => {})
await page.waitForTimeout(2_000)

const state = await page.evaluate(() => ({
  dedicated: window.__DSH_MOBILE_FRONTEND__ ?? null,
  shell: document.querySelector('.dshm-shell') !== null,
  drawer: document.querySelector('.dshm-drawer') !== null,
  main: document.querySelector('.dshm-main') !== null,
}))
console.log(`  dedicated=${state.dedicated} shell=${state.shell} drawer=${state.drawer} main=${state.main}`)
if (!state.shell) {
  console.error('  the dedicated mobile shell did not mount — see .cache/shots/phone-instance.png')
}

const pack = value('inject')
if (pack !== undefined) {
  await injectPack(page, pack)
  await page.waitForTimeout(1_500)
  const probe = await page.evaluate(() => {
    const style = document.querySelector('style[data-injected-pack]')
    const main = document.querySelector('.dshm-main')
    return {
      styleNode: style !== null,
      styleRules: style === null ? 0 : (style.sheet?.cssRules?.length ?? 0),
      panelAttr: main?.getAttribute('data-dsh-panel') ?? null,
      railVar: getComputedStyle(document.querySelector('.dshm-mainContent') ?? document.documentElement)
        .getPropertyValue('--dshm-rail').trim(),
    }
  })
  console.log(`  pack: style=${probe.styleNode} rules=${probe.styleRules} data-dsh-panel=${probe.panelAttr} rail=${probe.railVar || '(unset)'}`)
}

if (flag('measure')) {
  const measured = await page.evaluate(() => {
    const rect = selector => {
      const node = document.querySelector(selector)
      return node === null ? null : node.getBoundingClientRect().toJSON()
    }
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      shell: rect('.dshm-shell'),
      main: rect('.dshm-main'),
      drawer: rect('.dshm-drawer'),
      scrollWidth: document.documentElement.scrollWidth,
    }
  })
  console.log('  measure:', JSON.stringify(measured))
}

mkdirSync(SHOTS, { recursive: true })
const shot = join(SHOTS, pack === undefined ? 'phone-instance.png' : `phone-instance-${String(pack).split(/[\\/]/).pop()}.png`)
await page.screenshot({ path: shot })
console.log(`  screenshot → ${shot}`)
if (consoleErrors.length > 0) console.log(`  console errors: ${consoleErrors.length} (first: ${consoleErrors[0].slice(0, 120)})`)

if (pack === undefined) await ctx.storageState({ path: STATE })
await browser.close()
