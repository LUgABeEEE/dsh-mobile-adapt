# shell-chrome — 外壳自身的触控下限

`shell-chrome` 管的是 **dsh-mobile 外壳自己**的按钮，不是插件面板：

| 位置 | 为什么归外壳 | fixture 基线 | 装包后 | **真实 0.8.0 实测** |
|---|---|---|---|---|
| 面板顶部「返回会话」栏 | 外壳渲染的 `.dshm-panelNav`，插件碰不到 | 25px | **44px** | 48px → **48px**（本规则改成 rise-only，不改变宿主更大的值） |
| 抽屉展开后的侧栏行 | `[data-slot="sidebar"]` 里的按钮 / 链接 | 28px | **44px** | 36px → **44px** |

最后两列放在一起看：fixture 复刻的是「桌面优先的外壳」，而 0.8.0 的真实外壳已经把返回栏
按钮做到了 48px —— 所以那条规则在 0.8.0 上**什么都不该改**；真正生效的是抽屉行（36 → 44）。

## 2026-10-31 收口：返回栏规则从 `!important` 改成 rise-only

旧规则是 `min-height:44px !important`。它在 0.8.0 上是**负收益**：宿主的
`.dshm-panelBack{min-width:48px;min-height:48px}`（`lib/mobile-layout.js:449`）本来给的是
48px，被这条 `!important` 压成 **48 → 44**，panelNav 高度 57 → 56（实测，见
`实测-0.8.0-20261031.md` §4.1）。`min-height` 是地板，但它会**替换**宿主自己的
`min-height`（宿主那条不是 `!important`）。

现在这条规则：

```css
:where(:root:not([data-dsh-adapt="off"]) .dshm-panelNav) :where(button, [role="button"]) {
  min-height: 44px;   /* 没有 !important */
  min-width: 44px;
}
```

选择器整体放进 `:where()`，特异性为 **0**，于是级联顺序变成：

| 宿主给的 | 结果 |
|---|---|
| `min-height:48px`（0.8.0 的真实情况） | 宿主特异性更高 → 48px 保留，**不压小** |
| 只有 `height:25px` 或没有任何高度规则 | `min-height:44px` 生效 → 抬到 44px（`height` 不能抵消 `min-height`） |

这不是「删掉兜底」，是「只在宿主没给更大值时兜底」。抽屉行仍然用 `!important`：宿主
0.8.0 没有给侧栏行任何触控下限，36px 是内容自然高度，44px 是唯一生效的抬升。

> 风险登记：如果未来宿主把**抽屉行**抬到 >44px，那条 `!important` 会和返回栏旧问题同型地
> 把它压小；届时需要把抽屉行也改成 rise-only（或退役）。目前 0.8.0 实测行高 36px，
> 这个风险只在宿主换几何时成立，不是当前行为。

## 为什么和 `core-panel` 分开

`core-panel` 只管插件面板**里面**的东西（它的状态属性是 `data-dshm-adapt-panel`）。返回栏和
抽屉在「没打开任何插件面板」时也在屏幕上，用户照样要按。把它们塞进 `core-panel` 会让那张包
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

整页规则一起失效，返回栏回到宿主自己的尺寸、抽屉行回到 28px。注意这不同于 `core-panel` 的
面板块开关：这里管的就是外壳本身，「只有某块面板例外」没有意义。

## 代价

- **抽屉行用 `!important`** 会压过外壳自己的紧凑设计。这是宿主下限的代价，和 dsh-mobile
  自己对输入框字号的 `!important` 同源；风险见上面的「风险登记」。
- 抽屉行只抬 `min-height`，不加 `min-width`：长标题本来就撑满整行，逼成方形只会更丑。
- 只覆盖 `.dshm-panelNav` 与**展开态**抽屉；右侧详情面板、弹层（`[role="dialog"]`）
  都不在本包范围 —— 后者是 DSH 自己的设置页，强行撑大会把开关变成大方块
  （2026-10-30 真机反馈）。

## 回滚

```bash
node tools/install.mjs --uninstall shell-chrome --yes   # 移走目录，2 秒生效
```

## 证据

```bash
node tools/check-pack.mjs packs/shell-chrome          # 22 passed / 0 failed / 4 skipped
node tools/check-pack.mjs packs/shell-chrome --desktop
```

跳过的是面板三组断言 + rail 组（已退役）：`catalog.json` 里本包只声明 `shell-hit-target`，
没有声明 `hit-target` / `width-reclaim`，`check-pack` 按声明逐组判定。

数值来自 `tools/check-pack.mjs` 的 fixture（复刻外壳 DOM）。真实运行时与真机验证见根 README
的「当前状态」。

## 真实运行时取证（dsh-mobile 0.8.0，2026-10-31）

在 dsh-mobile 0.8.0 的真实网关上用 390×844 粗指针加载真实页面（三个扩展装进 `extensions/`，
宿主 2s 轮询注入）：

| 观察项 | 结果 |
|---|---|
| 注入 | `style[data-dsh-mobile-extension-style]` = `core-panel` + `floaters` + `shell-chrome` |
| 抽屉行（展开） | 36px → **44px**；`<html data-dsh-adapt="off">` 后回到 36px |
| 返回栏（打开插件面板后） | 宿主 48px，**保持 48px**（旧规则会压成 44；rise-only 后不再改变） |
| 面板状态 | 由宿主/`core-panel` 各自的属性表达（本包不写任何面板状态） |

`main`（含 #319）只有 merge diff 依据：`#319` 只改插件面板（`[data-slot="main"]` 内控件与
面板根），没有动 `.dshm-panelNav` / `.dshm-drawer`，所以外壳两条规则预期不变【推断】。
含 #319 的发布版与真机指纹级验证仍未做。
