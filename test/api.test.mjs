import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { API_PREFIX, createHandler } from '../lib/index.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

function request(handler, { method = 'GET', url, body }) {
  const chunks = []
  const req = {
    method,
    url,
    on(event, listener) {
      if (event === 'data' && body !== undefined) listener(Buffer.from(JSON.stringify(body)))
      if (event === 'end') listener()
      return req
    },
    destroy() {},
  }
  const res = {
    status: 0,
    headers: {},
    payload: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers ?? {}
    },
    end(payload) {
      this.payload = payload ?? ''
    },
  }
  return handler(req, res).then(() => ({
    status: res.status,
    headers: res.headers,
    json: res.payload === '' ? null : JSON.parse(res.payload),
  }))
}

test('GET state reports the catalog, the compat list and the current home', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-adapt-api-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const handler = createHandler({ root: ROOT })
    const result = await request(handler, { url: `${API_PREFIX}/state` })
    assert.equal(result.status, 200)
    assert.equal(result.json.dshHome, home)
    assert.ok(Array.isArray(result.json.packs))
    assert.ok(result.json.packs.length >= 4)
    assert.ok(result.json.packs.every(pack => typeof pack.installed === 'boolean'))
    assert.ok(Array.isArray(result.json.compat))
    assert.equal(result.headers['cache-control'], 'no-store')
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
})

test('install, refuse-to-overwrite and uninstall round-trip through the API', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-adapt-api-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const handler = createHandler({ root: ROOT })

    const installed = await request(handler, { method: 'POST', url: `${API_PREFIX}/install`, body: { id: 'shell-chrome' } })
    assert.equal(installed.status, 200)
    assert.equal(installed.json.ok, true)
    assert.ok(installed.json.written >= 3)
    assert.equal(installed.json.packs.find(pack => pack.id === 'shell-chrome').installed, true)

    const again = await request(handler, { method: 'POST', url: `${API_PREFIX}/install`, body: { id: 'shell-chrome' } })
    assert.equal(again.status, 400)
    assert.equal(again.json.code, 'exists')

    const unknown = await request(handler, { method: 'POST', url: `${API_PREFIX}/install`, body: { id: 'no-such-pack' } })
    assert.equal(unknown.status, 400)

    const removed = await request(handler, { method: 'POST', url: `${API_PREFIX}/uninstall`, body: { id: 'shell-chrome' } })
    assert.equal(removed.status, 200)
    assert.equal(removed.json.packs.find(pack => pack.id === 'shell-chrome').installed, false)
    assert.equal(removed.json.packs.find(pack => pack.id === 'shell-chrome').disabled, true)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
})

test('the handler stays inside its prefix and its verbs', async () => {
  const handler = createHandler({ root: ROOT })
  assert.equal((await request(handler, { url: '/api/something-else' })).status, 404)
  assert.equal((await request(handler, { url: `${API_PREFIX}/install` })).status, 405)
  assert.equal((await request(handler, { method: 'POST', url: `${API_PREFIX}/install`, body: {} })).status, 400)
})
