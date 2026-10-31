# Changelog

本文件记录 `dsh-adapt-packs`（原 `dsh-mobile-adapt`）的包行为变更。包是**通配适配层**，
所以每条都写清「依据」与「适用范围（release 0.8.0 / main #319）」；没有证据的改动不进这里。

## [Unreleased]

### Fixed（设置页 UI，0.3.1）

- 「安装」主按钮在深色主题下不可见：原先用 `--dsw-alias-label-primary` 当底色、`--dsw-alias-bg-base` 当字色，两个 token 在深色主题下可能同时接近白色；改成中性半透明底 + `currentColor` 描边 + 加粗，两种主题都可见。
- 兼容清单的结论徽章换行成「有适 / 配包」：加 `white-space: nowrap`。
- 包名与 id 相同时卡片标题重复（`core-panel core-panel`）：名字等于 id 时只显示一次。

### 收口 dsh-mobile 0.8.0 实测（2026-10-31）

依据：`实测-0.8.0-20261031.md`（真实网关 `https://192.168.1.11:3443`，390×844 粗指针，
Plugins 面板；#319 / #316 均**不在** 0.8.0 安装包内，v0.8.0 发布于 10-30T03:14Z，
两 PR 合入 main 于 10-31T08:46Z）。

**Changed**

- `core-panel`：面板状态改用**包自有**的 `data-dshm-adapt-panel`，不再写宿主的
  `data-dsh-panel`（#319 起由宿主维护，旧实现会与宿主抢写）。
- `core-panel`：高度地板（44px）与面板根宽度收口（`max-width:100%`）加上版本门阀
  `.dshm-main:not([data-dsh-panel])`——0.8.x 上仍由本包提供（纯宿主 94/94 控件 <44px，
  本包抬起 53 个）；宿主接管面板状态后退让，不重复叠加。
- `core-panel`：`min-width:44px`（svg-only 图标按钮）**不设门阀**，两条发布线都保留
  （宿主 #319 只给高度）。
- `shell-chrome`：返回栏规则从 `44px !important` 改为特异性 0、无 `!important` 的
  **rise-only** 兜底。0.8.0 宿主 `.dshm-panelBack` 已是 48px，旧规则会把 48 压成 44
  （panelNav 57→56，实测负收益）；现在宿主更大时不动它，宿主没给时才抬到 44px。
- `catalog.json`：`core-panel.capabilities` 去掉 `rail-clearance`；`usesHostMarkers`
  去掉 `.dshm-drawer`、加入 `[data-slot="main"]`；`verifiedWith` 增加
  `dshMobileMain: "post-#319 (6c50b13, unreleased)"`；三个包的 `evidence` 换成
  0.8.0 运行时数值并标注【事实】/【推断】。
- `tools/check-pack.mjs`：
  - 选择器作用域接受包自有的 `data-dsh*="1"` 状态属性（任意包内命名，如 `data-dshm-adapt-panel`、`data-dsh-floaters`）与宿主的 `[data-dsh-panel]`（含 `:not()` 形式）；
  - 新增 host-probe：声明了门阀的包会伪造「宿主已写 `data-dsh-panel`」，断言门阀退让、
    宿主属性未被改写、`min-width` 仍生效（`runtime.hostGate.*`）；
  - 移除 `rail-clearance` 断言组（能力已退役），390×844 指标表里「面板左缘」判据从
    `≥ 56px` 改为 `= 基线`。
- `tools/phone-instance.mjs`：探针改读 `data-dshm-adapt-panel`（并打印宿主的 `data-dsh-panel`），移除 `--dshm-rail`。
- 文档：`packs/core-panel/README.md`、`packs/shell-chrome/README.md`、
  `packs/floaters/README.md`、根 `README.md`（新增「Two release lines: 0.8.0 vs main」）、
  `docs/收录标准.md`（新增面板状态归属与 release/main 口径，`rail-clearance` 标为退役）、
  `docs/定向-fixture.md`、`packs/_template/README.md`、`docs/examples/fixture-pack/`
  同步；新增本 CHANGELOG。

**Removed**

- `core-panel` 的 `rail-clearance`：390 面板态抽屉是 `data-right-modal` → `display:none`
  （宽 0），768 上宿主已 `margin-left:56px` 让位且 `@media (max-width:720px)` 不命中——
  两种尺寸都没有可测量的让位场景（实测 `--dshm-rail` = 0px / 56px，面板左右缘不变）。
  连带删除 `--dshm-rail` 变量、`measureRail()` 与 check-pack 的对应断言组。

**Unverified**

- 含 #319 的构建（≥0.8.1，尚无 tag）：门阀退让只在 check-pack 的 host-probe 合成状态下验证，
  未在真实宿主上量。
- 真机（iOS / Android WebView）：拇指准确度、真实 `env(safe-area-inset-bottom)`（headless 为 0）、
  软键盘后的可视区。
- `width-reclaim` 与底部安全区在 0.8.0 上「规则在、场景没有」（面板态 390/390、768/768 无溢出）。
- `shell-chrome` 抽屉行的 `!important` 若遇到宿主 >44px 的行高会压小（当前宿主 36px，风险未发生）。

## [0.1.0] — 2026-10-30

- 首批三张包：`core-panel`（44px 命中区 + 宽度回收 + 56px 轨道让位）、`shell-chrome`
  （返回栏 / 抽屉行）、`floaters`（右下浮动控件让位），均 `default: off`、可 `data-dsh-adapt="off"`。
- `check-pack` 三层校验（static / runtime / desktop）与定向 fixture 契约。
- 当时的证据基线是 dsh-mobile 0.7.1 运行时 + Playwright fixture。
