#!/usr/bin/env node
/**
 * Real-device verification driver.
 *
 * Thin, explicit wrapper around adb: it never guesses coordinates and never
 * simulates a "pass". A human (or an agent reading the screenshot) decides what
 * a run means; this tool only collects state and takes the screenshot.
 *
 *   node tools/device-verify/run.mjs devices
 *   node tools/device-verify/run.mjs info --serial <id>
 *   node tools/device-verify/run.mjs overlay on|off
 *   node tools/device-verify/run.mjs shot  --label before-open
 *   node tools/device-verify/run.mjs tap   --x 120 --y 480
 *   node tools/device-verify/run.mjs swipe --x1 200 --y1 700 --x2 200 --y2 300
 *   node tools/device-verify/run.mjs rotate 0|1
 *   node tools/device-verify/run.mjs key home|back|enter
 *
 * DSH_HOME defaults to ~/.dsh; the overlay is written to
 * <DSH_HOME>/mobile-access/mobile.js and restored by `overlay off`.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ADB = process.env.ADB ?? '/data/agent/tools/android/platform-tools/adb'
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const CUSTOM_JS = join(DSH_HOME, 'mobile-access', 'mobile.js')
const CUSTOM_BACKUP = join(DSH_HOME, 'mobile-access', 'mobile.js.device-verify-backup')
const OUT_ROOT = join(ROOT, '.cache', 'device-verify')

function fail(message) {
  console.error(`device-verify: ${message}`)
  process.exit(1)
}

function parse(argv) {
  const [command, ...rest] = argv
  const options = {}
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index]
    if (item.startsWith('--')) {
      const key = item.slice(2)
      const value = rest[index + 1] !== undefined && !rest[index + 1].startsWith('--') ? rest[++index] : 'true'
      options[key] = value
    } else if (options.positional === undefined) options.positional = item
    else options.positional += ` ${item}`
  }
  return { command, options }
}

function adb(args, { serial } = {}) {
  const full = serial === undefined ? args : ['-s', serial, ...args]
  return execFileSync(ADB, full, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function adbBuffer(args, { serial } = {}) {
  const full = serial === undefined ? args : ['-s', serial, ...args]
  return execFileSync(ADB, full, { encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 })
}

function devices() {
  return adb(['devices', '-l']).trim()
}

function serial(options) {
  if (options.serial !== undefined) return options.serial
  const lines = devices().split('\n').slice(1).filter(line => line.includes('\tdevice'))
  if (lines.length === 0) fail('no authorized device; plug in USB and accept the RSA prompt')
  return lines[0].split(/\s+/u)[0]
}

function info(target) {
  const props = ['ro.product.model', 'ro.product.brand', 'ro.build.version.release', 'ro.build.version.sdk', 'ro.product.cpu.abi']
  const table = {}
  for (const prop of props) table[prop] = adb(['shell', 'getprop', prop], { serial: target }).trim()
  table.size = adb(['shell', 'wm', 'size'], { serial: target }).trim()
  table.density = adb(['shell', 'wm', 'density'], { serial: target }).trim()
  try {
    const webview = adb(['shell', 'dumpsys', 'webviewupdate'], { serial: target })
    table.webview = (webview.match(/Current WebView package[^\n]*/u) ?? [''])[0].trim()
  } catch { table.webview = 'unavailable' }
  try {
    table.app = adb(['shell', 'dumpsys', 'package', 'io.github.sayach.dshmobile'], { serial: target })
      .split('\n').find(line => line.includes('versionName='))?.trim() ?? 'not installed'
  } catch { table.app = 'not installed' }
  return table
}

const OVERLAY_MARKER = 'dsh-verify-overlay'

function isOverlay(path) {
  try { return readFileSync(path, 'utf8').includes(OVERLAY_MARKER) } catch { return false }
}

function overlayOn() {
  mkdirSync(dirname(CUSTOM_JS), { recursive: true })
  // Only a real user file is worth restoring; a previous overlay must never become
  // its own "backup", which would leave the overlay installed after `overlay off`.
  if (!existsSync(CUSTOM_BACKUP) && existsSync(CUSTOM_JS) && !isOverlay(CUSTOM_JS)) copyFileSync(CUSTOM_JS, CUSTOM_BACKUP)
  copyFileSync(join(ROOT, 'tools', 'device-verify', 'overlay.js'), CUSTOM_JS)
  console.log(`overlay written to ${CUSTOM_JS}`)
  console.log('the gateway picks it up within ~2s; reopen or reload the mobile page')
}

function overlayOff() {
  const backupIsReal = existsSync(CUSTOM_BACKUP) && !isOverlay(CUSTOM_BACKUP)
  if (backupIsReal) {
    copyFileSync(CUSTOM_BACKUP, CUSTOM_JS)
    rmSync(CUSTOM_BACKUP)
    console.log('overlay removed, previous mobile.js restored')
    return
  }
  if (existsSync(CUSTOM_BACKUP)) rmSync(CUSTOM_BACKUP)
  if (existsSync(CUSTOM_JS) && isOverlay(CUSTOM_JS)) {
    rmSync(CUSTOM_JS)
    console.log('overlay removed')
    return
  }
  console.log(existsSync(CUSTOM_JS) ? 'mobile.js is not ours; left untouched' : 'no overlay present')
}

function shot(target, label) {
  const directory = join(OUT_ROOT, target, new Date().toISOString().replace(/[:.]/gu, '-'))
  mkdirSync(directory, { recursive: true })
  const name = `${label ?? 'shot'}.png`
  writeFileSync(join(directory, name), adbBuffer(['exec-out', 'screencap', '-p'], { serial: target }))
  console.log(`screenshot → ${join(directory, name)}`)
}

function main() {
  const { command, options } = parse(process.argv.slice(2))
  switch (command) {
    case 'devices': console.log(devices()); return
    case 'info': console.log(JSON.stringify(info(serial(options)), null, 2)); return
    case 'overlay':
      if (options.positional === 'on') overlayOn()
      else if (options.positional === 'off') overlayOff()
      else fail('overlay needs on|off')
      return
    case 'shot': shot(serial(options), options.label); return
    case 'tap': {
      const target = serial(options)
      if (options.x === undefined || options.y === undefined) fail('tap needs --x and --y')
      adb(['shell', 'input', 'tap', String(options.x), String(options.y)], { serial: target })
      console.log(`tap ${options.x},${options.y}`)
      return
    }
    case 'swipe': {
      const target = serial(options)
      for (const key of ['x1', 'y1', 'x2', 'y2']) if (options[key] === undefined) fail(`swipe needs --${key}`)
      adb(['shell', 'input', 'swipe', String(options.x1), String(options.y1), String(options.x2), String(options.y2), String(options.duration ?? 300)], { serial: target })
      console.log('swipe sent')
      return
    }
    case 'rotate': {
      const target = serial(options)
      const value = options.positional === '1' ? '1' : '0'
      adb(['shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0'], { serial: target })
      adb(['shell', 'settings', 'put', 'system', 'user_rotation', value], { serial: target })
      console.log(`rotation ${value}`)
      return
    }
    case 'key': {
      const target = serial(options)
      const map = { home: '3', back: '4', enter: '66', power: '26' }
      const code = map[options.positional]
      if (code === undefined) fail('key needs home|back|enter|power')
      adb(['shell', 'input', 'keyevent', code], { serial: target })
      console.log(`key ${options.positional}`)
      return
    }
    default:
      console.log(readFileSync(join(ROOT, 'tools', 'device-verify', 'run.mjs'), 'utf8').split('*/')[0])
      fail(`unknown command: ${String(command)}`)
  }
}

main()
