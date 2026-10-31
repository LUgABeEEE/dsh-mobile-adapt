# dsh-adapt-packs

**Opt-in adaptation packs for the DSH mobile surface.**

Third-party plugin panels on a phone have three problems a plugin cannot fix from inside its own component: touch targets a thumb cannot hit, a panel root wider than the phone's content box, and rows hidden underneath a floating widget. This repository is a small registry of fixes for exactly those, delivered as packs that `dsh-mobile` loads through its public `extensions/` directory — plus a [compatibility list](compat.json) recording, per third-party plugin, whether it is usable on a phone as shipped, needs one of these packs, should be fixed upstream, or cannot be fixed from outside at all.

Nothing here forks or patches an installed DSH or dsh-mobile. A pack is a directory:

```
$DSH_HOME/mobile-access/extensions/<id>/
├── extension.json      # schemaVersion, id, name, version, description — exactly these five
├── mobile.css          # injected by the host
├── mobile.js           # optional; window.dshMobile.define({ apiVersion: 1, id, activate })
└── README.md           # ignored at runtime
```

Copy it in and the host picks it up within two seconds; move it out and it is gone. No restart, no configuration file, no second auth model.

## The packs

| pack | scope | what it does |
| --- | --- | --- |
| [`core-panel`](packs/core-panel/) | plugin panels | 44px hit floor inside a panel — the only source on 0.8.x, and a fallback that backs off once the host ships its own floor (#319); icon-only button width; width reclaim |
| [`shell-chrome`](packs/shell-chrome/) | the shell itself | the open drawer's sidebar rows (36 → 44px); the "back to conversation" bar becomes a rise-only floor that never shrinks the host's own 48px |
| [`floaters`](packs/floaters/) | floating widgets | measures bottom-right fixed widgets, reserves their height, so the last rows stop hiding underneath |
| [`dshmarket-mobile`](packs/dshmarket-mobile/) | the plugin market panel | a 44px touch floor for `dshmarket` 1.73.x: buttons, icon buttons and the search field, scoped to `[data-dsh-market-root]` |

Every pack is **experimental** and **off by default**. `catalog.json` records, per pack, what has actually been verified and what has not — the `evidence` field is meant to be read before trusting one.

## The compatibility list

Not every plugin can be fixed from the outside — and "this one is fine on a phone" is worth writing down too. [`compat.json`](compat.json) records one verdict per third-party plugin:

```bash
dsh-adapt-packs compat                  # the whole list
dsh-adapt-packs compat --verdict pack    # only entries this repository has a pack for
```

| verdict | meaning |
| --- | --- |
| `native` | usable on a phone as shipped |
| `pack` | this repository has a pack for it (`pack` names it) |
| `upstream` | fixable, but only by the plugin author |
| `blocked` | not fixable from outside (canvas, native widgets, no reachable DOM) |

Every entry carries the version it was judged on, what the phone actually does (numbers where possible) and how strong the evidence is — measured, code-read, or not verified. Format and rules: [`docs/兼容清单.md`](docs/兼容清单.md). To suggest an entry, open the [compat suggestion](https://github.com/LUgABeEEE/dsh-adapt-packs/issues/new?template=compat-suggestion.yml) issue and bring numbers rather than adjectives.

`dsh-adapt-packs status` answers the other question — which packs this machine has installed, which are disabled, and which are in the catalog but not installed.

## Install

### From npm

```bash
npm install -g dsh-adapt-packs

dsh-adapt-packs list                          # what is in the catalog
dsh-adapt-packs install core-panel --dry-run  # plan only
dsh-adapt-packs install core-panel --yes      # write into $DSH_HOME
dsh-adapt-packs uninstall core-panel --yes    # move it out (reversible)
```

The published tarball carries `packs/`, `catalog.json`, `docs/` and the tooling,
including the evidence screenshots under `packs/<id>/shots/` (tarball ≈ 700 KB).
`dsh-adapt-packs check` runs the same harness as the repository.

### From a checkout

```bash
node tools/check-pack.mjs                     # validate every pack first
node tools/install.mjs pack core-panel --dry-run
node tools/install.mjs pack core-panel --yes
node tools/install.mjs --uninstall core-panel --yes
```

`install.mjs` defaults to a dry run, resolves `$DSH_HOME` (or `~/.dsh`), refuses to overwrite an existing pack, and moves an uninstalled pack to `mobile-access-adapt-disabled/` so it can be restored.

## Windows

`tools/` are plain Node scripts (Node 20+); nothing here assumes a POSIX shell, `/tmp`, or case-sensitive paths, and the commands work unchanged in PowerShell. The fixture checker needs Playwright and its Chromium build:

```powershell
npm install --no-save --no-package-lock playwright
npx playwright install chromium      # downloads into %LOCALAPPDATA%\ms-playwright
```

`check-pack.mjs` resolves Playwright in this order and lists every path it tried when it fails: `DSH_PLAYWRIGHT` (a `playwright/index.js` file **or** the `playwright` package directory) → `$DSH_HOME/profiles/{web,desktop,headless}/node_modules/playwright` → this repository's own `node_modules` → normal module resolution. A missing Chromium produces a message that points at `npx playwright install chromium` and at the expected browser cache (`%LOCALAPPDATA%\ms-playwright` on Windows).

Set the home directory with PowerShell syntax — the POSIX `export` form does not apply:

```powershell
$env:DSH_HOME = 'C:\Users\you\.dsh'   # default when unset: %USERPROFILE%\.dsh
```

`install.mjs` derives `mobile-access\extensions\<id>` from it and moves an uninstalled pack to `mobile-access-adapt-disabled\<id>`. Paths with a leading `~` are expanded, and `\` and `/` are both accepted where a pack path is expected. Existing pack directories are resolved case-insensitively (`PACKS\CORE-PANEL` is `packs/core-panel`), while pack ids and `catalog.json` lookups stay lowercase. CRLF checkouts are supported: the `windows-latest` job in CI runs the whole fixture suite from a CRLF working tree on every push/PR.

One path is not exercised by a normal install: the EXDEV fallback in `install.mjs` (copy + delete instead of `rename`). Install source and target both live under the same `$DSH_HOME`, so a plain rename is what actually runs; the fallback stays for unusually mounted homes and is documented rather than claimed as tested.

## Targeted fixtures

The built-in fixture measures a generic, deliberately desktop-first plugin panel. A pack aimed at one specific plugin can ship `packs/<id>/fixture.html` with that plugin's own DOM; `check-pack` then runs every round (baseline, pack, opt-out, desktop zero-regression) against it instead. Without the file the built-in fixture is used and the report says which one ran — human output prints `fixture：内置（回退内置 fixture）` and `--json` carries `fixture.kind`.

```bash
node tools/check-pack.mjs docs/examples/fixture-pack --desktop   # runnable example
```

The contract — allowed markup (DOM + inline styles only, no scripts/event handlers/external or `data:` references, ≤ 256 KB), the required shell/panel hooks, how `target` / `usesHostMarkers` / `evidence` must describe the fixture — is in [`docs/定向-fixture.md`](docs/定向-fixture.md). `docs/examples/fixture-pack/` is a runnable example, not a real pack: it lives outside `packs/`, is not in `catalog.json`, and therefore reports one harmless catalog warning.

## Opt out

```html
<html data-dsh-adapt="off">
```

Each pack stops applying entirely — panel spacing returns to its own values, shell rows return to the shell's sizes. This is checked by the harness, not asserted in prose.

## What has been verified

| | state |
| --- | --- |
| Fixture measurement: 390×844 coarse pointer, 1280×800 fine pointer zero-regression, opt-out | ✅ every pack (`node tools/check-pack.mjs`) |
| Fixture measurement on Windows 11 + Chromium (`node tools/check-pack.mjs --desktop`) | ✅ every pack: 87 passed / 0 failed / 8 skipped (2026-10-31); the same suite runs in CI on `windows-latest` |
| Real runtime on **dsh-mobile 0.8.0** | ✅ measured on the real gateway (390×844, coarse pointer, Plugins panel) — see `实测-0.8.0-20261031.md` in the workspace |
| Real runtime on **main after #319** | ❌ no build contains it yet (v0.8.1 does not exist); merge diff + a `check-pack` host-probe only |
| Real runtime on **0.7.1** | ✅ historically (2026-10-31 earlier run); its numbers matched 0.8.0 |
| Physical device | ❌ never — no thumb, no soft keyboard, no real `env(safe-area-inset-*)` |

### Two release lines: 0.8.0 vs main (#319)

`dsh-mobile` merged #319 on 2026-10-31 (`6c50b13`), **after** v0.8.0 was published (2026-10-30). No release contains it yet:

| | release 0.8.0 | main after #319 |
| --- | --- | --- |
| host writes `data-dsh-panel` | **no** (grep: 0 hits) | yes, on `.dshm-main` |
| 44px hit floor for plugin panel controls | **no** (94/94 controls < 44px measured) | yes, host-provided |
| panel root width clamp | no | yes |
| icon-only button `min-width` | no | **no** |
| bottom safe area on panel pages | no | **no** |

`core-panel` therefore gates its height floor and width clamp on `.dshm-main:not([data-dsh-panel])`: on 0.8.x it is the only source, and on a host that owns that attribute it steps aside instead of duplicating (and never writes the host's attribute — it keeps its own `data-dshm-adapt-panel`). `check-pack` proves the gate with a simulated host-owned attribute (`runtime.hostGate.*`).

That is why the packs stay `experimental` rather than `candidate`. Measuring is a separate problem, and there is a tool for it: [`dsh-ui-lab`](https://github.com/LUgABeEEE/dsh-ui-lab) opens a DSH surface at real device proportions, captures a panel, and gates a matrix run on a pixel diff.

## The dependency this cannot escape

These packs name dsh-mobile's own class names — `.dshm-shell`, `.dshm-main`, `.dshm-mainContent`, `.dshm-drawer`, `.dshm-panelNav`, `[data-slot="sidebar"]`. dsh-mobile does not promise to keep them, and its documentation explicitly rules out maintaining a general override table keyed on third-party class names. `catalog.json` lists the markers each pack touches (the `usesHostMarkers` field) precisely so a break is traceable to a pack, but a redesign can still break them.

The durable fix is a contract on the host side: stable attributes for panel state, for a plugin's own chrome, and for opting out. Until that exists, this repository is a compatibility layer that is expected to need maintenance — not something the dsh-mobile maintainers ship or support.

## Contributing

A new pack starts from [`packs/_template/`](packs/_template/) and has to pass `node tools/check-pack.mjs packs/<id>`. The rules — which capabilities may be claimed, how a pack must be scoped, what opt-out means, what a pack may not touch — are in [`docs/收录标准.md`](docs/收录标准.md) (Chinese; the check harness is the executable version of it).

[`docs/phone-instance.md`](docs/phone-instance.md) describes how to drive the real mobile page headlessly, which is how a pack gets verified beyond the fixture.

## Releasing

Push a tag that matches `package.json` and [`.github/workflows/publish.yml`](.github/workflows/publish.yml)
validates the catalog, then publishes with npm provenance.

```bash
npm version patch --no-git-tag-version
git commit -am "chore: 0.1.1"
git tag v0.1.1 && git push origin main v0.1.1
```

The job needs the repository secret `NPM_TOKEN` (a granular token with "Read and
write" publish permission for `dsh-adapt-packs`). `workflow_dispatch` defaults to
`npm publish --dry-run`.

## License

MIT — see [LICENSE](LICENSE).
