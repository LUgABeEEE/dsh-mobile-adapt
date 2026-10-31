/**
 * Regression tests for the two directed-fixture assertions added in PR #9.
 *
 * Each case copies docs/examples/fixture-pack into a temp directory, injects one
 * deliberate defect into its fixture.html, and runs `tools/check-pack.mjs <tmp>
 * --json`. The target assertion must be reported as failed and check-pack must
 * exit 1 — this is the "deliberately turns red" coverage the reviewer asked for.
 *
 * The checker needs Playwright + Chromium. Unit-test job environments install
 * neither, so the whole file skips when the checker reports a missing-browser
 * startup error. The dedicated CI step after "Install Playwright and Chromium"
 * sets CHECKPACK_REGRESSION_REQUIRE_BROWSER=1, which turns that skip into a hard
 * failure so the browser job can never go green by skipping these regressions.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test from 'node:test'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const EXAMPLE = join(REPO, 'docs', 'examples', 'fixture-pack')
const CHECKER = join(REPO, 'tools', 'check-pack.mjs')
const REQUIRE_BROWSER = process.env.CHECKPACK_REGRESSION_REQUIRE_BROWSER === '1'
const RUN_TIMEOUT_MS = 180_000

// Strings check-pack puts in its startup error when Playwright or its Chromium
// build is missing (see loadPlaywright / describeChromiumLaunchFailure).
const BROWSER_MISSING_PATTERNS = [
  /Playwright 未找到/,
  /playwright not found/i,
  /Chromium 无法启动/,
  /Executable doesn't exist/i,
  /browserType\.launch/i,
]

function runChecker(packPath) {
  const result = spawnSync(process.execPath, [CHECKER, packPath, '--json'], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
    env: process.env,
  })
  let payload = null
  try {
    payload = JSON.parse(result.stdout)
  } catch {
    // Not JSON: leave payload null and surface stdout/stderr in the assertion.
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, payload }
}

function missingBrowserReason() {
  const probe = runChecker(EXAMPLE)
  if (probe.status === 0) return null
  const detail = [probe.payload?.error, probe.stderr, probe.stdout].map(value => (typeof value === 'string' ? value : '')).join('\n')
  if (BROWSER_MISSING_PATTERNS.some(pattern => pattern.test(detail)) === false) return null
  const firstLine = detail.split('\n').map(line => line.trim()).find(line => line !== '') ?? 'unknown browser error'
  return `Playwright/Chromium 不可用，跳过 check-pack 定向 fixture 回归：${firstLine.slice(0, 160)}`
}

const skipReason = missingBrowserReason()
if (skipReason !== null && REQUIRE_BROWSER === true) {
  throw new Error(`CHECKPACK_REGRESSION_REQUIRE_BROWSER=1，但浏览器不可用：${skipReason}`)
}
const skip = skipReason ?? false

/** Copy the example pack, apply one fixture mutation, run fn(packDir), clean up. */
function withMutatedFixture(mutate, fn) {
  const root = mkdtempSync(join(tmpdir(), 'checkpack-regression-'))
  const packDir = join(root, 'fixture-pack')
  try {
    cpSync(EXAMPLE, packDir, { recursive: true })
    const fixturePath = join(packDir, 'fixture.html')
    const source = readFileSync(fixturePath, 'utf8')
    const mutated = mutate(source)
    assert.notEqual(mutated, source, 'fixture mutation did not change fixture.html')
    writeFileSync(fixturePath, mutated)
    return fn(packDir)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function failedAssertion(payload, assertionId) {
  assert.notEqual(payload, null, 'check-pack --json output was not JSON (is Playwright/Chromium available?)')
  assert.equal(payload.ok, false, 'check-pack --json should report ok=false')
  const pack = payload.packs.find(item => item.id === 'fixture-pack')
  assert.ok(pack, 'fixture-pack missing from the --json report')
  const assertion = pack.assertions.find(item => item.id === assertionId)
  assert.ok(assertion, `assertion ${assertionId} missing from the report`)
  assert.equal(assertion.status, 'failed', `expected ${assertionId} to be failed, got ${assertion.status}: ${assertion.message}`)
  return assertion
}

test('directed fixture: an overflowing panel fails runtime.mobile.panel.right', { skip, timeout: RUN_TIMEOUT_MS }, () => {
  withMutatedFixture(source => {
    assert.match(source, /<div class="demo-panel">/)
    return source.replace('<div class="demo-panel">', '<div class="demo-panel" style="min-width:600px">')
  }, packDir => {
    const result = runChecker(packDir)
    assert.equal(result.status, 1, `check-pack should exit 1 for a failing directed fixture\nstdout: ${result.stdout?.slice(0, 2000)}\nstderr: ${result.stderr?.slice(0, 2000)}`)
    const assertion = failedAssertion(result.payload, 'runtime.mobile.panel.right')
    assert.match(assertion.message, /600px/)
  })
})

test('directed fixture: a 12px text field fails runtime.mobile.inputFontSize', { skip, timeout: RUN_TIMEOUT_MS }, () => {
  withMutatedFixture(source => {
    assert.match(source, /font-size: 16px; line-height: 1\.25;/)
    return source.replace('font-size: 16px; line-height: 1.25;', 'font-size: 12px; line-height: 1.25;')
  }, packDir => {
    const result = runChecker(packDir)
    assert.equal(result.status, 1, `check-pack should exit 1 for a failing directed fixture\nstdout: ${result.stdout?.slice(0, 2000)}\nstderr: ${result.stderr?.slice(0, 2000)}`)
    const assertion = failedAssertion(result.payload, 'runtime.mobile.inputFontSize')
    assert.match(assertion.message, /12px/)
  })
})

test('directed fixture: a widened document fails runtime.mobile.overflow', { skip, timeout: RUN_TIMEOUT_MS }, () => {
  withMutatedFixture(source => {
    assert.match(source, /<body>/)
    return source.replace('<body>', '<body style="width:500px">')
  }, packDir => {
    const result = runChecker(packDir)
    assert.equal(result.status, 1, `check-pack should exit 1 for a failing directed fixture\nstdout: ${result.stdout?.slice(0, 2000)}\nstderr: ${result.stderr?.slice(0, 2000)}`)
    const assertion = failedAssertion(result.payload, 'runtime.mobile.overflow')
    assert.match(assertion.message, /scrollWidth/)
  })
})
