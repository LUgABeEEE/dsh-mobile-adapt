#!/usr/bin/env node
/**
 * Pack the package the way npm would publish it, install that tarball into a
 * throwaway prefix, and prove it is a usable DSH bundle from the *published*
 * files only.
 *
 * This exists because the failure that broke a real host (`dsh-adapt-packs:
 * failed`, whole page refusing to boot) was a *manifest* mistake — it was
 * invisible to the unit tests that ran against the source tree, because the
 * source tree had the field and the shipped manifest did not. The check runs in
 * CI and in `prepublishOnly`.
 *
 * No dependencies; works on Linux, macOS and Windows (npm is spawned directly).
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REQUIRED_FILES = [
  'package.json',
  'cordis.patch.yml',
  'lib/index.mjs',
  'lib/client.js',
  'lib/store.mjs',
  'catalog.json',
  'compat.json',
  'README.md',
  'LICENSE',
]
const PACK_IDS = ['core-panel', 'shell-chrome', 'floaters', 'dshmarket-mobile']

const failures = []
const notes = []
function fail(message) {
  failures.push(message)
}
function note(message) {
  notes.push(message)
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    ...options,
  })
}

const work = mkdtempSync(join(tmpdir(), 'dsh-adapt-bundle-'))
try {
  // 1. Pack exactly what npm would publish.
  run('npm', ['pack', '--pack-destination', work, '--silent'])
  const packed = readdirSync(work).filter(name => name.endsWith('.tgz'))
  if (packed.length !== 1) throw new Error(`expected one tarball, got ${packed.join(', ') || 'none'}`)
  note(`tarball ${packed[0]}`)

  // 2. Install it into a throwaway prefix: this is what a host does.
  const tarball = join(work, packed[0])
  const prefix = join(work, 'app')
  run('npm', ['install', '--prefix', prefix, '--no-audit', '--no-fund', '--ignore-scripts', tarball])
  const installed = join(prefix, 'node_modules', 'dsh-adapt-packs')
  if (!existsSync(installed)) throw new Error('npm did not install dsh-adapt-packs into the prefix')

  // 3. The files a bundle needs at runtime.
  for (const file of REQUIRED_FILES) {
    if (!existsSync(join(installed, file))) fail(`published tarball is missing ${file}`)
  }
  for (const id of PACK_IDS) {
    if (!existsSync(join(installed, 'packs', id, 'extension.json'))) fail(`published tarball is missing packs/${id}/extension.json`)
  }

  // 4. The manifest contract that a host reads before it loads anything.
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
  if (manifest.dsh?.manifestVersion !== 1) fail('published manifest lacks dsh.manifestVersion 1')
  if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') fail('published manifest lacks dsh.bundle.patch')
  if (manifest.dsh?.client?.platform !== 'web') fail('published manifest lacks dsh.client.platform web')
  if (manifest.dsh?.client?.immediately !== true) {
    fail('published manifest lacks dsh.client.immediately: true — the browser entry never activates and the whole page refuses to boot')
  }
  if (!Array.isArray(manifest.dsh?.client?.inject) || manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-slots') === false) {
    fail('published manifest must declare the slots client service it uses')
  }
  if (typeof manifest.engines?.dsh !== 'string' || manifest.engines.dsh.length === 0) {
    fail('published manifest should declare engines.dsh')
  }

  // 5. The bundle patch mounts this package by name.
  const patch = readFileSync(join(installed, 'cordis.patch.yml'), 'utf8')
  if (!/- insert:/.test(patch)) fail('cordis.patch.yml has no - insert: row')
  if (!patch.includes(`name: '${manifest.name}'`) && !patch.includes(`name: "${manifest.name}"`)) {
    fail(`cordis.patch.yml does not mount ${manifest.name}`)
  }

  // 6. The host half loads from the installed copy and exposes the API.
  const host = await import(pathToFileURL(join(installed, 'lib/index.mjs')).href)
  const plugin = host.default
  if (plugin?.name !== 'adapt-packs') fail('host plugin does not export name adapt-packs')
  if (!Array.isArray(plugin?.inject) || plugin.inject.includes('webServer') === false) fail('host plugin does not inject webServer')
  if (typeof plugin?.apply !== 'function') fail('host plugin does not export apply()')
  if (host.API_PREFIX !== '/api/adapt-packs') fail(`unexpected API prefix ${host.API_PREFIX}`)
  if (typeof host.createHandler !== 'function') fail('host module does not export createHandler')

  // 7. The CLI in the tarball still answers.
  const cli = join(installed, 'tools', 'cli.mjs')
  const listed = run(process.execPath, [cli, 'list'])
  if (!/4 pack\(s\)|pack\(s\)/.test(listed)) fail(`cli list output looks wrong: ${listed.slice(0, 120)}`)
  const compat = JSON.parse(run(process.execPath, [cli, 'compat', '--json']))
  if (!Array.isArray(compat.entries) || compat.entries.length === 0) fail('cli compat --json returned no entries')

  note(`${REQUIRED_FILES.length} required files, ${PACK_IDS.length} packs, cli + host ok`)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
} finally {
  rmSync(work, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error('check-bundle: FAIL')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`check-bundle: ok（${notes.join('；')}）`)
