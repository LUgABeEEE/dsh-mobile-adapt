# 定向 fixture（`packs/<id>/fixture.html`）

> 这份契约单独成文，**不占用 [`docs/收录标准.md`](收录标准.md) 的章节号**，避免与其它同时改收录标准的 PR 产生编号重复与合并冲突。收录标准 §2 的文件白名单与 §8 的自查项都指向本文。
>
> 状态：草案（2026-10-31）。可执行版本是 `tools/check-pack.mjs`（`inspectFixture` / `inspectFixtureInBrowser`）。

默认的内置 fixture 覆盖“第三方插件面板在手机上的一般失败模式”，但它只有一局面板：定向到某个具体插件的 pack 如果只在这局 fixture 上跑，pack 的 CSS 没有目标元素、运行时断言只能空转，实际是“假验证”。因此：

- **存在 `packs/<id>/fixture.html` 时**，`check-pack` 用它替代内置 fixture，并用于全部四轮测量：移动基线 / 装包 / opt-out / 桌面零回归。
- **不存在时**回退内置 fixture，并在报告里标注：人类可读输出打印 `fixture：内置（未提供 packs/<id>/fixture.html，回退内置 fixture）`；`--json` 的每个 pack 带 `fixture: { kind: "builtin" | "custom", path, bytes }`。静默回退是不允许的——evidence 必须按 §3 写清用的是哪种 fixture。
- `fixture.html` 不参与运行时：它只是校验输入。`install.mjs` 会把它随包复制进 `$DSH_HOME/mobile-access/extensions/<id>/`，宿主会忽略它（运行时只读 `extension.json` / `mobile.css` / `mobile.js` / `host.mjs` / `assets/`）。

## 1. 文件契约（静态层）

| 项 | 规则 |
|---|---|
| 位置/名字 | 只认 `packs/<id>/fixture.html`（与包目录同级，不嵌套） |
| 体积 | ≤ **256 KB**；**空文件或超限直接失败**，并且该 fixture 不再被加载（浏览器解析与运行时层都会 SKIP） |
| 形式 | 完整 HTML 文档：`<html>` / `</html>` / `<body>` / `</body>` 齐全，UTF-8；只允许 DOM 与内联 `<style>` |
| 禁止脚本 | 不得出现 `<script>` / `<iframe>` / `<object>` / `<embed>`；不得出现内联事件处理属性 `on…=`（如 `onload=`、`onerror=`）；不得出现 `javascript:` URL。check-pack 自己负责注入 pack 的 `mobile.js`，fixture 里放这些等于绕过激活 shim（一个 `<svg onload=…>` 就足以执行代码） |
| 禁止外链/内联数据 | 不得出现 `src=` / `href=` / `srcset=` / `poster=` / `action=` / `formaction=` / `srcdoc=` / `http-equiv=` / `xlink:href=` 属性，也不得出现 `@import` / `url()` / `http(s)://` / `data:` 引用（大小写不敏感，允许属性名与 `=` 之间有空格）；fixture 必须自包含，不得加载网络资源或内联数据 URL（`http-equiv` 一并禁止，避免 meta refresh 跳转/联网） |
| 可解析 | 通过上述检查后，check-pack 在**离线**浏览器里 `setContent` 一次并断言 HTML 文档建立成功；**任何静态检查不通过（含体积超限/空文件）时，浏览器解析与运行时层都会 SKIP**（不加载可疑内容、不执行 pack 脚本） |
| 隐私 | **不得包含真实会话内容、凭据、token、cookie、真实用户名、内网地址**；fixture 会进仓库并被所有人看到 |
| 解析钩子 | 浮动控件需带 `[data-fixture="floater"]`（内置 fixture 用 `.float-widget`，二者等价）；面板根是 `[data-slot="main"] > *` |

## 2. DOM 最小契约（运行时）

fixture 要复刻 dsh-mobile 的外壳骨架，并包含被断言能力需要的元素：

- 必须有 `.dshm-shell`、`.dshm-main`、`.dshm-mainContent`，且 `[data-slot="main"]` 下**恰好一个**面板根。
- 面板内必须有可测控件：`button` / `[role="button"]` / `select` / `input` / `textarea`；声明 `hit-target` 时至少一个按钮 + 一个输入类控件。
- 声明 `shell-hit-target` 时：需要 `.dshm-panelNav` 内的按钮，以及 `.dshm-drawer[data-open="true"] [data-slot="sidebar"]` 内的按钮（check-pack 会展开抽屉做第二次测量）。
- 声明 `floater-clearance` 时：需要 `[data-fixture="floater"]` 的 fixed、贴右下角元素。
- 基线应保持“未适配”：`hit-target` 控件 < 44px、面板左缘 0、外壳按钮 < 44px。`runtime.mobile.applied` 会拒绝“什么都没改变”的 pack；`runtime.optOut` 会拒绝“opt-out 后数值没有回落”的 pack。
- **opt-out 由 check-pack 应用**：opt-out 轮会给 `<html>` 与面板根加 `data-dsh-adapt="off"`，fixture 不需要（也不应该）自己写这个属性。

## 3. `target` / markers / evidence

- `catalog.json` 的 `target` 仍必须写清目标插件（包名 + 版本范围），`usesHostMarkers` 列全 fixture 复刻的 `.dshm-*` / `[data-slot]` 标记——fixture 是这些标记的可执行记录。
- `evidence` 必须区分两种通过：使用定向 fixture 的写 `check-pack（定向 fixture：packs/<id>/fixture.html）…`；用内置 fixture 的写 `check-pack（内置 fixture）…`。不得把定向 fixture 的结果写成通用 fixture 的结果。
- 定向 fixture 不替代真机/真实网关验证：真机手感、`env(safe-area-inset-*)`、软键盘的结论继续按原口径标注。

## 4. 示例

`docs/examples/fixture-pack/` 是一个可运行的最小样例（**不收录、不在 `packs/` 下**，默认扫描不会包含它），覆盖 `hit-target` / `rail-clearance` / `width-reclaim` / `shell-hit-target` / `floater-clearance` 五组断言：

```bash
node tools/check-pack.mjs docs/examples/fixture-pack --desktop
# RESULT PASS（43 passed · 0 failed · 1 warning：catalog 里没有这个示例条目，WARN 不失败）
```

把它的 `fixture.html` 临时移走再跑：报告会打印“回退内置 fixture”，浮动控件相关断言会失败——说明缺了定向 fixture 不会伪装通过。把 `<svg onload=…>`、`srcset="data:…"`、`action=`、`poster="//…"` 或 `<script>` 塞进 fixture：静态层直接 FAIL，且浏览器解析与运行时层被跳过（不会执行这些内容）。
