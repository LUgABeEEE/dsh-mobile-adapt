# dshmarket-mobile · 插件市场主面板的触控下限

> Targeted adaptation pack for `dshmarket` — raises the plugin-market panel's touch
> targets to the 44×44 floor on coarse pointers. Only `hit-target` is claimed;
> nothing else in the panel is touched.

- **目标插件**：`dshmarket`（面板根 `[data-dsh-market-root]`，入口：侧栏「插件市场」）。
  实测版本 **1.73.3**（本机 desktop profile 安装版）；仓库 HEAD `1.73.6` **未实测**。
- **实测环境**：**stock DSH web 挤到 390×844 · `(pointer: coarse)`**（隔离 DSH 实例）。
  dsh-mobile **专用移动页未验证**（本机未启用真实移动页）；真机未验证。
- **风险 / 状态**：`safe` / `experimental` — 纯 CSS 命中下限，不改结构、不注入脚本。
- **回滚**：删掉 `$DSH_HOME/mobile-access/extensions/dshmarket-mobile/` 即回滚（2s 内卸载）；
  本包不改任何已安装的 DSH 产物。opt-out 也可用：面板根/文档根带 `data-dsh-adapt="off"`。

## 1. 它做什么

| # | 规则 | 生效条件 |
|---|---|---|
| 1 | `[data-dsh-market-root]` 内 `button` / `[role="button"]` / `select`：最小边 ≥ 44px（图标按钮只有 svg，宽度也兜住） | 粗指针 |
| 2 | 面板内 `input` / `textarea`：高 ≥ 44px、`font-size` ≥ 16px（避免 iOS 聚焦自动放大） | 粗指针 |
| 3 | 面板内可操作控件 `touch-action: manipulation`（去掉 300ms 双击缩放等待） | 粗指针 |

选择器全部收敛在 `[data-slot="main"] [data-dsh-market-root]` 内；**没有使用任何 dshmarket 的 CSS
Module 哈希类名**（`nUhMVa_*`、`_button_1rv3m_*` 每次构建都会变，fixture 里保留了它们只为还原结构，
pack 不引用）。

## 2. 为什么只勾 `hit-target`

实测基线（stock web 390×844，抽屉收起，面板可用宽 334px）：

| 指标 | 基线 | 装包后 |
|---|---|---|
| 面板内可测控件 | 138（137 button + 1 input） | 138 |
| 最小边 < 44px 的控件 | **138 / 138**（最小 12.1px） | **0**（最小 44px） |
| 按钮高度 / 图标按钮宽度 | 28px / 28px | 44px / 44px |
| 输入框高 | 22px | 44px |
| 面板盒 | `x=56 w=334 right=390`，`scrollWidth=390` | 相同（布局未被改动） |

- **不勾 `width-reclaim`**：390×844 下面板右缘 = 390、`documentElement.scrollWidth = innerWidth`，
  **本来就不溢出**，没有要修的东西；勾了会变成虚报。
- **不勾 `rail-clearance` / `floater-clearance`**：轨道让位与浮动控件让位属于外壳/宿主职责；
  面板内也没有贴右下角的 fixed 浮动控件（安装 toast 走宿主 overlay）。
- **不勾 `chrome-collapse` / `notice-collapse` / `scroll-owner`**：包不改顶栏、提示行与滚动归属。

## 3. 定向 fixture（`fixture.html`）

`fixture.html`（142,712 B，< 256 KB）是 **dshmarket 1.73.3 真实主面板**在 390×844 下的 DOM 快照，
用于让 `check-pack` 在「这个插件自己的面板」上做真实盒模型断言，而不是在通用 fixture 上空转：

- 来源：隔离 DSH web 实例打开「插件市场」后抓取；捕获时 173 个可交互元素、172 个 <44px；
- 处理：只留面板子树；去掉 `href`/`src`/xmlns/外链/`@import`/`url()`；套上 check-pack 要求的
  最小外壳骨架（`.dshm-shell` / `.dshm-main` / `.dshm-mainContent` / `[data-slot="main"]`）；
- 脱敏：不含会话内容、账号、凭据、token、真实路径；面板内是公开插件目录数据；
- 局限：**结构/几何快照，不是像素复刻**；dshmarket 的 CSS Module 哈希类名在 fixture 中保留但
  **不可依赖**（`catalog.json` 的 `usesHostMarkers` 只登记真正用到的稳定标记）。

## 4. opt-out

`data-dsh-adapt="off"` 放在 `<html>` 或面板根上时，本包全部规则失效
（`mobile.css` 用 `:root:not([data-dsh-adapt="off"])` 守卫），面板回到插件自己的尺寸。
`check-pack` 的 opt-out 轮已验证：按钮 44→28、输入 44→22、面板盒回基线。

## 5. 验证

```bash
node tools/check-pack.mjs packs/dshmarket-mobile --desktop
```

本机实跑（Windows，2026-10-31）：

```
RESULT PASS（30 passed · 0 failed · 4 skipped）
```

- 静态层：5 字段 manifest、3 条选择器全部落在允许作用域、无第三方类名、无 `:has`、
  fixture 142,712 B 且无脚本/外链、浏览器可解析、壳骨架齐全；
- 运行时（390×844 粗指针）：137 个按钮最小边 ≥44、1 个输入控件高 ≥44、图标按钮 44×44、
  适配生效、opt-out 全部回落；
- 1280×800 精指针 + `--desktop` 严格零回归：mainContent 盒模型与全部控件矩形均未改动。

dsh-ui-lab 对照（**stock DSH web 口语境**，390×844 @3×，隔离实例 + `--inject` 模拟装包）：

| | 可测控件 | 最小边 | <44px | 面板盒 | 横向溢出 |
|---|---|---|---|---|---|
| before | 138 | **12.1px** | **138 / 138** | 334×844 @x=56 | 无 |
| after | 138 | **44px** | **0 / 138** | 334×844 @x=56（未变） | 无 |

截图：`shots/before-390x844.png`、`shots/after-390x844.png`（同口径，仅注入 CSS 不同）。
命令与原始 JSON 见本仓 PR 描述；复跑方式：起隔离实例 → 启用侧栏入口 → `node src/cli.mjs shot
--surface web --profile phone-390x844 --url <token> --open "插件市场" --inject packs/dshmarket-mobile`。
注意：stock web 挤压视口下抽屉是挤压式而非覆盖式，截图前需收起抽屉，否则面板只剩 110px 宽。

## 6. 未验证 / 边界

1. **dsh-mobile 专用移动页未实测**：本包 `surfaces` 只声明 `mobile-dedicated`（安装通道所在面），
   但本机没有可用的专用移动页运行时；所有数字来自 stock web 与合成外壳 fixture。
2. **真机未验证**：拇指准确度、真实 `env(safe-area-inset-*)`、软键盘弹出后的可视区。
3. **dshmarket 1.73.6 未测**：fixture 与基线都来自本机 1.73.3。
4. **输入框字号**：规则设为 16px，但 `check-pack` 当前只断言输入框高度（工具未断言字号），
   字号效果需在真实页面/真机复核。
5. **卡片整卡点击层**：dshmarket 的卡片是 `<a>`，不在 `check-pack` 的控件选择器内；本包只对
   按钮/输入类控件做下限，卡片点击层未改（如需 44px 整卡，应由插件自己或后续 pack 处理）。
6. **themes 全屏预览 / portal 弹层**：`[data-dsh-market-fullscreen]` / `[data-dsh-market-portal]`
   是其他状态且不在六项能力内，本包不覆盖。

## 7. 与上游的关系

这是「上游补 `data-dsh-*` 契约前」的过渡适配：选择器只依赖 dshmarket 自己写的
`[data-dsh-market-root]`（自检钩子也在读它，属于稳定自有契约）和宿主公共标记
`[data-slot="main"]`。若 dshmarket 后续把 44px 做进插件自身，本包应标 `retired`。
