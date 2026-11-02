/**
 * Real-device verification overlay (temporary, diagnostic only).
 *
 * Installed into <DSH_HOME>/mobile-access/mobile.js only while a device run is
 * active; tools/device-verify/run.mjs backs up and restores the previous file.
 * It renders one fixed panel with the numbers a screenshot can carry back:
 * viewport, safe-area, panel state, touch-target sizes, tap hit-testing and the
 * floating-widget clearance. No data leaves the page.
 */
(function () {
  'use strict'
  if (document.getElementById('dsh-verify-overlay') !== null) return

  const PANEL_ID = 'dsh-verify-overlay'
  const SAFE_KEYS = ['top', 'right', 'bottom', 'left']

  function safeArea() {
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);'
    document.body.append(probe)
    const style = getComputedStyle(probe)
    const values = SAFE_KEYS.map(key => Math.round(parseFloat(style[`padding${key[0].toUpperCase()}${key.slice(1)}`]) || 0))
    probe.remove()
    return values
  }

  function touchMetrics(root) {
    const selector = ':is(button, [role="button"], input, select, textarea)'
    const nodes = [...root.querySelectorAll(selector)]
    const sizes = []
    let checked = 0
    let miss = 0
    const samples = []
    const width = window.innerWidth
    const height = window.innerHeight
    for (const node of nodes) {
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      const box = node.getBoundingClientRect()
      if (box.width === 0 && box.height === 0) continue
      sizes.push(Math.round(Math.min(box.width, box.height) * 10) / 10)
      checked += 1
      const centreX = box.left + box.width / 2
      const centreY = box.top + box.height / 2
      let hit = 0
      let probed = 0
      for (const [dx, dy] of [[0, 0], [20, 0], [-20, 0], [0, 20], [0, -20]]) {
        const x = centreX + dx
        const y = centreY + dy
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        probed += 1
        const element = document.elementFromPoint(x, y)
        if (element !== null && (element === node || node.contains(element))) hit += 1
      }
      if (probed < 3 || hit === probed) continue
      miss += 1
      if (samples.length < 4) samples.push(`${node.tagName.toLowerCase()} ${Math.round(box.width)}x${Math.round(box.height)} ${hit}/${probed}`)
    }
    if (sizes.length === 0) return { count: 0, min: null, under44: null, checked, miss, samples }
    return {
      count: sizes.length,
      min: Math.min(...sizes),
      under44: sizes.filter(size => size < 43.5).length,
      checked,
      miss,
      samples,
    }
  }

  function chromeMetrics() {
    const nav = [...document.querySelectorAll('.dshm-panelNav :is(button, [role="button"])')].map(node => Math.round(node.getBoundingClientRect().height))
    const drawer = document.querySelector('[data-open="true"] [data-slot="sidebar"]')
    const rows = drawer === null ? [] : [...drawer.querySelectorAll('button, [role="button"]')].map(node => Math.round(node.getBoundingClientRect().height))
    return { nav, rows }
  }

  function collect() {
    const main = document.querySelector('[data-slot="main"]')
    const market = document.querySelector('[data-dsh-market-root]')
    const root = main ?? document.body
    return {
      at: new Date().toISOString(),
      inner: `${window.innerWidth}x${window.innerHeight}`,
      visual: window.visualViewport === null ? 'n/a' : `${Math.round(window.visualViewport.width)}x${Math.round(window.visualViewport.height)}`,
      dpr: window.devicePixelRatio,
      screen: `${window.screen.width}x${window.screen.height}`,
      safe: safeArea().join(','),
      shell: document.querySelector('.dshm-shell') !== null,
      panel: document.querySelector('.dshm-main')?.getAttribute('data-dsh-panel') ?? null,
      adaptPanel: document.querySelector('.dshm-main')?.getAttribute('data-dshm-adapt-panel') ?? null,
      optOut: document.documentElement.getAttribute('data-dsh-adapt'),
      main: touchMetrics(root),
      market: market === null ? null : touchMetrics(market),
      chrome: chromeMetrics(),
      floaters: getComputedStyle(document.documentElement).getPropertyValue('--dshm-floaters').trim(),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }
  }

  function render() {
    const data = collect()
    const lines = [
      `DV ${data.inner} dpr=${data.dpr} vv=${data.visual} screen=${data.screen}`,
      `safe=${data.safe} shell=${data.shell} panel=${data.panel} adapt=${data.adaptPanel} off=${data.optOut ?? '-'}`,
      `main n=${data.main.count} min=${data.main.min} <44=${data.main.under44} hit=${data.main.checked - data.main.miss}/${data.main.checked}`,
      data.market === null ? 'market -' : `market n=${data.market.count} min=${data.market.min} <44=${data.market.under44} hit=${data.market.checked - data.market.miss}/${data.market.checked}`,
      `floaters=${data.floaters || '-'} overflow=${data.overflow} nav=${data.chrome.nav.join(',') || '-'} rows=${data.chrome.rows.join(',') || '-'}`,
    ]
    let panel = document.getElementById(PANEL_ID)
    if (panel === null) {
      panel = document.createElement('div')
      panel.id = PANEL_ID
      panel.style.cssText = [
        'position:fixed', 'z-index:2147483647', 'left:0', 'right:0', 'top:0',
        'margin:0', 'padding:6px 8px', 'background:#052e16', 'color:#86efac',
        'font:11px/1.35 ui-monospace,monospace', 'white-space:pre-wrap',
        'pointer-events:none', 'box-shadow:0 -2px 8px rgba(0,0,0,.4)',
      ].join(';')
      document.body.append(panel)
    }
    const pilotLines = Array.isArray(window.__dvPilot) ? window.__dvPilot : []
    panel.textContent = [...lines, ...pilotLines].join('\n')
    return data
  }

  function panelSnapshot() {
    const main = document.querySelector('[data-slot="main"]')
    const nav = [...document.querySelectorAll('.dshm-panelNav :is(button, [role="button"])')].map(node => Math.round(node.getBoundingClientRect().height))
    return {
      panel: document.querySelector('.dshm-main')?.getAttribute('data-dsh-panel') ?? null,
      touch: main === null ? null : touchMetrics(main),
      nav,
      floaters: getComputedStyle(document.documentElement).getPropertyValue('--dshm-floaters').trim(),
    }
  }

  const sleep = milliseconds => new Promise(resolve => window.setTimeout(resolve, milliseconds))

  /** Click a sidebar row by its visible text; this replaces blind adb taps. */
  async function pilot() {
    const results = ['pilot start']
    const rows = () => [...document.querySelectorAll('[data-slot="sidebar"] *')]
      .filter(element => element.children.length === 0 && element.textContent.trim() !== '')
    const findRow = name => rows().find(element => element.textContent.trim() === name)
    if (findRow('Context Insights') === undefined) {
      const toggle = [...document.querySelectorAll('[data-slot="sidebar"] button, [data-slot="sidebar"] [role="button"]')]
        .find(element => /expand|collapse|展开|收起/iu.test(element.getAttribute('aria-label') ?? element.textContent ?? ''))
      if (toggle !== undefined) {
        toggle.click()
        await sleep(1500)
        results.push('drawer expanded')
      }
    }
    const labels = [...document.querySelectorAll('[data-slot="sidebar"] *')]
      .filter(element => element.children.length === 0 && element.textContent.trim() !== '')
      .map(element => element.textContent.trim())
    results.push('texts: ' + JSON.stringify(labels.slice(0, 40)))
    const aria = [...document.querySelectorAll('[data-slot="sidebar"] [aria-label]')].map(element => element.getAttribute('aria-label')).slice(0, 20)
    results.push('aria: ' + JSON.stringify(aria))
    const sidebarButtons = () => [...document.querySelectorAll('[data-slot="sidebar"] [aria-label]')]
    const findButton = labels => sidebarButtons().find(element => labels.includes(element.getAttribute('aria-label')))
    for (const [name, labels] of [['Context Insights', ['上下文洞察', 'Context Insights']], ['Todos', ['待办', 'Todos']], ['Plugins', ['插件', 'Plugins']]]) {
      const button = findButton(labels)
      if (button === undefined) { results.push(`${name}: aria button not found`); continue }
      button.click()
      await sleep(2500)
      const snapshot = panelSnapshot()
      const drawerRows = [...document.querySelectorAll('[data-slot="sidebar"] button')]
        .map(node => Math.round(node.getBoundingClientRect().height))
        .filter(height => height > 0)
      results.push(`${name}: ${JSON.stringify({ ...snapshot, drawerRows })}`)
      document.documentElement.setAttribute('data-dsh-adapt', 'off')
      await sleep(350)
      results.push(`${name} opt-out: ${JSON.stringify(panelSnapshot())}`)
      document.documentElement.removeAttribute('data-dsh-adapt')
      await sleep(200)
      const back = document.querySelector('.dshm-panelNav :is(button, [role="button"])')
      if (back !== null) { back.click(); await sleep(1600) }
    }
    results.push(`home: ${JSON.stringify(panelSnapshot())}`)
    window.__dvPilot = results
    render()
    results.forEach(line => console.info('[pilot] ' + line))
  }

  window.__dshVerify = render
  render()
  const timer = window.setInterval(render, 1000)
  window.addEventListener('pagehide', () => window.clearInterval(timer), { once: true })
  window.setTimeout(() => { void pilot() }, 2500)
})()
