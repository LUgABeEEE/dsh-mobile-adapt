/* core-panel · mobile.js
 *
 * 扩展运行时负责注入 mobile.css（<style data-plugin-id>），这里只做宿主替不了的事：
 * 把「面板是否打开」变成外壳上的 data-dsh-panel="1|0"，并实测折叠轨道的宽度写成
 * --dshm-rail，让 CSS 能按状态生效而不依赖 :has()。
 *
 * opt-out：主槽 `[data-slot="main"]` 的子树里出现 data-dsh-adapt="off"（面板常被
 * 包一层，也可能一次渲染多个根），或主槽/外壳祖先带 off 时，这个 shim 直接写
 * data-dsh-panel="0"（而不是让 CSS 再写一套重置规则）。这样「面板状态」只有一个
 * 开关，CSS 与 opt-out 不可能各说各话。
 *
 * 幂等：activate 不创建任何 <style> 节点（CSS 由宿主注入）；重复 activate 会先
 * 执行上一代的 cleanup，再安装新的 observer 与 rAF 串，不会叠加第二份监听。
 */
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  var STATE_ATTR = 'data-dsh-panel'
  var RAIL_PROP = '--dshm-rail'
  var CLEANUP_KEY = '__dshMobileCorePanelCleanup'
  var RAIL_MAX = 64

  /* 折叠轨道是 fixed 覆盖层；抽屉展开时是覆盖层动画，不产生让位。
   * 用实测宽度而不是写死 56：轨道被隐藏或换尺寸时面板不会凭空留白。 */
  function measureRail(doc, win) {
    var drawer = doc.querySelector('.dshm-drawer')
    if (drawer === null) return 0
    if (drawer.getAttribute('data-open') === 'true') return 0
    var style = win.getComputedStyle(drawer)
    if (style.display === 'none' || style.visibility === 'hidden') return 0
    var box = drawer.getBoundingClientRect()
    var width = Math.round(box.width)
    if (width <= 0) return 0
    return Math.min(width, RAIL_MAX)
  }

  /* opt-out 对整个主槽子树求值：插件可能把面板包一层，也可能一次渲染多个根，
   * 只认「第一个直接子元素」会让 off 静默失效。只要子树里出现 data-dsh-adapt="off"
   * （或主槽/外壳祖先带 off），就关掉这一页的面板状态——这是面板级开关，
   * 不给单个后代开小灶。 */
  function isOptedOut(pane) {
    var slot = pane.querySelector('[data-slot="main"]')
    if (slot === null) {
      return typeof pane.closest === 'function' && pane.closest('[data-dsh-adapt="off"]') !== null
    }
    if (slot.querySelector('[data-dsh-adapt="off"]') !== null) return true
    return typeof slot.closest === 'function' && slot.closest('[data-dsh-adapt="off"]') !== null
  }

  function activate(api) {
    var doc = (api !== null && api !== undefined && api.document) || document
    var win = (api !== null && api !== undefined && api.window) || window

    /* 上一代还活着就先拆掉：重复 activate 不叠加 observer / rAF / 属性锁。 */
    if (typeof win[CLEANUP_KEY] === 'function') {
      try { win[CLEANUP_KEY]() } catch (error) { /* 上一代清理失败不能阻断这一代 */ }
    }

    var records = []
    var frame = 0
    var timer = 0
    var disposed = false

    /* 记住第一次接手时外壳的原始属性，cleanup 时逐项还原。 */
    function remember(pane) {
      for (var index = 0; index < records.length; index += 1) {
        if (records[index].pane === pane) return records[index]
      }
      var record = {
        pane: pane,
        state: pane.getAttribute(STATE_ATTR),
        rail: pane.style.getPropertyValue(RAIL_PROP),
        railPriority: pane.style.getPropertyPriority(RAIL_PROP),
      }
      records.push(record)
      return record
    }

    function sync() {
      if (disposed === true) return
      var panes = doc.querySelectorAll('.dshm-main')
      for (var index = 0; index < panes.length; index += 1) {
        var pane = panes[index]
        remember(pane)
        var optedOut = isOptedOut(pane)
        var hasNav = pane.querySelector('.dshm-panelNav') !== null || pane.querySelector('.dshm-panelBack') !== null
        var next = hasNav === true && optedOut === false ? '1' : '0'
        if (pane.getAttribute(STATE_ATTR) !== next) pane.setAttribute(STATE_ATTR, next)
        var rail = optedOut === true ? 0 : measureRail(doc, win)
        pane.style.setProperty(RAIL_PROP, rail + 'px')
      }
    }

    function runFrame() {
      frame = 0
      sync()
    }

    function runTimer() {
      timer = 0
      sync()
    }

    /* 流式输出会持续改动 DOM：只排下一帧，不逐条遍历。 */
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
      /* data-dsh-adapt 的动向也要看：opt-out 可能在页面生命周期里被切换。 */
      observer.observe(doc.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-dsh-adapt'],
      })
    }

    var drawerObserver = null
    var drawer = doc.querySelector('.dshm-drawer')
    if (drawer !== null && typeof win.MutationObserver === 'function') {
      drawerObserver = new win.MutationObserver(schedule)
      drawerObserver.observe(drawer, { attributes: true, attributeFilter: ['data-open', 'style', 'class'] })
    }

    win.addEventListener('resize', schedule)

    function cleanup() {
      if (disposed === true) return
      disposed = true
      cancel()
      if (observer !== null) observer.disconnect()
      if (drawerObserver !== null) drawerObserver.disconnect()
      win.removeEventListener('resize', schedule)
      if (api !== null && api !== undefined && api.signal !== null && api.signal !== undefined && typeof api.signal.removeEventListener === 'function') {
        api.signal.removeEventListener('abort', cleanup)
      }
      for (var index = 0; index < records.length; index += 1) {
        var record = records[index]
        if (record.state === null) record.pane.removeAttribute(STATE_ATTR)
        else record.pane.setAttribute(STATE_ATTR, record.state)
        if (record.rail === '') record.pane.style.removeProperty(RAIL_PROP)
        else record.pane.style.setProperty(RAIL_PROP, record.rail, record.railPriority)
      }
      records.length = 0
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

  window.dshMobile.define({ apiVersion: 1, id: 'core-panel', activate: activate })
})()
