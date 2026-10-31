# shell-chrome — 外壳自身的触控下限

`shell-chrome` 管的是 **dsh-mobile 外壳自己**的按钮，不是插件面板：

| 位置 | 为什么归外壳 | fixture 基线 | 装包后 | **真实 0.7.1 实测** |
|---|---|---|---|---|
| 面板顶部「返回会话」栏 | 外壳渲染的 `.dshm-panelNav`，插件碰不到 | 25px | **44px** | 48px → **48px**（本规则是兜底，不改数值） |
| 抽屉展开后的侧栏行 | `[data-slot="sidebar"]` 里的按钮 / 链接 | 28px | **44px** | 36px → **44px** |

最后两列放在一起看：fixture 复刻的是「桌面优先的外壳」，而 0.7.1 的真实外壳已经把返回栏
按钮做到了 48px —— 于是这条规则在 0.7.1 上是**兜底**（44 < 48，不会缩小任何东西），
真正生效的是抽屉行（36 → 44）。它不是白写的：换 build 或换标记后返回栏可能回到 25–36px，
那时这条才顶上。别把它当「已经修好了 0.7.1 返回栏」。

## 为什么和 `core-panel` 分开

`core-panel` 只在**插件面板打开时**生效（靠 `data-dsh-panel="1"`）。但返回栏和抽屉在
「没打开任何插件面板」时也在屏幕上，用户照样要按。把它们塞进 `core-panel` 会让那张包
在面板关闭时失效，而这两处恰恰是常驻的。

分开的另一个好处是风险可分：`core-panel` 想关就关，不影响外壳；`shell-chrome` 想关也不
影响插件面板。

## 生效条件

- **粗指针**（`(pointer: coarse)`）—— 桌面与触控板设备完全不受影响；
- 抽屉那条还要求 `[data-open="true"]`：折叠态的 56px 是图标轨，不是可点的行，不动它；
- 1280×800 精指针下逐项零改动（`check-pack` 断言）。

## opt-out

外壳级的关闭开关写在**文档根**上：

```html
<html data-dsh-adapt="off">
```

整页两份规则一起失效，返回栏回到 25px、抽屉行回到 28px。注意这不同于 `core-panel` 的
面板块开关：这里管的就是外壳本身，「只有某块面板例外」没有意义。

## 代价

- **`!important` 会压过外壳自己的紧凑设计**。这是宿主下限的代价，和 dsh-mobile 自己对
  输入框字号的 `!important` 同源。
- 抽屉行只抬 `min-height`，不加 `min-width`：长标题本来就撑满整行，逼成方形只会更丑。
- 只覆盖 `.dshm-panelNav` 与**展开态**抽屉；右侧详情面板、弹层（`[role="dialog"]`）
  都不在本包范围 —— 后者是 DSH 自己的设置页，强行撑大会把开关变成大方块
  （2026-10-30 真机反馈：把设置页的开关撑成大方块）。

## 回滚

```bash
node tools/install.mjs --uninstall shell-chrome --yes   # 移走目录，2 秒生效
```

## 证据

```bash
node tools/check-pack.mjs packs/shell-chrome          # 22 passed / 0 failed / 5 skipped
node tools/check-pack.mjs packs/shell-chrome --desktop
```

跳过的是 5 条面板断言：`catalog.json` 里本包只声明 `shell-hit-target`，没有声明
`hit-target` / `rail-clearance` / `width-reclaim`，`check-pack` 按声明逐组判定。

数值来自 `tools/check-pack.mjs` 的 fixture（复刻外壳 DOM）。真实运行时与真机验证见
根 README 的「当前状态」。

## 真实运行时取证（dsh-mobile 0.7.1，2026-10-31）

在 dsh-mobile 0.7.1 网关上用 390×844 粗指针加载真实页面（装进 `extensions/`，宿主 2s 轮询注入）：

| 观察项 | 结果 |
|---|---|
| 注入 | `style[data-dsh-mobile-extension-style]` = `core-panel` + `shell-chrome` |
| 抽屉行（展开） | 36px → **44px**；`<html data-dsh-adapt="off">` 后回到 36px |
| 返回栏（打开插件面板后） | 48px；opt-out 后 **48px**（本来就是 48，见上表说明） |
| 面板状态 | `data-dsh-panel` 仍由 `core-panel` 维护（本包不写它） |

0.8.0 只做了文本层核对（`.dshm-panelNav` / `.dshm-drawer` / `[data-slot="sidebar"]` 仍在），
没有在该版本上跑过；真机指纹级验证仍未做。
