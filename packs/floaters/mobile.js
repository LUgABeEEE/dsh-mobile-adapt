/**
 * floaters — 量出右下角浮动控件占的高度，写成 `--dshm-floaters`。
 *
 * 不点名任何插件的类名、id 或结构：只看"是不是固定在视口底部、是否压住内容区"，
 * 所以计费气泡、小助手入口、任何后来出现的同类控件都自动被算进来。
 *
 * 判定条件（全部满足才算）：
 *   - `position: fixed`；
 *   - 不在 `.dshm-shell` 里（外壳自己的东西不算）；
 *   - 有实际尺寸（≥ 24×24），高度不超过视口 60%（全屏遮罩不算）；
 *   - 贴着底部（底边离视口底 ≤ 12px）；
 *   - 落在右下（右边缘在视口 40% 之后），也就是压住内容的那一侧。
 *
 * 结果封顶在视口高度的 45%：真遇到一个占半屏的怪控件，也不能把面板挤没。
 *
 * 只在面板状态（`data-dsh-panel="1"`，由 core-panel 维护）或没有该属性时生效；
 * 面板关闭时内容本来就是整页会话，不需要让位。
 */
window.dshMobile.define({
  apiVersion: 1,
  id: 'floaters',
  activate(api) {
    const doc = api.document
    const win = api.window
    const root = doc.documentElement
    let frame = 0
    let observer = null
    let disposed = false
    const timers = []

    const optedOut = () => {
      if (typeof root.closest !== 'function') return false
      return root.closest('[data-dsh-adapt="off"]') !== null
        || doc.body?.closest?.('[data-dsh-adapt="off"]') != null
    }

    const apply = (clearance) => {
      if (disposed) return
      if (clearance > 0) {
        root.style.setProperty('--dshm-floaters', `${clearance}px`)
        root.setAttribute('data-dsh-floaters', '1')
      } else {
        root.style.removeProperty('--dshm-floaters')
        root.removeAttribute('data-dsh-floaters')
      }
    }

    const scan = () => {
      if (disposed) return
      if (optedOut()) {
        apply(0)
        return
      }
      const viewportHeight = win.innerHeight || 0
      const viewportWidth = win.innerWidth || 0
      if (viewportHeight === 0) return
      const cap = Math.round(viewportHeight * 0.45)
      let clearance = 0
      const nodes = doc.body === null ? [] : doc.body.querySelectorAll('*')
      for (const node of nodes) {
        const style = win.getComputedStyle(node)
        if (style.position !== 'fixed') continue
        if (style.display === 'none' || style.visibility === 'hidden') continue
        if (node.closest('.dshm-shell') !== null) continue
        const box = node.getBoundingClientRect()
        if (box.width < 24 || box.height < 24) continue
        if (box.height > viewportHeight * 0.6) continue
        if (box.bottom < viewportHeight - 12) continue
        if (box.right < viewportWidth * 0.4) continue
        const height = Math.round(viewportHeight - box.top)
        if (height > clearance) clearance = height
      }
      apply(Math.min(clearance, cap))
    }

    const schedule = () => {
      if (disposed || frame !== 0) return
      frame = win.requestAnimationFrame(() => {
        frame = 0
        scan()
      })
    }

    // 悬浮组件往往在页面加载后才挂上来，MutationObserver 负责跟进；
    // 旋转与软键盘会改变视口，resize 时重量一次。
    if (typeof win.MutationObserver === 'function') {
      observer = new win.MutationObserver(schedule)
      if (doc.body !== null) {
        observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] })
      }
      // The opt-out marker can be toggled at runtime on <html data-dsh-adapt="off">;
      // without this the measurement would stay stale until the next resize.
      observer.observe(root, { attributes: true, attributeFilter: ['data-dsh-adapt'] })
    }
    win.addEventListener('resize', schedule)
    win.addEventListener('orientationchange', schedule)
    // 首帧、以及两个"大概已经挂上来了"的时间点。
    schedule()
    timers.push(win.setTimeout(schedule, 400), win.setTimeout(schedule, 1500), win.setTimeout(schedule, 3000))

    return () => {
      disposed = true
      if (frame !== 0) win.cancelAnimationFrame(frame)
      observer?.disconnect()
      win.removeEventListener('resize', schedule)
      win.removeEventListener('orientationchange', schedule)
      for (const timer of timers) win.clearTimeout(timer)
      root.style.removeProperty('--dshm-floaters')
      root.removeAttribute('data-dsh-floaters')
    }
  },
})
