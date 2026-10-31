# Linux 上的「手机实例」

2026-10-30 · 给迭代调试用：在一台 Linux 机器上把**真实移动页**跑起来，390×844 粗指针，10 秒一轮，不碰手机。

## 它是什么

`tools/phone-instance.mjs` 用 Playwright 起一个无头 Chromium，走 dsh-mobile 的**真实网关**（地址由 `GET /api/mobile-access/status` 的 `gateway.origin` 给出，通常是 `https://<本机 LAN IP>:3443`），加载的就是手机会加载的那份页面：同一个 boot graph、同一个 `mobile-layout.js`、同一个扩展运行时。不是 fixture。

```
node tools/phone-instance.mjs                                   # 打开 + 截图
node tools/phone-instance.mjs --inject packs/core-panel         # 把包注入真实页（不安装）
node tools/phone-instance.mjs --inject packs/core-panel --measure
node tools/phone-instance.mjs --fresh                           # 丢掉缓存的设备身份，重新配对
```

产物落在 `.cache/`（已 gitignore）：`phone-state.json`（设备凭据）、`shots/*.png`。

## 两种迭代方式

| | `--inject` | 装进 `extensions/` |
|---|---|---|
| 生效路径 | 直接 `addStyleTag` + 跑 `mobile.js` | 宿主 2s 轮询加载 |
| 验证的是 | 规则在真实 DOM 上的效果 | 规则 + 扩展契约 + 宿主注入 |
| 写不写 `$DSH_HOME` | 不写 | 写 |
| 用途 | 改规则时的秒级反馈 | 交付前的最终确认 |

两者都要跑一次才算完整：`--inject` 证明规则对，装进 `extensions/` 证明接线对。

## 一次性配对（工具自动做）

1. `POST http://127.0.0.1:3080/api/mobile-access/pairing/open`（loopback 管理 API，带
   `Origin` + `x-dsh-mobile-web-admin: same-origin-json`）开一个一次性配对窗口；
2. 用和手机相同的表单把 token 换成设备 cookie（`dsh_ma_*` / `__Host-dsh_ma_*`）；
3. 给**这台合成设备**写设备级模块选择 `{excludedClientModules: []}`；
4. 保存 `storageState`，之后直接复用。

**不会**改电脑默认设置、不会重启 dsh-mobile、不会动真实手机。唯一持久变化是 `devices.json`
里多一条 `linux-headless` 设备记录，可以在电脑端「移动访问 → 设备」里撤销。

## 三个坑（都踩过）

### 1. 新设备会撞上「移动页面模块需要调整」

`cordis.patch.yml` 的 `excludedClientModules` 里曾有一条 `dsh-memory`（插件早已移除），
任何**新设备**继承电脑默认就会启动失败，落在恢复页。2026-10-30 已从配置里删掉；但配置改动要等
下一次 DSH 重启/重载才生效，所以脚本仍会给合成设备写一次设备级 `[]` 覆盖。

真机一直没事，是因为它有自己的设备级覆盖——这也是为什么这个坑只在「新设备」上暴露。

### 2. 页面底部的调试 HUD

如果你在截图里看到 `适配…` 这类调试 HUD，那是某个本地补丁注入的标记 —— 先确认 `dsh-mobile/lib/mobile-layout.js` 是否被改过（本仓库的包不会写宿主文件）。

### 3. `env(safe-area-inset-*)` 在 Chromium 里是 0

安全区、软键盘、惯性滚动这三样无头浏览器给不了，真机才能验。工具报告里也要这样写。

## 它不能替代什么

- **真机手感**：拇指精度、点击热区主观感受；
- **WebView 差异**：Android 系统 WebView 的选择器/缓存行为与 Chromium 不完全一致；
- **软键盘与安全区**：`env()` 值为 0，`visualViewport` 不会像真机那样收缩。

## 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `mobile access gateway is not running` | 局域网访问没开 | 电脑端「移动访问 → 局域网」开启 |
| 落在配对页反复循环 | cookie 过期/设备被撤销 | `--fresh` 重新配对 |
| `dedicated=null shell=false` | 模块选择失效（见坑 1）或 TLS 没信任 | 看 `.cache/shots/` 截图与控制台错误 |
| 截图是白屏但 shell=true | 主题/字体还没加载完 | 等 2–4 秒或加 `--measure` 看盒模型 |
