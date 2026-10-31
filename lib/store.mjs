/**
 * Pack store — the single implementation of "where packs live and how they move".
 *
 * Both the CLI (`tools/install.mjs`) and the DSH plugin (`lib/index.mjs`) import
 * this module, so the rules cannot drift: ids are validated once, a pack is
 * never copied over an existing directory, and an uninstall is always a move
 * that can be undone by putting the directory back.
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
import { basename, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 包 id 的唯一合法形态；catalog、目录名、扩展目录名都用它。 */
export const ID_RE = /^[a-z][a-z0-9-]{0,63}$/

/** 宿主每 2s 轮询一次扩展目录：复制/移走后不需要重启 dsh-mobile。 */
export const HOT_RELOAD_NOTE = '扩展目录每 2s 轮询一次：复制或移走后无需重启 dsh-mobile。'

export class PackError extends Error {
  /**
   * @param {string} message 给人看的说明（CLI 直接打印这一句）
   * @param {{ code?: string, hint?: string }} [details]
   */
  constructor(message, { code = 'pack-error', hint = '' } = {}) {
    super(message)
    this.name = 'PackError'
    this.code = code
    this.hint = hint
  }
}

/** 包根：lib/store.mjs → 包根；源码树与 node_modules 安装都能定位。 */
export const PACKAGE_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')

/** 展开 `~` / `~/…`，让 POSIX 与 Windows 的 DSH_HOME 写法都可用。 */
export function expandHome(value) {
  const trimmed = String(value).trim()
  if (trimmed === '~') return homedir()
  return /^~[\\/]/.test(trimmed) ? join(homedir(), trimmed.slice(2)) : trimmed
}

/** `$DSH_HOME`（空串按未设置处理）缺省 `~/.dsh`。与 CLI 同口径。 */
export function resolveDshHome(env = process.env) {
  const configured = env && typeof env.DSH_HOME === 'string' ? env.DSH_HOME : ''
  const value = configured.trim() === '' ? join(homedir(), '.dsh') : expandHome(configured)
  return resolve(value)
}

/** 目标路径；只接受已经通过 ID_RE 的 id。 */
export function packPaths(home, id) {
  if (typeof id !== 'string' || ID_RE.test(id) === false) {
    throw new PackError(`包 id 不合法：${id}（需匹配 ${ID_RE}）`, { code: 'invalid-id' })
  }
  const extensionsRoot = join(home, 'mobile-access', 'extensions')
  const disabledRoot = join(home, 'mobile-access-adapt-disabled')
  return {
    extensionsRoot,
    disabledRoot,
    target: join(extensionsRoot, id),
    disabledBase: join(disabledRoot, id),
  }
}

export function readCatalog(root = PACKAGE_ROOT) {
  try {
    return JSON.parse(readFileSync(join(root, 'catalog.json'), 'utf8'))
  } catch (error) {
    throw new PackError(`读不到合法的 catalog.json：${error instanceof Error ? error.message : String(error)}`, { code: 'catalog' })
  }
}

export function readCompat(root = PACKAGE_ROOT) {
  try {
    return JSON.parse(readFileSync(join(root, 'compat.json'), 'utf8'))
  } catch (error) {
    throw new PackError(`读不到合法的 compat.json：${error instanceof Error ? error.message : String(error)}`, { code: 'compat' })
  }
}

export function findCatalogEntry(root, id) {
  const catalog = readCatalog(root)
  const entry = Array.isArray(catalog.packs) ? catalog.packs.find(item => item !== null && item.id === id) : undefined
  if (entry === undefined) {
    throw new PackError(`catalog.json 里没有 ${id} 的条目：未收录的包不能安装（见 docs/收录标准.md）`, { code: 'not-in-catalog' })
  }
  return entry
}

/** 校验 extension.json 的字段契约（恰好五个字段、schemaVersion 1、id == 目录名）。 */
export function readManifest(packDir) {
  const manifestFile = join(packDir, 'extension.json')
  let value
  try {
    value = JSON.parse(readFileSync(manifestFile, 'utf8'))
  } catch (error) {
    throw new PackError(`读不到合法的 ${manifestFile}：${error instanceof Error ? error.message : String(error)}`, { code: 'manifest' })
  }
  const keys = Object.keys(value).sort().join(',')
  if (keys !== 'description,id,name,schemaVersion,version') {
    throw new PackError(`${manifestFile} 字段集合不是恰好 5 个（实际 ${keys}）`, { code: 'manifest' })
  }
  if (value.schemaVersion !== 1) throw new PackError(`${manifestFile} 的 schemaVersion 必须为 1`, { code: 'manifest' })
  if (value.id !== basename(packDir)) {
    throw new PackError(`${manifestFile} 的 id（${value.id}）必须等于目录名（${basename(packDir)}）`, { code: 'manifest' })
  }
  return value
}

/** 递归列出包内文件（相对 POSIX 路径），按路径排序；带大小与 sha256。 */
export function listFiles(root) {
  const files = []
  const walk = current => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const absolute = join(current, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else if (entry.isFile()) {
        files.push({
          relative: relative(root, absolute).split('\\').join('/'),
          bytes: statSync(absolute).size,
          digest: createHash('sha256').update(readFileSync(absolute)).digest('hex'),
        })
      }
    }
  }
  walk(root)
  return files
}

/**
 * rename 跨卷会失败（Windows ERROR_NOT_SAME_DEVICE）：退化为复制 + 删除，只有源目录
 * 完整复制成功才删。Windows 上的 EPERM/EACCES/EBUSY 通常意味着目录被占用，给出可操作提示。
 */
export function moveDirectory(from, to) {
  try {
    renameSync(from, to)
  } catch (error) {
    const code = error !== null && typeof error === 'object' ? error.code : undefined
    if (code === 'EXDEV') {
      cpSync(from, to, { recursive: true })
      rmSync(from, { recursive: true, force: true })
      return
    }
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY')) {
      throw new PackError(`移动失败（${code}）：目标可能正被占用。`, {
        code: 'locked',
        hint: `关闭占用 ${from} 的程序（宿主轮询、杀软扫描、编辑器）后重试。原始错误：${error instanceof Error ? error.message : String(error)}`,
      })
    }
    throw error
  }
}

/**
 * 安装计划（不写盘）。执行安装只是照着计划复制。
 * @returns {{ manifest: object, entry: object, packDir: string, target: string, files: Array, exists: boolean }}
 */
export function planInstall({ root = PACKAGE_ROOT, home = resolveDshHome(), id }) {
  const paths = packPaths(home, id)
  const packDir = join(root, 'packs', id)
  if (existsSync(packDir) === false || statSync(packDir).isDirectory() === false) {
    throw new PackError(`仓库里没有 packs/${id}`, { code: 'missing-pack' })
  }
  const manifest = readManifest(packDir)
  const entry = findCatalogEntry(root, id)
  return {
    manifest,
    entry,
    packDir,
    target: paths.target,
    extensionsRoot: paths.extensionsRoot,
    files: listFiles(packDir),
    exists: existsSync(paths.target),
  }
}

/** 真正复制到扩展目录；目标已存在时拒绝覆盖（先 uninstall）。 */
export function installPack({ root = PACKAGE_ROOT, home = resolveDshHome(), id }) {
  const plan = planInstall({ root, home, id })
  if (plan.exists) {
    throw new PackError(`目标已存在，拒绝覆盖：${plan.target}`, {
      code: 'exists',
      hint: `先回滚：node tools/install.mjs --uninstall ${id} --yes`,
    })
  }
  mkdirSync(plan.extensionsRoot, { recursive: true })
  cpSync(plan.packDir, plan.target, { recursive: true })
  return { ...plan, written: plan.files.length }
}

/** 卸载：把目录移到 mobile-access-adapt-disabled/，可原样移回。 */
export function uninstallPack({ home = resolveDshHome(), id }) {
  const paths = packPaths(home, id)
  if (existsSync(paths.target) === false) {
    throw new PackError(`目标不存在：没有需要卸载的扩展目录（${paths.target}）`, { code: 'not-installed' })
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const disabled = existsSync(paths.disabledBase) ? `${paths.disabledBase}-${stamp}` : paths.disabledBase
  mkdirSync(paths.disabledRoot, { recursive: true })
  moveDirectory(paths.target, disabled)
  return { target: paths.target, disabled, disabledRoot: paths.disabledRoot }
}

/** 扫描扩展目录：已装 / 已停用，返回 id → manifest（读不到 manifest 的目录跳过）。 */
export function scanInstalled(home = resolveDshHome()) {
  const paths = packPaths(home, 'x') // 只借路径推导，id 不参与扫描
  const scan = root => {
    const found = new Map()
    if (existsSync(root) === false) return found
    for (const name of readdirSync(root)) {
      const manifestFile = join(root, name, 'extension.json')
      if (existsSync(manifestFile) === false) continue
      try {
        found.set(name, JSON.parse(readFileSync(manifestFile, 'utf8')))
      } catch {
        found.set(name, { id: name, version: '?' })
      }
    }
    return found
  }
  return { extensionsRoot: paths.extensionsRoot, disabledRoot: paths.disabledRoot, installed: scan(paths.extensionsRoot), disabled: scan(paths.disabledRoot) }
}
