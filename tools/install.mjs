#!/usr/bin/env node
/**
 * dsh-mobile-adapt · 安装 / 卸载（回滚）
 *
 * 把 packs/<id>/ 复制到 dsh-mobile 的扩展运行时目录，或把它移走。
 * 运行时目录由 $DSH_HOME 推导（缺省 ~/.dsh）：
 *
 *   <DSH_HOME>/mobile-access/extensions/<id>/        ← 安装目标
 *   <DSH_HOME>/mobile-access-adapt-disabled/<id>/    ← 卸载后的移出位置（可恢复）
 *
 * 安全约定：
 *   - 默认 dry-run：只打印目标绝对路径、文件清单、将执行的动作与回滚指令，不写任何文件；
 *   - 真正写入/移动必须显式 --yes；
 *   - 目标已存在时拒绝覆盖（先 --uninstall，避免手改过的目录被静默覆盖）；
 *   - id 必须匹配 ^[a-z][a-z0-9-]{0,63}$，路径由 path.join 推导，不接受任意路径。
 *
 * 平台：Linux / macOS / Windows。脚本本身不依赖 shell；打印出来的“动作”会按当前
 * 平台给出 POSIX 或 PowerShell 形式，直接复制即可复现。Windows 上 $DSH_HOME 缺省
 * %USERPROFILE%\.dsh，PowerShell 需用 `$env:DSH_HOME = 'D:\dsh'` 设置；卸载是同一
 * 卷内的 rename，跨卷（EXDEV，Windows 对应 ERROR_NOT_SAME_DEVICE）会自动退化为
 * 复制 + 删除。
 *
 * 用法：
 *   node tools/install.mjs pack <id> [--dry-run] [--yes]
 *   node tools/install.mjs --uninstall <id> [--dry-run] [--yes]
 */
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKS_DIR = join(REPO, 'packs')
const CATALOG_FILE = join(REPO, 'catalog.json')
const ID_RE = /^[a-z][a-z0-9-]{0,63}$/
const MAX_RAIL_NOTE = '扩展目录每 2s 轮询一次：复制或移走后无需重启 dsh-mobile。'
const WINDOWS = process.platform === 'win32'

function usage() {
  return [
    '用法：',
    '  node tools/install.mjs pack <id> [--dry-run] [--yes]',
    '  node tools/install.mjs --uninstall <id> [--dry-run] [--yes]',
    '',
    '  pack <id>            安装一张适配包到 $DSH_HOME/mobile-access/extensions/<id>',
    '  --uninstall <id>     卸载：把扩展目录移到 $DSH_HOME/mobile-access-adapt-disabled/<id>（可恢复）',
    '  --dry-run            只打印计划，不写文件（默认行为）',
    '  --yes                真正执行；省略即 dry-run',
    '',
    '  $DSH_HOME 缺省 ~/.dsh（Windows：%USERPROFILE%\\.dsh）；目标目录由它推导，不接受手工路径。',
    WINDOWS
      ? '  PowerShell 设置：$env:DSH_HOME = \'D:\\dsh\'    cmd 设置：set DSH_HOME=D:\\dsh'
      : '  POSIX 设置：export DSH_HOME=/path/to/.dsh',
  ].join('\n')
}

function fail(message) {
  console.error(`错误：${message}`)
  process.exit(1)
}

function failUsage(message) {
  console.error(`错误：${message}`)
  console.error('')
  console.error(usage())
  process.exit(2)
}

/** POSIX / PowerShell 都可粘贴的路径引号。 */
function quote(value) {
  const text = String(value)
  return WINDOWS ? `'${text.replace(/'/g, "''")}'` : `'${text.replace(/'/g, "'\\''")}'`
}

function mkdirCommand(directory) {
  return WINDOWS
    ? `New-Item -ItemType Directory -Force -Path ${quote(directory)} | Out-Null`
    : `mkdir -p ${quote(directory)}`
}

function copyCommand(source, destination) {
  return WINDOWS
    ? `Copy-Item -Recurse -Force -Path ${quote(source)} -Destination ${quote(destination)}`
    : `cp -R ${quote(source)} ${quote(destination)}`
}

function moveCommand(source, destination) {
  return WINDOWS
    ? `Move-Item -Force -Path ${quote(source)} -Destination ${quote(destination)}`
    : `mv ${quote(source)} ${quote(destination)}`
}

function removeCommand(target) {
  return WINDOWS ? `Remove-Item -Recurse -Force -Path ${quote(target)}` : `rm -rf ${quote(target)}`
}

function parseArgs(argv) {
  const options = { mode: null, id: null, dryRun: false, yes: false, help: false }
  const rest = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--dry-run') options.dryRun = true
    else if (argument === '--yes') options.yes = true
    else if (argument === '--help' || argument === '-h') options.help = true
    else if (argument === 'pack' || argument === 'uninstall') {
      if (options.mode !== null) failUsage(`只能有一个动作，收到 ${options.mode} 与 ${argument}`)
      options.mode = argument
    } else if (argument === '--uninstall') {
      if (options.mode !== null) failUsage(`只能有一个动作，收到 ${options.mode} 与 --uninstall`)
      options.mode = 'uninstall'
    } else rest.push(argument)
  }
  if (options.help) return options
  if (options.mode === null) failUsage('缺少动作（pack <id> 或 --uninstall <id>）')
  if (rest.length !== 1) failUsage(`需要且只需要一个包 id，收到 ${rest.length === 0 ? '0 个' : rest.join(' ')}`)
  options.id = rest[0]
  if (options.dryRun && options.yes) failUsage('--dry-run 与 --yes 不能同时使用')
  if (!ID_RE.test(options.id)) failUsage(`包 id 不合法：${options.id}（需匹配 ${ID_RE}）`)
  return options
}

/** 展开 `~` / `~/…`，让 POSIX 与 Windows 的 DSH_HOME 写法都可用。 */
function expandHome(value) {
  const trimmed = String(value).trim()
  if (trimmed === '~') return homedir()
  return /^~[\\/]/.test(trimmed) ? join(homedir(), trimmed.slice(2)) : trimmed
}

function dshHome() {
  const configured = process.env.DSH_HOME
  const value = configured !== undefined && configured.trim() !== '' ? expandHome(configured) : join(homedir(), '.dsh')
  return resolve(value)
}

function readManifest(packDir) {
  const manifestFile = join(packDir, 'extension.json')
  let value
  try {
    value = JSON.parse(readFileSync(manifestFile, 'utf8'))
  } catch (error) {
    fail(`读不到合法的 ${manifestFile}：${error instanceof Error ? error.message : String(error)}`)
  }
  const keys = Object.keys(value).sort().join(',')
  if (keys !== 'description,id,name,schemaVersion,version') fail(`${manifestFile} 字段集合不是恰好 5 个（实际 ${keys}）`)
  if (value.schemaVersion !== 1) fail(`${manifestFile} 的 schemaVersion 必须为 1`)
  if (value.id !== basename(packDir)) fail(`${manifestFile} 的 id（${value.id}）必须等于目录名（${basename(packDir)}）`)
  return value
}

function readCatalogEntry(id) {
  let catalog
  try {
    catalog = JSON.parse(readFileSync(CATALOG_FILE, 'utf8'))
  } catch (error) {
    fail(`读不到合法的 catalog.json：${error instanceof Error ? error.message : String(error)}`)
  }
  const entry = Array.isArray(catalog.packs) ? catalog.packs.find(item => item !== null && item.id === id) : undefined
  if (entry === undefined) fail(`catalog.json 里没有 ${id} 的条目：未收录的包不能安装（见 docs/收录标准.md）`)
  return entry
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** 递归列出包内文件（相对 POSIX 路径），按路径排序。 */
function listFiles(root) {
  const files = []
  const walk = current => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = join(current, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else if (entry.isFile()) {
        files.push({
          relative: relative(root, absolute).split('\\').join('/'),
          bytes: statSync(absolute).size,
          digest: sha256(absolute),
        })
      }
    }
  }
  walk(root)
  return files
}

function humanBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/**
 * rename 跨卷会失败：Windows 报 EXDEV（ERROR_NOT_SAME_DEVICE），退化为复制 + 删除
 * （只有源目录完整复制成功才删）。Windows 上 EPERM/EACCES/EBUSY 通常意味着目录正
 * 被宿主轮询、杀软或编辑器占用，给出可操作的提示而不是裸错误。
 */
function moveDirectory(from, to) {
  try {
    renameSync(from, to)
  } catch (error) {
    const code = error !== null && typeof error === 'object' ? error.code : undefined
    if (code === 'EXDEV') {
      cpSync(from, to, { recursive: true })
      rmSync(from, { recursive: true, force: true })
      return
    }
    if (WINDOWS && (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY')) {
      fail(`移动失败（${code}）：目标可能正被占用。关闭占用 ${from} 的程序（宿主轮询、杀软扫描、编辑器）后重试。原始错误：${error instanceof Error ? error.message : String(error)}`)
    }
    throw error
  }
}

function printInstallPlan({ manifest, entry, packDir, target, files, execute }) {
  const title = execute ? '安装（写入）' : '安装（dry-run）'
  console.log(`dsh-mobile-adapt · ${title}`)
  console.log('')
  console.log(`包：      ${manifest.id} ${manifest.version}（catalog: ${entry.status} / risk ${entry.risk} / default ${entry.default}）`)
  console.log(`来源：    ${packDir}`)
  console.log(`DSH_HOME：${dshHome()}`)
  console.log(`目标：    ${target}`)
  console.log(`目标状态：${existsSync(target) ? '已存在（--yes 会拒绝覆盖）' : '不存在'}`)
  console.log('')
  console.log(`文件（${files.length}）：`)
  for (const file of files) {
    console.log(`  ${file.relative.padEnd(20)} ${humanBytes(file.bytes).padStart(9)}  sha256:${file.digest.slice(0, 12)}`)
  }
  console.log('')
  console.log('动作：')
  console.log(`  ${mkdirCommand(dirname(target))}`)
  console.log(`  ${copyCommand(packDir, target)}`)
  console.log('')
  console.log('回滚（移走目录，可恢复）：')
  console.log(`  node tools/install.mjs --uninstall ${manifest.id} --yes`)
  console.log(`  或手工：${moveCommand(target, join(dshHome(), 'mobile-access-adapt-disabled', manifest.id))}`)
  console.log(`  或手工删除：${removeCommand(target)}`)
  console.log('')
  if (execute === false) {
    console.log('dry-run：未写入任何文件。确认无误后加 --yes 执行。')
  } else {
    console.log(`已安装。${MAX_RAIL_NOTE}`)
  }
}

function install(options) {
  const packDir = join(PACKS_DIR, options.id)
  if (existsSync(packDir) === false || statSync(packDir).isDirectory() === false) fail(`仓库里没有 packs/${options.id}`)
  const manifest = readManifest(packDir)
  const entry = readCatalogEntry(options.id)
  const target = join(dshHome(), 'mobile-access', 'extensions', options.id)
  const files = listFiles(packDir)
  const execute = options.yes === true

  if (execute === true && existsSync(target) === true) {
    fail(`目标已存在，拒绝覆盖：${target}\n先回滚：node tools/install.mjs --uninstall ${options.id} --yes`)
  }

  printInstallPlan({ manifest, entry, packDir, target, files, execute })
  if (execute === false) return
  mkdirSync(dirname(target), { recursive: true })
  cpSync(packDir, target, { recursive: true })
  console.log('')
  console.log(`已写入 ${files.length} 个文件到 ${target}`)
}

function uninstall(options) {
  const target = join(dshHome(), 'mobile-access', 'extensions', options.id)
  const disabledRoot = join(dshHome(), 'mobile-access-adapt-disabled')
  const disabledBase = join(disabledRoot, options.id)
  const execute = options.yes === true
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const disabled = existsSync(disabledBase) ? `${disabledBase}-${stamp}` : disabledBase

  console.log(`dsh-mobile-adapt · 卸载（${execute ? '写入' : 'dry-run'}）`)
  console.log('')
  console.log(`DSH_HOME：${dshHome()}`)
  console.log(`目标：    ${target}`)
  console.log(`移出到：  ${disabled}`)
  console.log('')
  if (existsSync(target) === false) {
    console.log('目标不存在：没有需要卸载的扩展目录。')
    return
  }
  console.log('动作：')
  console.log(`  ${mkdirCommand(disabledRoot)}`)
  console.log(`  ${moveCommand(target, disabled)}`)
  console.log('')
  console.log('恢复（把目录移回去，或重新安装）：')
  console.log(`  ${moveCommand(disabled, target)}`)
  console.log(`  或：node tools/install.mjs pack ${options.id} --yes`)
  console.log('')
  if (execute === false) {
    console.log('dry-run：未移动任何文件。确认无误后加 --yes 执行。')
    return
  }
  mkdirSync(disabledRoot, { recursive: true })
  moveDirectory(target, disabled)
  console.log(`已移出。${MAX_RAIL_NOTE}`)
  console.log(`回滚位置：${disabled}`)
}

const options = parseArgs(process.argv.slice(2))
if (options.help) {
  console.log(usage())
  process.exit(0)
}
if (options.mode === 'pack') install(options)
else uninstall(options)
