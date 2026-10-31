/**
 * dsh-adapt-packs — DSH plugin (host half).
 *
 * The settings panel asks this route for the catalog, the compatibility list and
 * what is currently installed, and uses it to install / uninstall a pack. The
 * actual file moves live in ./store.mjs, shared with the CLI, so the panel and
 * `dsh-adapt-packs install` cannot disagree.
 *
 * Route: /api/adapt-packs/{state,install,uninstall}
 *   GET  state                     → { dshHome, catalog, compat, installed, disabled, stray }
 *   POST install   { "id": "…" }   → { ok, id, target, written }
 *   POST uninstall { "id": "…" }   → { ok, id, disabled }
 */
import { fileURLToPath } from 'node:url'
import {
  PackError,
  installPack,
  planInstall,
  readCatalog,
  readCompat,
  resolveDshHome,
  scanInstalled,
  uninstallPack,
} from './store.mjs'

export const API_PREFIX = '/api/adapt-packs'
const MAX_BODY = 8 * 1024

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    let size = 0
    const chunks = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new PackError(`请求体超过 ${MAX_BODY} 字节`, { code: 'body-too-large' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') return resolvePromise({})
      try {
        resolvePromise(JSON.parse(text))
      } catch {
        reject(new PackError('请求体不是合法 JSON', { code: 'bad-json' }))
      }
    })
    req.on('error', reject)
  })
}

/** 概要状态：catalog + compat + 本机已装/停用/未收录。 */
export function collectState({ root, home = resolveDshHome() }) {
  const catalog = readCatalog(root)
  const compat = readCompat(root)
  const { installed, disabled, extensionsRoot, disabledRoot } = scanInstalled(home)
  const packs = (Array.isArray(catalog.packs) ? catalog.packs : []).map(entry => {
    const manifest = installed.get(entry.id) ?? disabled.get(entry.id) ?? null
    const packVersion = (() => {
      try {
        return planInstall({ root, home, id: entry.id }).manifest.version
      } catch {
        return null
      }
    })()
    return {
      id: entry.id,
      name: entry.name ?? entry.id,
      version: packVersion,
      status: entry.status ?? 'experimental',
      risk: entry.risk ?? 'safe',
      byDefault: entry.default ?? 'off',
      target: entry.target?.package === undefined ? null : `${entry.target.package}@${entry.target.version ?? '*'}`,
      capabilities: Array.isArray(entry.capabilities) ? entry.capabilities : [],
      installed: installed.has(entry.id),
      disabled: disabled.has(entry.id),
      installedVersion: manifest?.version ?? null,
    }
  })
  const stray = [...installed.keys()].filter(id => packs.every(pack => pack.id !== id))
  return {
    dshHome: home,
    extensionsRoot,
    disabledRoot,
    packs,
    compat: Array.isArray(compat.entries) ? compat.entries : [],
    compatUpdated: compat.updated ?? null,
    stray,
  }
}

/**
 * Build the request handler. Exported for tests: a fake `req`/`res` pair is
 * enough, no DSH context needed.
 */
export function createHandler({ root }) {
  return async (req, res) => {
    const method = (req.method ?? 'GET').toUpperCase()
    let pathname
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    } catch {
      sendJson(res, 400, { ok: false, error: '非法 URL' })
      return
    }
    if (pathname !== API_PREFIX && pathname.startsWith(`${API_PREFIX}/`) === false) {
      sendJson(res, 404, { ok: false, error: 'not_found' })
      return
    }
    const command = pathname.slice(API_PREFIX.length).replace(/^\/+/, '') || 'state'
    const home = resolveDshHome()

    try {
      if (command === 'state' && method === 'GET') {
        sendJson(res, 200, { ok: true, ...collectState({ root, home }) })
        return
      }
      if (command === 'install' && method === 'POST') {
        const body = await readBody(req)
        const id = typeof body.id === 'string' ? body.id.trim() : ''
        if (id === '') {
          sendJson(res, 400, { ok: false, error: '缺少 id' })
          return
        }
        const result = installPack({ root, home, id })
        sendJson(res, 200, { ok: true, id, target: result.target, written: result.written, ...collectState({ root, home }) })
        return
      }
      if (command === 'uninstall' && method === 'POST') {
        const body = await readBody(req)
        const id = typeof body.id === 'string' ? body.id.trim() : ''
        if (id === '') {
          sendJson(res, 400, { ok: false, error: '缺少 id' })
          return
        }
        const result = uninstallPack({ home, id })
        sendJson(res, 200, { ok: true, id, disabled: result.disabled, ...collectState({ root, home }) })
        return
      }
      sendJson(res, 405, { ok: false, error: `不支持 ${method} ${pathname}` })
    } catch (error) {
      if (error instanceof PackError) {
        sendJson(res, 400, { ok: false, code: error.code, error: error.message, hint: error.hint || undefined })
        return
      }
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
}

export default {
  name: 'adapt-packs',
  inject: ['webServer'],
  apply(ctx) {
    const ws = ctx?.webServer
    if (ws === undefined || ws === null || typeof ws.register !== 'function') return
    const handler = createHandler({ root: fileURLToPath(new URL('..', import.meta.url)) })
    const off = ws.register({ kind: 'prefix', path: API_PREFIX, handler })
    if (typeof ctx.effect === 'function') ctx.effect(() => off, 'dsh-adapt-packs: API route')
  },
}
