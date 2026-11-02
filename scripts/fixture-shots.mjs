#!/usr/bin/env node
/**
 * fixture-shots.mjs — before/after screenshots for a directed fixture.
 *
 *   node scripts/fixture-shots.mjs packs/<id> [--out DIR] [--width 390 --height 844]
 *
 * Renders `packs/<id>/fixture.html` in headless Chromium at 390×844 with a coarse
 * pointer and DPR 2, then again after injecting the pack's own `mobile.css` and
 * running its `mobile.js` through a minimal `window.dshMobile.define` shim (the same
 * contract check-pack uses). Writes `before-<w>x<h>.png` / `after-<w>x<h>.png` into
 * `<pack>/shots/` unless `--out` is given.
 *
 * These are **fixture** screenshots, not device screenshots: the fixture is a
 * synthetic DOM, and no host/plugin was installed. They are the visual companion to
 * `node tools/check-pack.mjs`; a device still owns thumb reach, safe-area and the
 * soft keyboard. Read-only: never writes to $DSH_HOME.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')

const args = process.argv.slice(2)
const packArg = args.find(value => value.startsWith('--') === false)
if (packArg === undefined) {
  console.error('用法：node scripts/fixture-shots.mjs packs/<id> [--out DIR] [--width 390 --height 844]')
  process.exit(2)
}

function flag(name, fallback) {
  const index = args.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = args[index + 1]
  return value === undefined ? fallback : value
}

const packDir = path.resolve(process.cwd(), packArg)
const fixturePath = path.join(packDir, 'fixture.html')
const cssPath = path.join(packDir, 'mobile.css')
const jsPath = path.join(packDir, 'mobile.js')
if (existsSync(fixturePath) === false) {
  console.error(`找不到 fixture：${fixturePath}`)
  process.exit(2)
}

const width = Number(flag('width', '390'))
const height = Number(flag('height', '844'))
const outDir = path.resolve(process.cwd(), flag('out', path.join(packDir, 'shots')))
mkdirSync(outDir, { recursive: true })

function loadPlaywright() {
  const anchors = []
  const configured = process.env.DSH_PLAYWRIGHT?.trim()
  if (configured !== undefined && configured !== '') anchors.push(path.resolve(configured))
  const home = process.env.DSH_HOME?.trim() || path.join(homedir(), '.dsh')
  for (const profile of ['web', 'desktop', 'headless']) anchors.push(path.join(home, 'profiles', profile, 'package.json'))
  anchors.push(path.join(REPO, 'package.json'))
  for (const anchor of anchors) {
    try {
      return createRequire(anchor === REPO ? import.meta.url : anchor)('playwright')
    } catch {
      // try the next anchor
    }
  }
  try {
    return createRequire(import.meta.url)('playwright')
  } catch {
    console.error('playwright not found：需要 Playwright + Chromium（npm install --no-save playwright && npx playwright install chromium）')
    process.exit(2)
  }
}

const { chromium } = loadPlaywright()
const fixture = readFileSync(fixturePath, 'utf8')
const css = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : ''
const js = existsSync(jsPath) ? readFileSync(jsPath, 'utf8') : ''

const browser = await chromium.launch()
try {
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  })
  const page = await context.newPage()
  await page.setContent(fixture, { waitUntil: 'load' })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const beforePath = path.join(outDir, `before-${width}x${height}.png`)
  await page.screenshot({ path: beforePath })

  if (css !== '') await page.addStyleTag({ content: css })
  if (js !== '') {
    await page.evaluate(() => {
      window.__fixtureDefinitions = []
      window.dshMobile = { define(definition) { window.__fixtureDefinitions.push(definition) }, register() {} }
    })
    await page.addScriptTag({ content: js })
    await page.evaluate(async () => {
      for (const definition of window.__fixtureDefinitions ?? []) {
        await definition.activate({ document, window, signal: new AbortController().signal })
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })
    await page.waitForTimeout(250)
  }
  const afterPath = path.join(outDir, `after-${width}x${height}.png`)
  await page.screenshot({ path: afterPath })
  await context.close()
  console.log(`before: ${path.relative(process.cwd(), beforePath)}`)
  console.log(`after:  ${path.relative(process.cwd(), afterPath)}`)
} finally {
  await browser.close()
}
