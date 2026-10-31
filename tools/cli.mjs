#!/usr/bin/env node
/**
 * dsh-adapt-packs · CLI
 *
 *   dsh-adapt-packs list               catalog 里的包（含与磁盘的一致性检查）
 *   dsh-adapt-packs compat            第三方插件在手机上的适配结论（兼容清单）
 *   dsh-adapt-packs status            本机装了哪些包、哪些被停用
 *   dsh-adapt-packs install <id>      安装到 $DSH_HOME/mobile-access/extensions/<id>
 *   dsh-adapt-packs uninstall <id>    移到 $DSH_HOME/mobile-access-adapt-disabled/<id>
 *   dsh-adapt-packs check [packs…]    跑校验（需要 Playwright + Chromium）
 *
 * install / uninstall / check 都是对同目录脚本的透传：真正的实现仍然只有
 * tools/install.mjs 与 tools/check-pack.mjs 各一份，CLI 不复制逻辑。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CATALOG = join(ROOT, 'catalog.json')
const COMPAT = join(ROOT, 'compat.json')
const PACKS = join(ROOT, 'packs')

function packageMeta() {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
}

/** 与 install.mjs 同口径：trim、展开 ~、resolve；缺省 ~/.dsh。 */
function resolveDshHome() {
  const configured = process.env.DSH_HOME
  if (configured === undefined || configured.trim() === '') return join(homedir(), '.dsh')
  const trimmed = configured.trim()
  const expanded = trimmed === '~' ? homedir() : /^~[\\/]/.test(trimmed) ? join(homedir(), trimmed.slice(2)) : trimmed
  return resolve(expanded)
}

/** 中日韩字符按 2 列宽计算，表格才排得齐。 */
function width(text) {
  return [...String(text)].reduce((total, character) => total + (character.codePointAt(0) > 0x2e80 ? 2 : 1), 0)
}
function padEnd(text, size) {
  return String(text) + ' '.repeat(Math.max(0, size - width(text)))
}

function usage() {
  return [
    'dsh-adapt-packs · opt-in adaptation packs for the DSH mobile surface',
    '',
    '用法：',
    '  dsh-adapt-packs list                          列出 catalog 与磁盘上的包',
    '  dsh-adapt-packs compat [--verdict <v>] [--json]  第三方插件的手机适配结论',
    '  dsh-adapt-packs status [--json]               本机已装 / 已停用 / 未装的包',
    '  dsh-adapt-packs install <id> [--yes]          安装（默认 dry-run，--yes 才写盘）',
    '  dsh-adapt-packs uninstall <id> [--yes]        卸载（移出，可恢复）',
    '  dsh-adapt-packs check [packs…] [--json] [--desktop]   跑校验（需要 Playwright + Chromium）',
    '  dsh-adapt-packs --version | --help',
    '',
    'verdict 取值：native（原生可用）/ pack（本仓库有适配包）/ upstream（该插件自己改）/ blocked（做不了）',
    '$DSH_HOME 缺省 ~/.dsh（Windows：%USERPROFILE%\\.dsh），目标目录由它推导。',
  ].join('\n')
}

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    console.error(`无法读取 ${label}：${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

function readCatalog() {
  const parsed = readJson(CATALOG, 'catalog.json')
  return { schemaVersion: parsed.schemaVersion, updated: parsed.updated, packs: Array.isArray(parsed.packs) ? parsed.packs : [] }
}

function list() {
  const meta = packageMeta()
  const catalog = readCatalog()
  const rows = []
  const problems = []

  for (const entry of catalog.packs) {
    const dir = join(PACKS, entry.id)
    const manifestFile = join(dir, 'extension.json')
    let manifest = null
    if (!existsSync(dir)) {
      problems.push(`catalog 里有 ${entry.id}，但 packs/${entry.id}/ 不存在`)
    } else if (!existsSync(manifestFile)) {
      problems.push(`packs/${entry.id}/ 缺少 extension.json`)
    } else {
      try {
        manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
        if (manifest.id !== entry.id) problems.push(`packs/${entry.id}/extension.json 的 id 是 ${manifest.id}`)
      } catch (error) {
        problems.push(`packs/${entry.id}/extension.json 解析失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    rows.push({
      id: entry.id,
      version: manifest?.version ?? '—',
      status: entry.status ?? '—',
      risk: entry.risk ?? '—',
      byDefault: entry.default ?? '—',
      target: entry.target?.package === undefined ? '—' : `${entry.target.package}@${entry.target.version ?? '*'}`,
      capabilities: Array.isArray(entry.capabilities) ? entry.capabilities.join('+') : '—',
    })
  }

  console.log(`dsh-adapt-packs ${meta.version} · catalog ${catalog.updated ?? '?'} · ${rows.length} pack(s)`)
  console.log('')
  for (const row of rows) {
    console.log(`  ${padEnd(row.id, 20)} ${padEnd(row.version, 7)} ${padEnd(row.status, 12)} ${padEnd(row.risk, 6)} default=${padEnd(row.byDefault, 4)} ${row.target}`)
    console.log(`  ${' '.repeat(20)} ${row.capabilities}`)
  }
  console.log('')
  if (problems.length === 0) {
    console.log('catalog 与 packs/ 一致。')
    return 0
  }
  console.error('一致性问题：')
  for (const problem of problems) console.error(`  - ${problem}`)
  return 1
}

function compat(argv) {
  const json = argv.includes('--json')
  const index = argv.indexOf('--verdict')
  const wanted = index === -1 ? null : argv[index + 1]
  const parsed = readJson(COMPAT, 'compat.json')
  const entries = (parsed.entries ?? []).filter((entry) => wanted === null || entry.verdict === wanted)

  if (json) {
    console.log(JSON.stringify({ schemaVersion: parsed.schemaVersion, updated: parsed.updated, entries }, null, 2))
    return 0
  }

  console.log(`兼容清单 · 更新于 ${parsed.updated ?? '?'} · ${entries.length} 个插件${wanted === null ? '' : `（${wanted}）`}`)
  const counts = new Map()
  for (const entry of parsed.entries ?? []) counts.set(entry.verdict, (counts.get(entry.verdict) ?? 0) + 1)
  console.log(`  汇总：${[...counts.entries()].map(([verdict, count]) => `${verdict} ${count}`).join(' · ')}`)
  console.log('')
  for (const entry of entries) {
    const pack = entry.pack === undefined ? '' : ` · pack=${entry.pack}`
    console.log(`  ${padEnd(entry.plugin, 34)} ${padEnd(entry.version ?? '—', 8)} ${padEnd(entry.verdict, 9)}${pack}`)
    console.log(`    ${entry.summary ?? ''}`)
    console.log(`    手机：${entry.mobile ?? '—'}`)
    if (entry.links?.repo !== undefined) console.log(`    ${entry.links.repo}`)
    console.log('')
  }
  return 0
}

function status(argv) {
  const home = resolveDshHome()
  const json = argv.includes('--json')
  const installedRoot = join(home, 'mobile-access', 'extensions')
  const disabledRoot = join(home, 'mobile-access-adapt-disabled')
  const catalog = readCatalog()

  const scan = (root) => {
    if (!existsSync(root)) return new Map()
    const found = new Map()
    for (const name of readdirSync(root)) {
      const manifestFile = join(root, name, 'extension.json')
      if (!existsSync(manifestFile)) continue
      try {
        found.set(name, JSON.parse(readFileSync(manifestFile, 'utf8')))
      } catch {
        found.set(name, { id: name, version: '?' })
      }
    }
    return found
  }

  const installed = scan(installedRoot)
  const disabled = scan(disabledRoot)
  const packVersion = (id) => {
    try {
      return JSON.parse(readFileSync(join(PACKS, id, 'extension.json'), 'utf8')).version ?? '—'
    } catch {
      return '—'
    }
  }
  const rows = catalog.packs.map((entry) => ({
    id: entry.id,
    catalogVersion: packVersion(entry.id),
    installed: installed.has(entry.id) ? installed.get(entry.id).version ?? '?' : null,
    disabled: disabled.has(entry.id) ? disabled.get(entry.id).version ?? '?' : null,
    status: entry.status ?? '—',
  }))
  const stray = [...installed.keys()].filter((id) => !catalog.packs.some((entry) => entry.id === id))

  if (json) {
    console.log(JSON.stringify({ dshHome: home, installedRoot, disabledRoot, rows, stray }, null, 2))
    return 0
  }

  console.log(`dsh-adapt-packs ${packageMeta().version}`)
  console.log(`DSH_HOME：${home}`)
  console.log('')
  for (const row of rows) {
    const state = row.installed !== null ? `已装 ${row.installed}` : row.disabled !== null ? `已停用 ${row.disabled}` : '未装'
    console.log(`  ${padEnd(row.id, 20)} ${padEnd(state, 14)} catalog ${row.catalogVersion} · ${row.status}`)
  }
  if (stray.length > 0) {
    console.log('')
    console.log(`已装但不在 catalog 里：${stray.join(', ')}（可能是旧版本或手工放进去的）`)
  }
  if (installed.size === 0 && disabled.size === 0) {
    console.log('')
    console.log('还没装任何包。试试：dsh-adapt-packs install core-panel --yes')
  }
  return 0
}

function runTool(script, args) {
  const result = spawnSync(process.execPath, [join(ROOT, 'tools', script), ...args], { stdio: 'inherit', cwd: ROOT })
  if (result.error !== undefined) {
    console.error(`无法运行 ${script}：${result.error.message}`)
    return 1
  }
  return result.status ?? 1
}

const argv = process.argv.slice(2)
const [command, ...rest] = argv

if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
  console.log(usage())
  process.exit(command === undefined ? 1 : 0)
}

if (command === '--version' || command === '-v') {
  console.log(packageMeta().version)
  process.exit(0)
}

if (command === 'list') process.exit(list())
if (command === 'compat') process.exit(compat(rest))
if (command === 'status') process.exit(status(rest))

if (command === 'install' || command === 'uninstall') {
  if (rest.length === 0) {
    console.error(`${command} 需要 <id>。\n\n${usage()}`)
    process.exit(2)
  }
  const args = command === 'install' ? ['pack', ...rest] : ['--uninstall', ...rest]
  process.exit(runTool('install.mjs', args))
}

if (command === 'check') process.exit(runTool('check-pack.mjs', rest))

console.error(`未知命令：${command}\n\n${usage()}`)
process.exit(2)
