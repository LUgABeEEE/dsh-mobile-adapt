# dsh-context-mobile · 上下文/成本面板的手机触控下限

> Targeted adaptation pack for **`dsh-context`** (bowenliang123): raises the
> context dashboard's touch targets to the 44px floor on coarse pointers.
> Only `hit-target` is claimed. Not a PR; lives in this repository.

- **目标插件**：`dsh-context`，实测版本 **0.79.0**（npm tarball 与 `profiles/web/node_modules/dsh-context` 的 `lib/client.js` sha256 一致：`bf2295d8…304f69`）。
- **入口**：`conversation.view` 的「上下文」tab（`src/client/index.ts:64-65`）——**主槽面板**，因此 `check-pack` 的盒模型断言能直接量到它；composer overlay 与右栏 tab 不在本包范围。
- **面板根**：`.lc-root`。dsh-context 0.79.0 **没有** `data-dsh-*` 根标记（npm 包 `lib/client.js` 里 `data-dsh` 0 命中），上游把 `data-dsh-context-root` 列为待加契约（见 [`docs/首批高星适配清单.md`](../../docs/首批高星适配清单.md) §4.3）。
- **实测环境**：`check-pack` 定向 fixture（390×844 · `(pointer: coarse)`；1280×800 精指针零回归）。**没有在真实专用页/真机上跑过**。
- **风险 / 状态**：`safe` / `experimental`。纯 CSS 下限 + 一个只写自有标记的 shim；不改插件 DOM、不写宿主属性。
- **opt-out**：`<html data-dsh-adapt="off">` 或面板根/主槽子树带 `data-dsh-adapt="off"`，全部规则失效。
- **回滚**：删掉 `$DSH_HOME/mobile-access/extensions/dsh-context-mobile/`（约 2s 生效）；本包不改任何已安装文件。

## 0. 证据分级

| 证据层 | 状态 | 数字 |
|---|---|---|
| 定向 fixture（`check-pack`，390×844 粗指针） | **通过** | 按钮 26→44、图标按钮宽 22→44、搜索框高 28.8→44 且字号 13→16、下拉 28→44、自定义 `role=button` 行 →44；opt-out 全部回落；1280×800 + `--desktop` 严格零回归。**RESULT PASS（42 passed · 0 failed · 1 skipped）** |
| `host-probe`（伪造宿主已写 `data-dsh-panel`） | **通过** | 高度地板退让（按钮 26 / 输入 33.2，均 <44），宿主属性未被改写，`min-width` 仍生效（图标按钮 44） |
| 真实面板 / 专用页 / 真机 | **未做** | 本包没有安装到 `$DSH_HOME`（任务边界），也没有做 dsh-ui-lab/真机测量。 |

## 1. 它做什么

| # | 规则 | 生效条件 |
|---|---|---|
| 1 | 面板内 `button` / `[role="button"]` / `[role="tab"]` / `select` 高度 ≥ 44px | 粗指针 + 面板打开 + **宿主没有 `data-dsh-panel`**（0.8.x） |
| 2 | 面板内 `input`（非 checkbox/radio）/ `textarea` 高度 ≥ 44px | 同上 |
| 3 | `button` / `[role="button"]` / `[role="tab"]` 宽度 ≥ 44px（纯图标按钮） | 粗指针 + 面板打开，**两条宿主线都生效**（宿主只给高度） |
| 4 | `input` / `textarea` `font-size: max(16px, 1em)` | 粗指针 + 面板打开（防 iOS 聚焦自动放大） |
| 5 | 可点控件 `touch-action: manipulation`（去掉 300ms 双击缩放等待） | 粗指针 + 面板打开 |
| 6 | 面板内 `[role="group"]` 允许换行（`flex-wrap: wrap`） | 粗指针 + 面板打开 —— 本包把按钮抬到 44px 后，粒度/区间按钮组在 390px 里可能放不下 |
| 7 | `[role="tooltip"]` 限宽/折行（`max-width: min(320px, calc(100vw - 32px))`） | 粗指针 + 面板打开 —— 只解决显示时溢出，**不解决触控可达**（见 §4） |

**release / main 两条线**：0.8.x 宿主还没有 #319 的 44px 地板，本包给完整高度；0.8.1+ 宿主自己写 `data-dsh-panel` 并给面板内 button/select/input 44px 高度地板，规则 1/2 按 `.dshm-main:not([data-dsh-panel])` 退让，只保留宿主没有的 `min-width`（规则 3）与输入框 16px 字号（规则 4）。

## 2. 为什么要一层定位桥（`mobile.js`）

dsh-context 的面板根没有 `data-dsh-*` 标记，`.lc-*` 类名又是第三方私有类（收录标准禁止点名）。它能被外部稳定观测的是**自己的 `data-lc-*` 属性命名空间**：

- `data-lc-trend`（趋势卡，`components/contextView.tsx:625`）
- `data-lc-bars`（趋势条形，`contextView.tsx` 内）
- `data-lc-tip` / `data-lc-current` / `data-lc-key` / `data-lc-clearable`（提示、热力、搜索清除）

`mobile.js` 只在主槽 `[data-slot="main"]` 里看到这些信号时，给面板根打上**本包自有**的 `data-dshm-context-panel="1"`；CSS 全部收敛在这个标记下：

- 不点名 `.lc-*` 类名（静态层断言）；
- 不写宿主 `data-dsh-panel`（host-probe 断言它未被改写）；
- 信号消失（切到别的面板、插件卸载）时立即摘掉标记，CSS 随之失效；
- 幂等：不建 `<style>`，重复 `activate` 先清理上一代 observer / rAF / resize。

**代价**：这层耦合依赖 `data-lc-*` 属性名。上游若重命名，本包会**静默失效**（不报错）——`check-pack` 用合成 fixture，测不到真实页面上的信号缺失。这是本包最大的未验证风险，已写进 `catalog.json` 的 `evidence.missing`。

## 3. 为什么只勾 `hit-target`

基线（定向 fixture，390×844）：

| 指标 | 基线 | 装包后 |
|---|---|---|
| 面板内按钮 | 26px 高 / 图标按钮 22×22 | **44 / 44×44** |
| 搜索框 | 28.8px 高 / 13px 字号 | **44px / 16px** |
| 下拉 | 28px | **44px** |
| 自定义 `role=button` 行 | 约 20px | **≥44px** |
| 面板左右缘 | 0…390 | 0…390（不变） |

- **不勾 `width-reclaim`**：面板在 390 下右缘 = 390、`documentElement.scrollWidth = innerWidth`，没有要修的横向溢出（规则 6 只是防止本包自己把按钮组撑宽）。
- **不勾 `floater-clearance`/%其它**：浮动控件与轨道让位属于外壳职责；本面板内没有贴底 fixed 控件。
- **热量格子（`role="gridcell"`）不抬到 44px**：它们是数据单元而非控件，撑大只会把热力图毁掉。

## 4. 不修的东西（诚实边界）

- **hover-only 提示**：`role="tooltip"` / `data-lc-tip` 在触屏**没有点击入口**，CSS 造不出触发方式。本包只保证它显示时不溢出；真正的触达需要上游加 tap/长按触发（`docs/首批高星适配清单.md` §4.3 的上游建议）。
- **composer overlay（ContextModal）与右栏 tab**：不在 `[data-slot="main"]`，本包的 hit-target 断言也量不到；要做需要新的证据口径。
- **不改字体与颜色**：除输入框 16px 外不调整排版。

## 5. 验收

```bash
node tools/check-pack.mjs packs/dsh-context-mobile
node tools/check-pack.mjs packs/dsh-context-mobile --desktop
npm run check
```

2026-11-02 本仓库实测：单包 `RESULT PASS（42 passed · 0 failed · 1 skipped）`；全仓 `check-pack · 6 pack(s) · 194 passed · 0 failed · 11 skipped`。skip 是 host-probe 里的「本包不使用 `data-dshm-adapt-panel`」——门阀退让本身仍然通过。

## 6. 参考

- 候选评估与另外两个候选的可验证性： [`docs/候选包-20261102.md`](../../docs/候选包-20261102.md)
- 定向 fixture 契约： [`docs/定向-fixture.md`](../../docs/定向-fixture.md)
- 收录标准： [`docs/收录标准.md`](../../docs/收录标准.md)
