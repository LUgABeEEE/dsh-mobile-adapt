# floaters — 让面板内容躲开右下角的浮动控件

## 问题

外壳层会出现固定在右下角的悬浮组件：计费气泡、小助手入口、这类东西。它们
`position: fixed` + 高 z-index，**压在插件面板的最后几行上**。面板自己滚动，滚到底也
还是被盖住 —— 最后一条既看不到、也点不到。

真实测量（dsh-mobile 0.7.1，390×844，Global todos 面板）：

| | |
|---|---|
| 浮动控件 | `268,722 → 390,844`，高 **122px**，`z-index: 9999` |
| 面板底部 | y=844（被压 122px） |
| 滚到底 | 仍停在 y=844，最后一行始终在控件下面 |

## 做法：留位置，不搬别人的控件

移动别人的悬浮控件需要在选择器里点名第三方类名 —— 收录标准 §2 禁止，而且每来一个新
控件就得加一条规则。所以这里反过来：**量出控件占了多高，把这块空间从面板里让出来**。

1. `mobile.js` 扫描 `position: fixed`、贴底、落在右下、有实际尺寸、**不在 `.dshm-shell` 里**
   的元素，取最大的占用高度，写进 `--dshm-floaters`，同时给 `<html>` 打 `data-dsh-floaters="1"`；
2. `mobile.css` 把这个值变成面板根的 `margin-bottom`，并让 `.dshm-mainContent` 可滚 —— 于是
   末尾内容能再往上滚 122px，停在控件上方；
3. 没有悬浮控件的页面，`data-dsh-floaters` 不存在，两条规则完全不命中。

**为什么用 margin 不用 padding**：padding 缩小面板自身的内容盒，列表一次少看一百多像素
（实测 273px → 153px）；margin 是往外要空间，由外层滚动吸收，**列表视口尺寸不变**，
只是"能再往下滚一点"。

## 生效条件与边界

- 粗指针（`(pointer: coarse)`）；桌面与触控板不受影响，1280×800 逐项零改动。
- 只在面板状态有价值；没有面板时不产生可视变化（规则依赖 `data-dsh-floaters`，套件里的
  `<html>` 标记与面板状态互不干扰）。
- 让位高度封顶在视口 45%：真遇到占半屏的怪控件，也不会把面板挤没。
- 不移动、不改色、不改 `z-index` —— 别人的控件保持原样，只是内容不再钻到它下面。

## opt-out

```html
<html data-dsh-adapt="off">
```

`mobile.js` 监听 `<html>` 的属性变化，切到 off 后立刻清掉 `--dshm-floaters` 与标记；
CSS 也整段不命中，面板回到原来的 margin。

## 验证

```bash
node tools/check-pack.mjs packs/floaters            # 30 passed / 0 failed / 3 skipped
node tools/check-pack.mjs packs/floaters --desktop  # 含 1280×800 零改动
```

fixture 里放了一个 112×118 的右下角固定控件，断言四条：

| 断言 | 判据 |
|---|---|
| `runtime.floater.measure` | 量出的 `--dshm-floaters` ≥ 控件高度 |
| `runtime.floater.scroll` | 面板状态 `mainContent` 的 `overflow-y` 是 `auto/scroll` |
| `runtime.floater.gap` | 面板根 `margin-bottom` ≥ 控件高度 |
| `runtime.floater.reach` | 滚到底后**面板底部 ≤ 控件顶部**（真的让开了，不只是数字对） |

## 真实运行时取证（0.7.1，2026-10-31）

| 观察项 | 结果 |
|---|---|
| 注入 | `style[data-dsh-mobile-extension-style]` = `core-panel` + `floaters` + `shell-chrome` |
| 量测 | `--dshm-floaters = 122px`（真实 `dshwv-root` 的高度），`data-dsh-floaters="1"` |
| 应用 | 面板根 `margin-bottom: 122px`，`mainContent overflow-y: auto`，可滚 |
| 滚到底 | 面板底部 y=**722** == 控件顶部 y=**722**，不再重叠 |
| opt-out | `--dshm-floaters` 清空、标记移除、`margin-bottom: 0px`、`overflow-y: hidden` |

0.8.0 未在该版本上跑过；真机指纹级验证（iOS Safari / Android WebView 的 `visualViewport`
与软键盘弹出）仍未做 —— 悬浮控件在键盘弹出时的位置变化不在本包断言范围内。
