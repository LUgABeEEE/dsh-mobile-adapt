/* fixture-pack · 示例包的 mobile.js
 *
 * 只做宿主替不了的两件事：把“面板是否打开”和折叠轨道宽度写到 DOM 上，以及
 * 量出定向 fixture 里 [data-fixture="floater"] 占用的高度。完整说明见
 * docs/收录标准.md §11。
 */
window.dshMobile.define({
  apiVersion: 1,
  id: 'fixture-pack',
  activate(api) {
    const doc = api.document
    const win = api.window
    let frame = 0
    let observer = null

    const apply = () => {
      const root = doc.documentElement
      const main = doc.querySelector('.dshm-main')
      if (main === null) return

      const optedOut = typeof root.closest === 'function' && root.closest('[data-dsh-adapt="off"]') !== null
      const hasNav = main.querySelector('.dshm-panelNav') !== null
      main.setAttribute('data-dsh-panel', hasNav === true && optedOut === false ? '1' : '0')

      const drawer = doc.querySelector('.dshm-drawer')
      let rail = 0
      if (optedOut === false && drawer !== null && drawer.getAttribute('data-open') !== 'true') {
        const width = Math.round(drawer.getBoundingClientRect().width)
        rail = width > 0 ? Math.min(width, 64) : 0
      }
      main.style.setProperty('--dshm-rail', `${rail}px`)

      const floater = doc.querySelector('[data-fixture="floater"]')
      if (optedOut === false && floater !== null) {
        const height = Math.min(Math.round(win.innerHeight - floater.getBoundingClientRect().top), Math.round(win.innerHeight * 0.45))
        if (height > 0) {
          root.style.setProperty('--dshm-floaters', `${height}px`)
          root.setAttribute('data-dsh-floaters', '1')
          return
        }
      }
      root.style.removeProperty('--dshm-floaters')
      root.removeAttribute('data-dsh-floaters')
    }

    const schedule = () => {
      if (frame !== 0) return
      frame = win.requestAnimationFrame(() => {
        frame = 0
        apply()
      })
    }

    apply()
    win.addEventListener('resize', schedule)
    observer = new win.MutationObserver(schedule)
    observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-dsh-adapt'] })

    return () => {
      if (frame !== 0) win.cancelAnimationFrame(frame)
      if (observer !== null) observer.disconnect()
      win.removeEventListener('resize', schedule)
      doc.documentElement.style.removeProperty('--dshm-floaters')
      doc.documentElement.removeAttribute('data-dsh-floaters')
    }
  },
})
