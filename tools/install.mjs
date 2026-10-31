#!/usr/bin/env node
/**
 * dsh-adapt-packs · 安装 / 卸载（回滚）
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
 * 文件操作由 ../lib/store.mjs 实现，与 DSH 设置里的「插件适配」面板共用同一套规则。
 *
 * 用法：
 *   node tools/install.mjs pack <id> [--dry-run] [--yes]
 *   node tools/install.mjs --uninstall <id> [--dry-run] [--yes]
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  HOT_RELOAD_NOTE,
  ID_RE,
  PackError,
  installPack,
  planInstall,
  resolveDshHome,
  uninstallPack,
} from '../lib/store.mjs'

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

function fail(message, hint = '') {
  console.error(`错误：${message}`)
  if (hint !== '') console.error(hint)
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

function humanBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function printInstallPlan({ plan, home, execute }) {
  const title = execute ? '安装（写入）' : '安装（dry-run）'
  console.log(`dsh-adapt-packs · ${title}`)
  console.log('')
  console.log(`包：      ${plan.manifest.id} ${plan.manifest.version}（catalog: ${plan.entry.status} / risk ${plan.entry.risk} / default ${plan.entry.default}）`)
  console.log(`来源：    ${plan.packDir}`)
  console.log(`DSH_HOME：${home}`)
  console.log(`目标：    ${plan.target}`)
  console.log(`目标状态：${plan.exists ? '已存在（--yes 会拒绝覆盖）' : '不存在'}`)
  console.log('')
  console.log(`文件（${plan.files.length}）：`)
  for (const file of plan.files) {
    console.log(`  ${file.relative.padEnd(20)} ${humanBytes(file.bytes).padStart(9)}  sha256:${file.digest.slice(0, 12)}`)
  }
  console.log('')
  console.log('动作：')
  console.log(`  ${mkdirCommand(dirname(plan.target))}`)
  console.log(`  ${copyCommand(plan.packDir, plan.target)}`)
  console.log('')
  console.log('回滚（移走目录，可恢复）：')
  console.log(`  node tools/install.mjs --uninstall ${plan.manifest.id} --yes`)
  console.log(`  或手工：${moveCommand(plan.target, join(home, 'mobile-access-adapt-disabled', plan.manifest.id))}`)
  console.log(`  或手工删除：${removeCommand(plan.target)}`)
  console.log('')
  if (execute === false) {
    console.log('dry-run：未写入任何文件。确认无误后加 --yes 执行。')
  } else {
    console.log(`已安装。${HOT_RELOAD_NOTE}`)
  }
}

function install(options) {
  const home = resolveDshHome()
  const execute = options.yes === true
  let plan
  try {
    plan = planInstall({ home, id: options.id })
  } catch (error) {
    if (error instanceof PackError) fail(error.message, error.hint)
    throw error
  }
  if (execute === true && plan.exists === true) {
    fail(`目标已存在，拒绝覆盖：${plan.target}\n先回滚：node tools/install.mjs --uninstall ${options.id} --yes`)
  }
  printInstallPlan({ plan, home, execute })
  if (execute === false) return
  const result = installPack({ home, id: options.id })
  console.log('')
  console.log(`已写入 ${result.written} 个文件到 ${result.target}`)
}

function uninstall(options) {
  const home = resolveDshHome()
  const target = join(home, 'mobile-access', 'extensions', options.id)
  const disabledRoot = join(home, 'mobile-access-adapt-disabled')
  const disabledBase = join(disabledRoot, options.id)
  const execute = options.yes === true
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const disabled = existsSync(disabledBase) ? `${disabledBase}-${stamp}` : disabledBase

  console.log(`dsh-adapt-packs · 卸载（${execute ? '写入' : 'dry-run'}）`)
  console.log('')
  console.log(`DSH_HOME：${home}`)
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
  const result = uninstallPack({ home, id: options.id })
  console.log(`已移出。${HOT_RELOAD_NOTE}`)
  console.log(`回滚位置：${result.disabled}`)
}

const options = parseArgs(process.argv.slice(2))
if (options.help) {
  console.log(usage())
  process.exit(0)
}
if (options.mode === 'pack') install(options)
else uninstall(options)
