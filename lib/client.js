/**
 * dsh-adapt-packs — client half.
 *
 * A settings section that turns the CLI into two clicks: list the catalog with
 * what is installed, install/uninstall a pack, and read the compatibility list.
 * Everything it shows comes from `/api/adapt-packs/state` (host half); the
 * browser never touches the filesystem.
 *
 * This is a self-registering bundle, not an ES module:
 *   window.__ModuleLoader__.load({ id: '<package name>', factory: (require) => … })
 */
window.__ModuleLoader__.load({
  id: 'dsh-adapt-packs',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/api/adapt-packs'

    const CSS = `
      .dap-root { display: flex; flex-direction: column; gap: 14px; font-size: 13px; }
      .dap-note { color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 12px; line-height: 1.6; }
      .dap-group-title { font-weight: 600; margin-bottom: 6px; }
      .dap-card { border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12)); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
      .dap-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .dap-meta { color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 12px; }
      .dap-actions { display: flex; gap: 8px; flex-shrink: 0; }
      .dap-btn { border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18)); background: transparent; color: inherit; border-radius: 8px; padding: 6px 12px; font-size: 12px; cursor: pointer; min-height: 32px; }
      .dap-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05)); }
      .dap-btn:disabled { opacity: .45; cursor: default; }
      .dap-btn-primary { border-color: currentColor; background: rgba(127,127,127,.22); font-weight: 600; }
      .dap-badge { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11px; border: 1px solid currentColor; opacity: .85; white-space: nowrap; }
      .dap-ok { color: #15803d; } .dap-warn { color: #b45309; } .dap-bad { color: #b91c1c; }
      .dap-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .dap-table th, .dap-table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08)); vertical-align: top; }
      .dap-table th { font-weight: 600; color: var(--dsw-alias-label-tertiary, #6b7280); white-space: nowrap; }
      .dap-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
    `

    const VERDICT_LABEL = {
      native: '原生可用',
      pack: '有适配包',
      upstream: '建议上游改',
      blocked: '做不了',
    }

    async function jsonFetch(path, options) {
      const response = await fetch(API + path, {
        credentials: 'same-origin',
        headers: options?.body === undefined ? undefined : { 'content-type': 'application/json' },
        ...options,
      })
      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      if (response.ok !== true) {
        const message = body?.error ?? `HTTP ${response.status}`
        throw new Error(body?.hint === undefined ? message : `${message}（${body.hint}）`)
      }
      return body
    }

    function Badge({ text, tone }) {
      return h('span', { className: `dap-badge ${tone ?? ''}` }, text)
    }

    function PackCard({ pack, busy, onInstall, onUninstall }) {
      const state = pack.installed ? '已安装' : pack.disabled ? '已停用' : '未安装'
      const tone = pack.installed ? 'dap-ok' : pack.disabled ? 'dap-warn' : ''
      const capabilities = pack.capabilities.length === 0 ? '' : ` · ${pack.capabilities.join(' + ')}`
      return h('div', { className: 'dap-card' },
        h('div', { className: 'dap-row' },
          h('div', null,
            h('div', null, h('strong', null, pack.name !== pack.id ? pack.name : pack.id), ' ', pack.name !== pack.id ? h('span', { className: 'dap-mono' }, pack.id) : null, pack.name !== pack.id ? ' ' : null, h('span', { className: 'dap-meta' }, pack.version ?? '—')),
            h('div', { className: 'dap-meta' }, `${pack.status} · risk ${pack.risk} · 默认${pack.byDefault === 'off' ? '关' : '开'}${pack.target === null ? '' : ` · ${pack.target}`}${capabilities}`),
          ),
          h('div', { className: 'dap-actions' },
            h(Badge, { text: state, tone }),
            pack.installed
              ? h('button', { className: 'dap-btn', disabled: busy, onClick: () => onUninstall(pack.id) }, busy ? '处理中…' : '卸载')
              : h('button', { className: 'dap-btn dap-btn-primary', disabled: busy || pack.disabled === false && pack.version === null, onClick: () => onInstall(pack.id) }, busy ? '处理中…' : pack.disabled ? '重新安装' : '安装'),
          ),
        ),
      )
    }

    function HostBaseline({ lines }) {
      if (!Array.isArray(lines) || lines.length === 0) return null
      return h('div', { className: 'dap-note', style: { marginBottom: 6 } },
        ...lines.map(line => h('div', { key: line.dshMobile },
          h('strong', null, `宿主 ${line.dshMobile}`), '：', line.summary ?? '')),
      )
    }

    function CompatTable({ entries, updated }) {
      if (entries.length === 0) return h('div', { className: 'dap-note' }, '兼容清单是空的。')
      return h('div', null,
        h('div', { className: 'dap-note', style: { marginBottom: 6 } }, `更新于 ${updated ?? '?'} · ${entries.length} 个插件 · 结论由 ${'`dsh-adapt-packs compat`'} 与 docs/兼容清单.md 维护`),
        h('table', { className: 'dap-table' },
          h('thead', null, h('tr', null, h('th', null, '插件'), h('th', null, '版本'), h('th', null, '结论'), h('th', null, '说明'))),
          h('tbody', null, ...entries.map(entry => h('tr', { key: entry.plugin },
            h('td', null, h('span', { className: 'dap-mono' }, entry.plugin)),
            h('td', null, entry.version ?? '—'),
            h('td', { style: { whiteSpace: 'nowrap' } }, h(Badge, { text: VERDICT_LABEL[entry.verdict] ?? entry.verdict, tone: entry.verdict === 'pack' ? 'dap-ok' : entry.verdict === 'blocked' ? 'dap-bad' : '' })),
            h('td', null, h('div', null, entry.summary ?? ''), entry.mobile === undefined ? null : h('div', { className: 'dap-meta' }, entry.mobile)),
          ))),
        ),
      )
    }

    function Panel() {
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [loading, setLoading] = React.useState(true)

      const load = React.useCallback(async () => {
        setLoading(true)
        try {
          setState(await jsonFetch('/state'))
          setError('')
        } catch (fetchError) {
          setError(fetchError instanceof Error ? fetchError.message : String(fetchError))
        } finally {
          setLoading(false)
        }
      }, [])

      React.useEffect(() => { load() }, [load])

      const act = async (kind, id) => {
        setBusy(id)
        setNotice('')
        try {
          const result = await jsonFetch(`/${kind}`, { method: 'POST', body: JSON.stringify({ id }) })
          setState(result)
          setNotice(kind === 'install' ? `已安装 ${id}（${result.written} 个文件）` : `已卸载 ${id}`)
          setError('')
        } catch (actionError) {
          setError(actionError instanceof Error ? actionError.message : String(actionError))
        } finally {
          setBusy('')
        }
      }

      if (loading && state === null) return h('div', { className: 'dap-root' }, h('div', { className: 'dap-note' }, '正在读取…'))
      if (state === null) {
        return h('div', { className: 'dap-root' },
          h('div', { className: 'dap-bad' }, `读取失败：${error}`),
          h('button', { className: 'dap-btn', onClick: load }, '重试'),
        )
      }

      return h('div', { className: 'dap-root' },
        h('div', { className: 'dap-note' },
          `DSH_HOME：${state.dshHome}。包会装进 ${state.extensionsRoot}，卸载只是移到 ${state.disabledRoot}（可移回）。`),
        error === '' ? null : h('div', { className: 'dap-bad' }, error),
        notice === '' ? null : h('div', { className: 'dap-ok' }, notice),
        h('div', null,
          h('div', { className: 'dap-group-title' }, `适配包（${state.packs.filter(pack => pack.installed).length}/${state.packs.length} 已安装）`),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            ...state.packs.map(pack => h(PackCard, {
              key: pack.id,
              pack,
              busy: busy === pack.id,
              onInstall: id => act('install', id),
              onUninstall: id => act('uninstall', id),
            })),
          ),
        ),
        state.stray.length === 0 ? null : h('div', { className: 'dap-warn' },
          `已安装但不在 catalog 里：${state.stray.join('、')}`),
        h('div', null,
          h('div', { className: 'dap-group-title' }, '兼容清单'),
          h(HostBaseline, { lines: state.compatHostBaseline }),
          h(CompatTable, { entries: state.compat, updated: state.compatUpdated }),
        ),
        h('div', { className: 'dap-note' },
          '安装/卸载默认作用于当前 DSH_HOME；命令行等价物：dsh-adapt-packs install <id> --yes'),
      )
    }

    return {
      apply(ctx) {
        // A settings panel must never be able to take the web boot down: in a
        // profile without the settings UI the slot does not exist, and a throw
        // here fails the whole bundle entry ("entry did not activate").
        try {
          const style = document.createElement('style')
          style.setAttribute('data-plugin-css', 'dsh-adapt-packs')
          style.textContent = CSS
          document.head.appendChild(style)
          if (typeof ctx.effect === 'function') {
            ctx.effect(() => () => style.remove(), 'dsh-adapt-packs: 样式')
          }
          const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) ?? ctx.slots
          if (!slots) return
          slots.inject('settings.section', () => slots.register(
            { name: 'settings.section', id: 'adapt-packs', order: 32, label: '插件适配' },
            () => h(Panel),
          ))
        } catch (error) {
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('dsh-adapt-packs: 设置分区不可用，跳过面板（CLI 仍然可用）', error)
          }
        }
      },
    }
  },
})
