import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  ID_RE,
  PackError,
  PACKAGE_ROOT,
  installPack,
  packPaths,
  planInstall,
  readManifest,
  resolveDshHome,
  scanInstalled,
  uninstallPack,
} from '../lib/store.mjs'

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'dsh-adapt-store-'))
}

test('resolveDshHome matches the CLI defaults', () => {
  const explicit = resolveDshHome({ DSH_HOME: '/tmp/some-home' })
  assert.equal(explicit, '/tmp/some-home')
  // An empty value is "unset", not the current directory.
  const empty = resolveDshHome({ DSH_HOME: '' })
  assert.ok(empty.endsWith(join('.dsh')))
  const spaced = resolveDshHome({ DSH_HOME: '  /tmp/another  ' })
  assert.equal(spaced, '/tmp/another')
})

test('packPaths refuses ids that are not plain slug names', () => {
  for (const id of ['', 'Core', '../escape', 'a/b', 'a b', '-nope']) {
    assert.throws(() => packPaths('/tmp/h', id), PackError)
  }
  assert.equal(ID_RE.test('dshmarket-mobile'), true)
})

test('planInstall reads the catalog, the manifest and the file list without writing', () => {
  const home = tempHome()
  try {
    const plan = planInstall({ home, id: 'core-panel' })
    assert.equal(plan.manifest.id, 'core-panel')
    assert.equal(plan.exists, false)
    assert.ok(plan.files.length >= 3, 'a pack ships at least extension.json + css + js')
    assert.ok(plan.files.some(file => file.relative === 'extension.json'))
    assert.ok(plan.target.endsWith(join('mobile-access', 'extensions', 'core-panel')))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('install then uninstall moves the pack and can be scanned back', () => {
  const home = tempHome()
  try {
    const installed = installPack({ home, id: 'floaters' })
    assert.equal(installed.written, installed.files.length)
    assert.equal(readManifest(installed.target).id, 'floaters')
    assert.equal(planInstall({ home, id: 'floaters' }).exists, true)

    // Refusing to overwrite is the whole point of the dry-run default.
    assert.throws(() => installPack({ home, id: 'floaters' }), error => error instanceof PackError && error.code === 'exists')

    const scan = scanInstalled(home)
    assert.equal(scan.installed.has('floaters'), true)

    const removed = uninstallPack({ home, id: 'floaters' })
    assert.equal(removed.disabled.startsWith(join(home, 'mobile-access-adapt-disabled')), true)
    assert.equal(scanInstalled(home).installed.has('floaters'), false)
    assert.equal(scanInstalled(home).disabled.has('floaters'), true)

    // A second uninstall has nothing to move.
    assert.throws(() => uninstallPack({ home, id: 'floaters' }), error => error instanceof PackError && error.code === 'not-installed')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('an unknown pack id is rejected before anything touches the disk', () => {
  const home = tempHome()
  try {
    assert.throws(
      () => planInstall({ home, id: 'not-a-real-pack' }),
      error => error instanceof PackError && error.code === 'missing-pack',
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('readManifest enforces the five-field contract', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-adapt-manifest-'))
  try {
    const good = { schemaVersion: 1, id: 'demo', name: 'Demo', version: '0.1.0', description: 'x' }
    writeFileSync(join(dir, 'extension.json'), JSON.stringify(good))
    const manifestFile = join(dir, 'extension.json')
    // basename(dir) is not "demo", so the id-vs-directory-name rule fires first.
    assert.throws(() => readManifest(dir), error => error instanceof PackError && /必须等于目录名/.test(error.message))
    assert.equal(JSON.parse(readFileSync(manifestFile, 'utf8')).id, 'demo')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the package root resolves to the repository, so catalog and packs agree', () => {
  assert.equal(readFileSync(join(PACKAGE_ROOT, 'catalog.json'), 'utf8').includes('core-panel'), true)
  mkdirSync(join(PACKAGE_ROOT, 'packs'), { recursive: true })
})
