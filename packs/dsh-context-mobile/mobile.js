/* dsh-context-mobile · mobile.js
 *
 * 只做一件事：判断「主槽里现在打开的是不是 dsh-context 的主面板」，把结论写成
 * 本包自有的 data-dshm-context-panel="1"（打在面板根上），CSS 只在它下面生效。
 *
 * 为什么需要这层桥：
 *   - dsh-context 0.79.0 的主面板根是 `SECTION.lc-ov-page`（2026-11-02 在真实
 *     0.8.1 宿主 + dsh-context 0.79.0 的 live DOM 上复核过），**没有** data-dsh-* 根标记
 *     （npm 包 lib/client.js 里 grep `data-dsh` 0 命中；上游把「加 data-dsh-context-root」
 *     列为待办，见本仓库 docs/首批高星适配清单.md §4.3）；
 *   - 它自己的 `data-lc-*` 属性命名空间（趋势卡 `data-lc-trend`、条形 `data-lc-bars`、
 *     提示 `data-lc-tip` / `data-lc-tip-side`、热力 `data-lc-current` / `data-lc-key`、搜索清除
 *     `data-lc-clearable`）是稳定、可观测的**定位**信号；live DOM 上 `data-lc-tip`
 *     就落在 `.lc-ov-page` 子树里，`closest('[data-slot="main"] > *')` 能落到面板根。
 *     本包只读这些属性，不写、不改，也不依赖 .lc-* 类名；
 *   - 宿主的 `data-dsh-panel` 由宿主维护（dsh-mobile #319 起），本包只读不写。
 *
 * 幂等 / 清理：activate 不创建 <style>（CSS 由宿主注入）；重复 activate 先执行上一代
 * cleanup；observer / rAF / resize 监听不会叠加。定位信号消失（切到别的面板、插件卸载）
 * 时立即摘掉标记，CSS 随之失效。
 */
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  var MARK = 'data-dshm-context-panel'
  var CLEANUP_KEY = '__dshMobileContextPanelCleanup'
  var SIGNAL = '[data-lc-trend],[data-lc-bars],[data-lc-tip],[data-lc-current],[data-lc-key],[data-lc-clearable]'

  function isOptedOut(slot) {
    if (document.documentElement.getAttribute('data-dsh-adapt') === 'off') return true
    if (typeof slot.closest === 'function' && slot.closest('[data-dsh-adapt="off"]') !== null) return true
    return slot.querySelector('[data-dsh-adapt="off"]') !== null
  }

  function activate(api) {
    var doc = (api !== null && api !== undefined && api.document) || document
    var win = (api !== null && api !== undefined && api.window) || window

    if (typeof win[CLEANUP_KEY] === 'function') {
      try { win[CLEANUP_KEY]() } catch (error) { /* 上一代清理失败不能阻断这一代 */ }
    }

    var marked = []
    var frame = 0
    var timer = 0
    var disposed = false

    function clearMarks() {
      for (var index = 0; index < marked.length; index += 1) marked[index].removeAttribute(MARK)
      marked.length = 0
    }

    function sync() {
      if (disposed === true) return
      var slot = doc.querySelector('[data-slot="main"]')
      if (slot === null || isOptedOut(slot)) {
        clearMarks()
        return
      }
      var signal = slot.querySelector(SIGNAL)
      if (signal === null) {
        clearMarks()
        return
      }
      var root = typeof signal.closest === 'function' ? signal.closest('[data-slot="main"] > *') : null
      if (root === null) {
        clearMarks()
        return
      }
      if (marked.length === 1 && marked[0] === root) return
      clearMarks()
      root.setAttribute(MARK, '1')
      marked.push(root)
    }

    function runFrame() {
      frame = 0
      sync()
    }

    function runTimer() {
      timer = 0
      sync()
    }

    /* 面板内容是动态的（切 tab、加载历史会重建子树）：只排下一帧，不逐条遍历。 */
    function schedule() {
      if (disposed === true) return
      if (frame !== 0 || timer !== 0) return
      if (typeof win.requestAnimationFrame === 'function') frame = win.requestAnimationFrame(runFrame)
      else timer = win.setTimeout(runTimer, 16)
    }

    function cancel() {
      if (frame !== 0) {
        if (typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(frame)
        frame = 0
      }
      if (timer !== 0) {
        win.clearTimeout(timer)
        timer = 0
      }
    }

    var observer = null
    if (typeof win.MutationObserver === 'function') {
      observer = new win.MutationObserver(schedule)
      observer.observe(doc.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-dsh-adapt'],
      })
    }

    win.addEventListener('resize', schedule)

    function cleanup() {
      if (disposed === true) return
      disposed = true
      cancel()
      if (observer !== null) observer.disconnect()
      win.removeEventListener('resize', schedule)
      if (api !== null && api !== undefined && api.signal !== null && api.signal !== undefined && typeof api.signal.removeEventListener === 'function') {
        api.signal.removeEventListener('abort', cleanup)
      }
      clearMarks()
      if (win[CLEANUP_KEY] === cleanup) {
        try { delete win[CLEANUP_KEY] } catch (error) { win[CLEANUP_KEY] = undefined }
      }
    }

    sync()
    if (api !== null && api !== undefined && api.signal !== null && api.signal !== undefined && typeof api.signal.addEventListener === 'function') {
      api.signal.addEventListener('abort', cleanup)
    }

    win[CLEANUP_KEY] = cleanup
    return cleanup
  }

  window.dshMobile.define({ apiVersion: 1, id: 'dsh-context-mobile', activate: activate })
})()
