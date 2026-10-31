# fixture-pack（示例，不收录）

这个目录**不是**一张要收录的适配包，而是 `packs/<id>/fixture.html`（定向 fixture）能力的
可运行样例。它同时覆盖 `hit-target` / `width-reclaim` / `shell-hit-target` /
`floater-clearance` 四组断言（`rail-clearance` 已于 2026-10-31 退役），用来证明：
定向到具体第三方插件时，pack 可以在自己的 DOM 上跑完整的运行时校验，而不是只在通用
fixture 上过静态层。它把自己的面板状态写成 `data-dshm-example-panel`——宿主的
`data-dsh-panel` 只读不写。

```bash
node tools/check-pack.mjs docs/examples/fixture-pack --desktop
```

预期结果：`RESULT PASS`，外加一条 `WARN catalog.json 里没有 fixture-pack 的条目`
（示例不登记收录表，WARN 不影响退出码）。它不是 `packs/` 下的目录，所以默认的
`node tools/check-pack.mjs`（校验 `packs/`）不会扫描到它。

把 `fixture.html` 临时移走后重跑，报告会打印 `fixture：内置（回退内置 fixture）`，
并且浮动控件相关断言会失败——这说明定向 fixture 不是装饰，缺了它就不能伪装通过。

契约与字段说明见 [`docs/定向-fixture.md`](../../定向-fixture.md)。
