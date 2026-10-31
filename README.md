# dsh-mobile-adapt

**Opt-in adaptation packs for the DSH mobile surface.**

Third-party plugin panels on a phone have three problems a plugin cannot fix from inside its own component: touch targets a thumb cannot hit, content crowded against the collapsed navigation rail, and rows hidden underneath a floating widget. This repository is a small registry of fixes for exactly those, delivered as packs that `dsh-mobile` loads through its public `extensions/` directory.

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
| [`core-panel`](packs/core-panel/) | plugin panels | 44px floor inside a panel (including icon-only buttons), width reclaim, clearance for the 56px collapsed rail |
| [`shell-chrome`](packs/shell-chrome/) | the shell itself | the panel's "back to conversation" bar and the open drawer's sidebar rows |
| [`floaters`](packs/floaters/) | floating widgets | measures bottom-right fixed widgets, reserves their height, so the last rows stop hiding underneath |

Every pack is **experimental** and **off by default**. `catalog.json` records, per pack, what has actually been verified and what has not — the `evidence` field is meant to be read before trusting one.

## Install

```bash
node tools/check-pack.mjs                     # validate every pack first
node tools/install.mjs pack core-panel --dry-run
node tools/install.mjs pack core-panel --yes
node tools/install.mjs --uninstall core-panel --yes
```

`install.mjs` defaults to a dry run, resolves `$DSH_HOME` (or `~/.dsh`), refuses to overwrite an existing pack, and moves an uninstalled pack to `mobile-access-adapt-disabled/` so it can be restored.

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
| Real runtime on **dsh-mobile 0.7.1** | ✅ measured on a real gateway |
| Real runtime on **0.8.0** | ❌ text-level check of `lib/mobile-layout.js` only |
| Physical device | ❌ never — no thumb, no soft keyboard, no real `env(safe-area-inset-*)` |

That is why the packs stay `experimental` rather than `candidate`. Measuring is a separate problem, and there is a tool for it: [`dsh-ui-lab`](https://github.com/LUgABeEEE/dsh-ui-lab) opens a DSH surface at real device proportions, captures a panel, and gates a matrix run on a pixel diff.

## The dependency this cannot escape

These packs name dsh-mobile's own class names — `.dshm-shell`, `.dshm-main`, `.dshm-mainContent`, `.dshm-drawer`, `.dshm-panelNav`, `[data-slot="sidebar"]`. dsh-mobile does not promise to keep them, and its documentation explicitly rules out maintaining a general override table keyed on third-party class names. `catalog.json` lists the markers each pack touches (the `usesHostMarkers` field) precisely so a break is traceable to a pack, but a redesign can still break them.

The durable fix is a contract on the host side: stable attributes for panel state, for a plugin's own chrome, and for opting out. Until that exists, this repository is a compatibility layer that is expected to need maintenance — not something the dsh-mobile maintainers ship or support.

## Contributing

A new pack starts from [`packs/_template/`](packs/_template/) and has to pass `node tools/check-pack.mjs packs/<id>`. The rules — which capabilities may be claimed, how a pack must be scoped, what opt-out means, what a pack may not touch — are in [`docs/收录标准.md`](docs/收录标准.md) (Chinese; the check harness is the executable version of it).

[`docs/phone-instance.md`](docs/phone-instance.md) describes how to drive the real mobile page headlessly, which is how a pack gets verified beyond the fixture.

## License

MIT — see [LICENSE](LICENSE).
