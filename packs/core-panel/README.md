# core-panel · 第三方插件面板的手机下限

> 把 `移动适配-dsh-mobile补丁/` 里的「通用三件」从**改宿主**迁成一张独立扩展包：触控命中下限、窄屏宽度回收、56px 折叠轨道让位。不点名任何插件，不改 dsh-mobile 的 `lib/`。

- **目标插件**：无（`target: null` 的通配下限）。这是收录表里唯一被允许的通配例外，因此 `catalog.json` 里 `default: "off"`，由用户点名开启。
- **宿主**：dsh-mobile 0.8.0（DSH 0.2.1-rc.2）。`0.7.1` 的 `.dshm-*` 结构与之文本一致，但本包只在 0.8.0 上作为基线登记（`verifiedWith`）。
- **风险 / 状态**：`safe` / `experimental`。全是 CSS 下限 + 一个只写属性的 shim，不动插件 DOM 结构、不注入任何脚本到插件上下文。
- **回滚**：删掉 `$DSH_HOME/mobile-access/extensions/core-panel/` 即可（2s 内卸载）；本包不改任何已安装的 DSH 产物。

---

## 1. 它做什么

| # | 规则 | 生效条件 |
|---|---|---|
| 1 | 插件面板内 `button` / `[role="button"]` / `select` 高度 ≥ 44px；`button` / `[role="button"]` 宽度 ≥ 44px（svg-only 图标按钮）；`input`（非 checkbox/radio）/ `textarea` 高度 ≥ 44px | 粗指针 + 面板打开 |
| 1b | `[role="switch"]` / `[role="checkbox"]` 是显式例外：只撤掉 44px 下限、保持插件自己的视觉尺寸（命中区交给控件自己的 label），见 §5 | 粗指针 + 面板打开 |
| 2 | ≤720px 上面板让开折叠的 56px 图标轨道：让位加在 `.dshm-mainContent` 的 `padding-left` 上（实测轨道宽，写进 `--dshm-rail`，0–64px） | ≤720px + 面板打开 |
| 2b | 让位后插件根不超出剩余宽度：主槽根节点 `max-width:100%` + `box-sizing:border-box` | ≤720px + 面板打开 |
| 3 | 面板页底部让出 `env(safe-area-inset-bottom)` | ≤720px + 面板打开 |

**面板状态不用 `:has()`。** `mobile.js` 用 `MutationObserver` + `requestAnimationFrame` 节流，在外壳 `.dshm-main` 上写 `data-dsh-panel="1|0"`；CSS 只认这个属性。部分 WebView 没有 `:has()`，第一版补丁在真机上因此整体失效过。

**为什么让位加在 `.dshm-mainContent` 的 padding 上，而不是插件根的 margin**：插件根常是 `width:100%`，给它加 margin 会变成 100%+56，右边被宿主的 `overflow:hidden` 裁掉。padding 缩小的是内容盒，子节点按剩余宽度布局——本包同时用 `max-width:100%` + `border-box` 兜住 `100vw` / 固定像素宽的面板根。

**为什么不注入 `<style>`**：扩展运行时会把 `mobile.css` 自动注入成 `<style data-dsh-mobile-extension-style="core-panel">`（dsh-mobile `src/client.ts`）。`mobile.js` 只写属性和 CSS 变量，所以重复 `activate` 不会产生第二个 `<style data-plugin="core-panel">`——本包根本不创建 style 节点。重复激活会先执行上一代的 cleanup，observer / rAF / resize 监听不会叠加。

## 2. opt-out 的语义

opt-out 是**面板级**开关：只要主槽 `[data-slot="main"]` 的**子树**里出现 `data-dsh-adapt="off"`，或者主槽 / 外壳祖先（`.dshm-mainContent`、`.dshm-main`、`body` …）带这个属性，shim 就把整个面板状态写成 `data-dsh-panel="0"`。CSS 的三条规则都只在 `"1"` 下命中，所以 opt-out 是「关掉面板状态」而不是「再用一套规则覆盖回去」：

- 按钮/输入回到插件自己的 28/32px；
- 面板左缘回到 0，不再让位；
- 底部安全区也不再追加。

为什么对整棵子树求值：插件经常在 `[data-slot="main"]` 与真正的面板之间再包一层，也可能一次渲染多个根；只认「第一个直接子元素」会让 `off` 静默失效（评审 F3）。代价是：任意后代自己写的 `off` 也会关掉整张面板——这是刻意的面板级语义，不给单个控件开小灶；要细粒度只关一个控件，应由插件自己控制样式，而不是用这个属性。

opt-out 可以在页面生命周期里切换，`data-dsh-adapt` 的属性变化也在 observer 范围内。

**注意**：本包的 CSS 与 shim 是同一个状态开关。只加载 `mobile.css` 而没有 `mobile.js` 时，`data-dsh-panel` 永远不会被写上，规则整体不生效（这是刻意的：没有状态就没有适配）。

## 3. 用到的宿主标记（债务登记）

| 标记 | 用途 | 登记位置 |
|---|---|---|
| `.dshm-main` | 写 `data-dsh-panel`、挂 `--dshm-rail` | `catalog.json` → `usesHostMarkers` |
| `.dshm-mainContent` | 让位 padding-left / 底部安全区 | 同上 |
| `.dshm-panelNav` / `.dshm-panelBack` | 判断「面板打开」 | 同上（两个都已登记；`panelBack` 是同义的备用判据，不是主依赖） |
| `.dshm-drawer` | 实测折叠轨道宽度（`data-open` / 显隐 / 宽度） | 同上 |

`.dshm-*` 是 dsh-mobile 的内部类名，没有公开契约。任一标记消失，这张包就会失效，CI（`tools/check-pack.mjs`）对 DOM 快照做存在性断言时会红到具体标记，不是静默失效。

## 4. 与上游意图的显式偏离

dsh-mobile 0.8.0 在手机上**刻意**让抽屉以 56px 覆盖层压在内容上、不让位（#306 只给 721–899px 补了 56px margin）。本包在 ≤720px 推出 56px 是**与外壳意图不同的一次显式偏离**，理由：折叠轨道是 `position:fixed` 覆盖层，插件面板没有外壳 header 的 `padding-left:52px`，左边 56px 会被轨道压住（补丁 §1 的真机证据）。

因此：

- 收录表里 `default: "off"`，不默认改变任何人的页面；
- 只在 `mobile-dedicated` 面生效（stock DSH web 面没有 `.dshm-*`，不在本包范围）；
- 不满意可以用 `data-dsh-adapt="off"` 或直接不安装。

## 5. 代价与边界

- **`!important` 会压过插件自己的紧凑设计**。插件若坚持 28px 行，只能在面板根再用 `!important` 反覆盖，或整体 `data-dsh-adapt="off"`。这是「通配下限」的代价，也是它默认关的原因。
- **开关/勾选不放大视觉**：`[role="switch"]` / `[role="checkbox"]` 只撤掉 44px 下限（`min-height/min-width: 0 !important`），保持插件自己的 24/20px 视觉；命中区交给控件自己的 label / 外层可点区域。这个取舍的理由：用伪元素硬扩命中区会覆盖开关自己的 `::before/::after`（轨道/旋钮），所以本包不这么做。若某个插件没有 label，需要它自己补 44px 命中层。
- **56px 让位对「贴边全幅」插件（画布、看图）不一定合适**：面板左缘会被推 56px。画布类插件应 opt-out，或在面板根再用 `!important` 抵消。
- **只覆盖粗指针 + 面板打开**：桌面/鼠标不变；没有 `.dshm-panelNav` 的会话页不变。
- **不碰弹层**：portal 到 `<body>` 的 `[role="dialog"]` 不在范围内；DSH 自己的设置页也是 `role="dialog"`，上一版补丁在这里把开关撑成大方块后已撤销。
- **不改排版/字号**：dsh-mobile 自己已对输入框字号用 `font-size: max(16px, …) !important`，本包不重复设置，避免和插件排版打架。
- **轨道宽度是实测值**：抽屉动画中间值不会被当成让位量（展开时记 0）；若宿主换掉 56px 轨道，本包不需要改。
- 真机仍待验证：拇指准确度、真实 `env(safe-area-inset-*)`、软键盘后的可视区、惯性滚动。当前验证是 Playwright fixture（390×844 粗指针 / 1280×800 精指针），`catalog.json` 的 `verifiedWith` 记录的是目标基线 0.8.0，不代表真机已验收。

## 6. 验证

```bash
node tools/check-pack.mjs packs/core-panel --desktop
```

实测（fixture，读真实盒模型）：

| 指标 | 基线 | 装包后 | opt-out |
|---|---|---|---|
| 按钮高度 | 28px | **44px** | 28px |
| 图标按钮 | 28×28 | **44×44** | 28×28 |
| 输入高度 | 32px | **44px** | 32px |
| 下拉高度 | 32px | **44px** | 32px |
| 面板左缘 | 0px | **56px** | 0px |
| 面板右缘 | 390px | **390px** | 390px |
| 1280×800 桌面 | — | 逐项等于基线（`--desktop` 严格零回归） | — |

静态层同时断言：`extension.json` 恰好 5 字段、`id === core-panel`、全部 7 条选择器落在 `[data-dsh-panel="1"]` 作用域、无第三方类名、无 `:has()`、无 `@import`。

独立 Playwright 探针补测 check-pack fixture 未覆盖的两类（脚本在 `/tmp`，不随仓库发布）：

- **F2**：`button[role="switch"]` 24×24、`div[role="checkbox"]` 20×20 装包后视觉尺寸不变（开关自己的 `::after` 旋钮也未被覆盖）；同页普通按钮仍 44、输入仍 44。
- **F3**：面板被 wrapper 包一层、主槽多根、以及 `.dshm-mainContent` / `.dshm-main` 祖先带 `off` 时，`data-dsh-panel` 均为 0，按钮/输入/面板左缘全部回落到基线。

## 7. 与补丁的关系

本包是 `移动适配-dsh-mobile补丁/` 通用层的迁移目标，但**不是逐行复制**：

| 补丁 | 本包 |
|---|---|
| 改 `lib/mobile-layout.js`（安装即改产物） | 扩展目录，删目录即回滚 |
| 一个 IIFE 往 `<head>` 注入 `<style>` | CSS 由扩展运行时注入，`mobile.js` 不创建 style |
| 让位用 `margin-left`（CSS 注释解释 scrollLeft） | 按收录口径改用 `.dshm-mainContent` 的 `padding-left`，并用 `max-width/border-box` 防溢出 |
| 返回栏按钮、抽屉侧栏、reduced-motion | 未收录：返回栏/抽屉是宿主 UI，不属「插件面板」；reduced-motion 归宿主 |
| 开关/勾选的视觉复位 | 已迁移：`[role="switch"]` / `[role="checkbox"]` 撤掉 44px 下限，保持原视觉；命中区交给控件自己的 label |
| 通配且默认生效 | 通配但 `default: "off"`、可逐页 opt-out |

补丁等价性实测通过后，再按设计文档 §8 退役补丁；本任务不触碰 `移动适配-dsh-mobile补丁/`。
