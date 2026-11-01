import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import vm from 'node:vm'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

test('package.json declares a complete dsh bundle', () => {
  assert.equal(pkg.dsh.manifestVersion, 1)
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  // A settings-only client must be injected at boot; without this the module is
  // deferred and the browser reports the entry as failed.
  assert.equal(pkg.dsh.client.immediately, true)
  // Declare the client service we actually use; without it the module can be
  // applied before the slots service exists.
  assert.deepEqual(pkg.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-slots'])
  assert.match(pkg.engines.dsh, /0\.2\.1-rc\.2/)
  assert.equal(existsSync(join(ROOT, pkg.dsh.bundle.patch)), true)
  assert.equal(pkg.main, 'lib/index.mjs')
  assert.equal(pkg.exports['./client'], './lib/client.js')
  assert.ok(pkg.files.includes('lib/'))
  assert.ok(pkg.files.includes('cordis.patch.yml'))
})

test('the bundle patch mounts this package by name', () => {
  const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /- insert:/)
  assert.match(patch, new RegExp(`name:\\s*'${pkg.name}'`))
  assert.match(patch, /id:\s*adapt-packs/)
})

test('the client bundle registers itself under the package name and fills settings.section', () => {
  let captured = null
  const documentStub = {
    createElement: () => ({ setAttribute() {}, remove() {}, textContent: '' }),
    head: { appendChild() {} },
  }
  const sandbox = {
    window: { __ModuleLoader__: { load: definition => { captured = definition } } },
    document: documentStub,
  }
  vm.createContext(sandbox)
  vm.runInContext(readFileSync(join(ROOT, 'lib/client.js'), 'utf8'), sandbox, { filename: 'client.js' })

  assert.ok(captured, 'the bundle called __ModuleLoader__.load')
  assert.equal(captured.id, pkg.name)
  assert.equal(typeof captured.factory, 'function')

  const ReactStub = {
    createElement: () => null,
    useState: value => [value, () => {}],
    useEffect: () => {},
    useCallback: fn => fn,
  }
  const client = captured.factory(() => ReactStub)
  assert.equal(typeof client.apply, 'function')

  const registered = []
  const slots = {
    inject: (_name, run) => run(),
    register: (spec, component) => {
      registered.push({ spec, component })
      return () => {}
    },
  }
  client.apply({ get: () => slots, slots, effect: () => {} })
  assert.equal(registered.length, 1)
  assert.equal(registered[0].spec.name, 'settings.section')
  assert.equal(registered[0].spec.id, 'adapt-packs')
  assert.equal(typeof registered[0].component, 'function')
})

test('apply registers the prefix route on a webServer and the route answers', async () => {
  const plugin = (await import('../lib/index.mjs')).default
  let registered = null
  const webServer = {
    register(options) {
      registered = options
      return () => {}
    },
  }
  plugin.apply({ webServer, effect: () => {} })
  assert.equal(registered.kind, 'prefix')
  assert.equal(registered.path, '/api/adapt-packs')

  const chunks = []
  const req = { method: 'GET', url: '/api/adapt-packs/state', on(event, fn) { if (event === 'end') fn(); return req }, destroy() {} }
  const res = {
    status: 0,
    payload: '',
    writeHead(status) { this.status = status },
    end(payload) { this.payload = payload ?? '' },
  }
  await registered.handler(req, res)
  const body = JSON.parse(res.payload)
  assert.equal(res.status, 200)
  assert.equal(body.ok, true)
  assert.ok(Array.isArray(body.packs))
})

test('a context without settings.section degrades instead of failing the bundle', () => {
  let captured = null
  const sandbox = {
    window: { __ModuleLoader__: { load: definition => { captured = definition } } },
    document: { createElement: () => ({ setAttribute() {}, remove() {}, textContent: '' }), head: { appendChild() {} } },
    console: { warn() {} },
  }
  vm.createContext(sandbox)
  vm.runInContext(readFileSync(join(ROOT, 'lib/client.js'), 'utf8'), sandbox, { filename: 'client.js' })
  const ReactStub = { createElement: () => null, useState: value => [value, () => {}], useEffect: () => {}, useCallback: fn => fn }
  const client = captured.factory(() => ReactStub)
  const slots = { inject() { throw new Error('no such slot') }, register: () => () => {} }
  assert.doesNotThrow(() => client.apply({ get: () => slots, slots, effect: () => {} }))
  assert.doesNotThrow(() => client.apply({}))
})

test('the host half exports a plugin whose apply tolerates a webServer-less context', async () => {
  const plugin = (await import('../lib/index.mjs')).default
  assert.equal(plugin.name, 'adapt-packs')
  assert.ok(plugin.inject.includes('webServer'))
  // No webServer in the context: apply must return quietly instead of throwing.
  plugin.apply({})
  plugin.apply({ webServer: undefined, effect: () => {} })
})
