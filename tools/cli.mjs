#!/usr/bin/env node
/**
 * dsh-adapt-packs · CLI
 *
 *   dsh-adapt-packs list                      列出 catalog 里的包（含与磁盘的一致性检查）
 *   dsh-adapt-packs install <id> [--yes]      安装到 $DSH_HOME/mobile-access/extensions/<id>
 *   dsh-adapt-packs uninstall <id> [--yes]    移到 $DSH_HOME/mobile-access-adapt-disabled/<id>
 *   dsh-adapt-packs check [packs…] [--json] [--desktop]
 *
 * install / uninstall / check 都是对同目录脚本的透传：真正的实现仍然只有
 * tools/install.mjs 与 tools/check-pack.mjs 各一份，CLI 不复制逻辑。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CATALOG = join(ROOT, 'catalog.json')
const PACKS = join(ROOT, 'packs')

function packageMeta() {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
}

function usage() {
  return [
    'dsh-adapt-packs · opt-in adaptation packs for the DSH mobile surface',
    '',
    '用法：',
    '  dsh-adapt-packs list                          列出 catalog 与磁盘上的包',
    '  dsh-adapt-packs install <id> [--yes]          安装（默认 dry-run，--yes 才写盘）',
    '  dsh-adapt-packs uninstall <id> [--yes]        卸载（移出，可恢复）',
    '  dsh-adapt-packs check [packs…] [--json] [--desktop]   跑校验（需要 Playwright + Chromium）',
    '  dsh-adapt-packs --version | --help',
    '',
    '$DSH_HOME 缺省 ~/.dsh（Windows：%USERPROFILE%\\.dsh），目标目录由它推导。',
  ].join('\n')
}

function readCatalog() {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(CATALOG, 'utf8'))
  } catch (error) {
    console.error(`无法读取 catalog.json：${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
  const packs = Array.isArray(parsed.packs) ? parsed.packs : []
  return { schemaVersion: parsed.schemaVersion, updated: parsed.updated, packs }
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
    console.log(`  ${row.id.padEnd(20)} ${row.version.padEnd(7)} ${row.status.padEnd(12)} ${row.risk.padEnd(6)} default=${row.byDefault.padEnd(4)} ${row.target}`)
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

if (command === 'list') {
  process.exit(list())
}

if (command === 'install' || command === 'uninstall') {
  if (rest.length === 0) {
    console.error(`${command} 需要 <id>。\n\n${usage()}`)
    process.exit(2)
  }
  const args = command === 'install' ? ['pack', ...rest] : ['--uninstall', ...rest]
  process.exit(runTool('install.mjs', args))
}

if (command === 'check') {
  process.exit(runTool('check-pack.mjs', rest))
}

console.error(`未知命令：${command}\n\n${usage()}`)
process.exit(2)
