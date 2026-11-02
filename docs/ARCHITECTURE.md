# Architecture: which side owns what

The deployment is **two repositories, one product**:

```
dsh-mobile (host)                 +   dsh-adapt-packs (this package)
  mobile-access/extensions/            packs/, catalog.json, compat.json
  extension runtime + contract         installer, panel UI, CLI, bundle
```

Neither repository embeds the other. The host exposes an extension directory and the runtime that
loads it; this package decides *what* a phone should adapt and writes directories into that
directory. Quick-install is a one-directional bridge: this package → host extension directory.

## The host owns (`saya-ch/dsh-mobile`)

| Item | Why it belongs there |
| --- | --- |
| `$DSH_HOME/mobile-access/extensions/` runtime: directory scan, 2s reload, size limits, manifest validation, `mobile.css` / `mobile.js` injection, `window.dshMobile.define()` | Only the host can load or unload an extension |
| Host-only capabilities: boot-graph rewrite, `data-dsh-panel`, 44px coarse-pointer floor for plugin panels (#319, first release 0.8.1), `text-size-adjust`, drawer/shell geometry, safe-area handling | A pack cannot supply these from inside a component |
| The **contract documents**: manifest fields, lifecycle, opt-out convention, what a pack may rely on | It is the interface, not adaptation content |
| **Never in the host:** packs, `catalog.json`, compatibility verdicts, install UI for packs, per-plugin class names | Everything that names a third-party plugin is adaptation knowledge, and it changes far faster than the host release cadence |

A change here is only justified when it is a **new general capability or a contract** — for example
"plugin panels get a stable `data-dsh-chrome` attribute" — never a fix for one plugin's layout.
That kind of PR is an interface PR; it may be sent upstream. Adaptation content is not.

## This package owns (`LUgABeEEE/dsh-adapt-packs`)

| Item | Why it belongs there |
| --- | --- |
| `packs/<id>/` — every adaptation rule, including per-plugin class names and opt-out | They are experiments; they change per plugin version and must be revocable |
| `catalog.json`, `compat.json`, shortlists, evidence, screenshots | The verdict "usable / needs a pack / should be fixed upstream" is ours to make and revise |
| `tools/install.mjs`, `tools/check-pack.mjs`, `tools/bundle.mjs`, `phone-instance.mjs`, the DSH settings panel (`lib/`) | Quick-install, verification and one-click UI; they all write into the host's extension directory and need no host change |
| `build/dsh-ui-optimizer/` — the single-plugin bundle | The unit of installation when the whole set is wanted; `packs/` stays the unit of development |
| Docs for pack authors and verification records | They describe our packs, not the host |

This package may rely **only** on the host contract listed above. Where the contract changed
between releases, the pack states it (for example `core-panel`'s rules are gated on
`.dshm-main:not([data-dsh-panel])`, so the pack backs off on 0.8.1+ and still works on 0.8.0).
Nothing here patches installed host files.

## The quick-install bridge

All three entry points install the same way, by writing one directory:

```bash
dsh-adapt-packs install core-panel --yes              # CLI (npm package)
node tools/install.mjs plugin build/dsh-ui-optimizer --yes   # bundle from a checkout
# Settings → 插件适配 → 安装                        # the panel, same lib/store.mjs
```

- destination: `<DSH_HOME>/mobile-access/extensions/<id>/`
- uninstall: move to `<DSH_HOME>/mobile-access-adapt-disabled/<id>/` (reversible)
- no network access from the host to this repository, no pack content copied into the host source
- the host discovers the directory within two seconds; no restart and no host configuration file

The panel exposes exactly `/api/adapt-packs/{state,install,uninstall}` and uses the same store, so
the UI, the CLI and the filesystem cannot disagree.

## Change policy

1. **Pack, catalog, compat verdict, panel, tooling** → this repository only. No PR to `dsh-mobile`.
2. **Host capability or stable contract** → PR to `dsh-mobile`, limited to the interface and its
   documentation, carrying no pack and no third-party plugin name.
3. **A host fix that is really a pack's job** → keep it here; if it cannot be fixed from a pack,
   record the limitation in the pack's `evidence` instead of patching the host.
4. **Host upgrades** are a separate operation from installing packs; a pack never requires a host
   upgrade it did not declare.

## Verified boundary

- Host `0.8.1` ships the coarse-pointer 44px panel floor (`#319`); `0.8.0` does not. Packs must
  keep working on both — `core-panel` gates on the host's own state attribute instead of version
  numbers.
- Host `0.8.0` has no `dsh.compatibility` field; a pack's tested range lives in its own `catalog.json`
  entry (`verifiedWith`), not in the host manifest.
- The extension runtime is the only integration point; there is no private API between the two
  repositories.
