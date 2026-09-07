# G10 — Ship the extension: a real `.vsix`, DMG bundling, the Install button, and the palette audit

> **What this phase is.** The tenth phase of `docs/v1.3/SPEC.md`'s headless-git chapter, and the
> first one whose deliverable a *user* can install. Everything G1–G9 built has only ever run from
> `code --extensionDevelopmentPath=…` on a developer's machine. This phase turns it into an
> artifact: a real `.vsix`, carried inside the signed `.app`, installed by a button in Kira
> Studio's own *Connected editors* pane.
>
> **In one line: `vsce package` produces `apps/kira-studio/bin/kira-version.vsix`; `create:app:bundle`
> copies it to `Kira Studio.app/Contents/Resources/kira-version.vsix`; a new `internal/gitvsix`
> locates `code` through a `gitclient.Locator`-shaped probe order and spawns
> `code --install-extension <path> --force` argv-only, falling back to `open -R <path>`; the
> extension grows an SCM title-bar button, a status-bar item, and a palette command for every
> mutating operation, held in one table that a test cross-checks against both the manifest and Go's
> own `opTable`.**
>
> **One wire-contract change, flagged deliberately and not smuggled in.** `CONTRACT_VERSION` goes
> **16 → 17** for a single new host→webview event, `ui.action` (D9). The chapter's standing
> expectation is that packaging work does not touch the contract; this is the one place it does,
> the alternatives are written out in D9, and G10 is the cheapest possible moment for it — no
> `.vsix` has ever been installed by anyone, so no user is on the far side of the bump.
>
> **`packages/git-ui` is not redesigned.** Its delta is four `defineExpose` lines and one
> `bridge.on('ui.action', …)` dispatcher in `App.vue` that calls methods `OpsState` already has.
> Every palette command lands on an affordance the toolbar or a context menu already drives.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against `claude/feature-v1-3-headless-git` at `492ef6a5` ("docs: name internal/gitclient
among the darwin+cgo packages"), i.e. on top of everything G1–G9 landed. Every claim below was
checked by reading source or running a command **in this container**, not by trusting prose in an
earlier plan.

| Claim | Evidence |
|---|---|
| The extension manifest declares **four** commands and **no** `publisher`, `displayName`, `description`, `activationEvents`, `menus`, `icon`, `license`, `repository`, or `categories` | `apps/kira-studio-vscode/package.json` read in full |
| It does declare `engines.vscode: "^1.134.0"`, `extensionKind: ["workspace"]`, `main: "./dist/extension.js"`, `type: "module"`, `private: true`, `exports: {".": "./src/index.ts"}` | same file |
| `contributes.commands` today: `kiraVersion.showConnectionStatus`, `.openRepository`, `.focusGraph`, `.reviewBranch` | same file; matches G6 D15's own text |
| `activate()` registers exactly those four | `apps/kira-studio-vscode/src/extension.ts:195-202` |
| `scripts/build-vscode.ts` builds the webview (Vite) and the extension (`Bun.build`, `format:'esm'`) into `apps/kira-studio-vscode/dist/`, plus a `bun:`/`Bun.` purity check | `scripts/build-vscode.ts` read in full |
| It is wired into **nothing** — not `bun run build`, not `scripts/setup.sh` | root `package.json` `"build"` is `cd apps/kira-studio/frontend && bun run build`; `scripts/setup.sh` never mentions it; G3 D20 declined to wire it and made it a per-phase manual exit criterion instead |
| `bun run package` = `wails3 task darwin:package:dmg && sh ../../scripts/sign-bundle.sh`; `prepackage` = `bun run setup` | root `package.json` |
| The `.app` is assembled by `create:app:bundle`, which `rm -rf`s the bundle, creates `Contents/{MacOS,Resources}`, copies `icons.icns`, the binary and `Info.plist`, stamps the version with PlistBuddy, then ad-hoc signs | `apps/kira-studio/build/darwin/Taskfile.yml` |
| `create:app:bundle` is reached only from `darwin:package` and `darwin:package:universal`; `darwin:run` assembles its own `.dev.app` inline | same file |
| `APP_VERSION` comes from `build/config.yml`'s `info.version` (`"0.0.0"` today) and release.yml rewrites it from the git tag before packaging | `apps/kira-studio/Taskfile.yml` vars; `.github/workflows/release.yml:33-40` |
| `apps/kira-studio/bin/` is gitignored | `apps/kira-studio/.gitignore:2` |
| `apps/kira-studio-vscode/dist/` is gitignored (root `.gitignore:82` = `dist`) | `git check-ignore -v` |
| `internal/bridge/gitclients.go` has five methods (`List`, `Revoke`, `PendingPairing`, `Approve`, `Deny`), takes `Deps`/`Sock`/`Broker`, and declares its gitsock seams as local interfaces | file read in full |
| It is registered in `main.go:299`; `gitsock` is constructed at `main.go:131` | `apps/kira-studio/main.go` |
| The *Connected editors* pane is `SettingsDialog.vue`'s fifth section (`:98`), rendering `gitClientsState.clients` at `:582-610`, with G7's protected-branch/auto-fetch settings under it from `:612` | `apps/kira-studio/frontend/src/workbench/SettingsDialog.vue` |
| The renderer store is `frontend/src/state/gitClients.ts` (`hydrateGitClients()` fans `List`+`PendingPairing` in parallel), bound calls live in `frontend/src/bridge/index.ts:247-259`, wire types in `packages/shared/domain/git.ts` | those files |
| `tests/ui/support/mockRuntime.ts` maps the five `GitClientsService` methods (`:131-135`) and defaults `gitClientsList`/`gitPairingPending` (`:255-261`); there is **no** `tests/ui/` git spec | that file; `ls apps/kira-studio/tests/ui \| grep -i git` → empty |
| `gitrpc`'s method table is a 23-case switch plus one stream case | `internal/gitrpc/handlers.go:51-108` |
| `gitsession.opTable` serves **ten** of `OpRequest`'s nineteen kinds; the other nine answer `ErrUnservedOpKind` | `internal/gitsession/ops.go:94-141` (`checkout`, `branchCreate`, `branchDelete`, `branchRename`, `tagCreate`, `tagDelete`, `revert`, `opContinue`, `opAbort`, `opSkip`), `:63-71` |
| `remote.run` serves **all five** of its kinds | `internal/gitsession/remote.go:359-365` (`fetch`; `push`/`forcePush`/`deleteRemoteBranch`; `pull`), `:84`'s own comment |
| `tagPush`/`tagDeleteRemote` are still unserved, handed forward past G7 | `ops.go:64`'s comment; G7 plan `:1845`, `:1866` |
| `CONTRACT_VERSION = 16` (TS) and `gitrpc.ContractVersion = 16` (Go), and every one of G3/G4/G6/G7 bumped it | `packages/git-ipc/src/validate.ts:7`; `internal/gitrpc/contract.go:13`; `git log --follow` on validate.ts shows 12→13→14→15→16 |
| `EVENT_KEY_MAP` has five entries and is a `Record<EventKey, true>`, so a missing key is a compile error | `validate.ts:98-104`, `:45-58`'s own comment |
| `assertContractShape` rejects any event name not in that map — the extension→webview channel is gated by the contract exactly as the socket is | `validate.ts:145-160`; `rpc.ts`'s `wrapVersioned` on every frame |
| `OpsState` already exposes every mutating operation as a method (`runCheckout`, `runRevert`, `branchCreate/Delete/Rename`, `tagCreate/Delete`, `continueOp`, `abortOp`, `skipOp`, `undo`, `runFetch`, `runPull`, `runPush`, `runForcePush`, `cancelRemote`) | `packages/git-ui/src/state/ops.ts:286-1219` |
| `AppToolbar.vue` already `defineExpose`s `refresh` for exactly this reason ("one implementation, reached from two inputs") | `AppToolbar.vue:74-77` |
| `BranchPicker.vue` owns `isOpen`/`toggle` and nests `TagList.vue`, so one panel covers branch, remote-branch and tag rows | `BranchPicker.vue:36,71-73,309` |
| `PullStrategyPicker.vue` owns the pull button (`runDefault` → `ops.runPull`) | `PullStrategyPicker.vue:82,99` |
| `App.vue` owns `branchDialogState`/`tagDialogState`/`renameRefDialogState` and `selection.sha` | `App.vue:331-332,463,170` |
| The cold-resolve/live-view split is already solved once, for the review view: a JSON bootstrap island in `html.ts` plus a `review.target` event | `html.ts:72-102,135`; `reviewView.ts:32-86`; `webview/main.ts`'s `readBootstrap()`; `git-ui/src/main.ts`'s `MountOptions.target` |
| `html.ts` reads `dist/ui/.vite/manifest.json` **at runtime** to resolve the hashed webview asset names | `html.ts:51-59` |
| The repo already has a pinned-tool precedent that deliberately avoids `devDependencies` | `scripts/generate-wire.sh:1-8` (flatc into a gitignored `.tools/`, SHA-256 verified) |
| `gitclient` already establishes the "probe order, not just `LookPath`" pattern for finding a user binary, with a `Locator` seam and a `Probed []string` field on the miss | `internal/gitclient/discovery.go:41-90` |
| The "a result value, never an error" precedent for a user-facing action is `connections.Service.Reveal` / `apivars.Reveal`, and G1 D19 already applied it to this exact service | `internal/apivars/reveal.go:30-39`; `gitclients.go:24-27` |
| `verify-packaging.sh` runs static checks always and artifact checks only when the `.app`/`.dmg` exist, and never exits on the first failure | `scripts/verify-packaging.sh` read in full |

**Run in this container, for real:**

| Experiment | Result |
|---|---|
| `npm i @vscode/vsce` then `vsce package --no-dependencies` on a copy of the real extension directory | **exit 0**, a valid 31-file `.vsix`. `vsce` is 3.9.2, pure Node, no platform-specific packaging behaviour |
| the same, **without** `--no-dependencies` | **exit 1**: `npm list --production` fails `ELSPROBLEMS — missing: @kira/git-core@workspace:*` (and the other two). With `node_modules` present it fails differently (`invalid:`), never succeeds |
| the produced `extension.vsixmanifest` | `<Identity … Id="kira-studio-vscode" Version="0.0.0" **Publisher="undefined"**/>`, `<DisplayName>kira-studio-vscode</DisplayName>` |
| warnings printed | missing `repository`, missing `LICENSE`, missing `.vscodeignore`. None blocked the run non-interactively |
| after adding `publisher`/`displayName`/`description`/`license`/`categories`/`repository` and a two-line `.vscodeignore` | exit 0, 11 files, 188 KB, `Publisher="kirathecat"`, `DisplayName="Kira Version"`, only the LICENSE warning left |
| whether `dist/ui/.vite/manifest.json` survives packaging | **yes** — it is in the packaged tree; vsce does not blanket-ignore dot-directories under `dist` |
| `vsce` under **Bun** instead of Node (`bun node_modules/@vscode/vsce/vsce package …`) | exit 0, byte-comparable output |
| `bun add -d @vscode/vsce@3.9.2` in a scratch workspace | 280 packages, **120 MB**, 5.06 s, and **one blocked postinstall** (`@vscode/vsce-sign@2.1.0`) |
| `vsce package` from that bun-installed tree, postinstall still blocked | **exit 0** — signing is a publish-path concern; no `trustedDependencies` entry is needed |
| `Bun.build({format:'cjs', target:'node', external:['vscode']})` on `src/extension.ts` | success, 137 KB, emits `require("vscode")` and `exports.activate`, and contains neither `bun:` nor `Bun.` (so `build-vscode.ts`'s purity check still passes) |
| current workspace `node_modules` | 437 MB |

### 0.2 Scope

1. Make the extension manifest packageable and *identified*: `publisher`, `displayName`,
   `description`, `categories`, `license`, `repository`, `icon`, `activationEvents`, a `LICENSE`
   file, a `.vscodeignore` (§3.3, D2–D5).
2. Switch the extension bundle to CommonJS (`dist/extension.cjs`) — D6.
3. Add `@vscode/vsce` and a `scripts/package-vscode.ts` that builds both bundles then packages
   `apps/kira-studio/bin/kira-version.vsix` (§3.1, D1, D7).
4. Wire that into packaging: a `common:build:vsix` task, a copy step in `create:app:bundle` and in
   `darwin:run`, and a new `verify-packaging.sh` check (§3.1, D8).
5. `internal/gitvsix`: locate the bundled `.vsix`, locate `code`, spawn
   `code --install-extension <path> --force` or `open -R <path>` — argv-only, both behind seams
   (§3.2, D10–D13).
6. Two new bound methods on `GitClientsService`, their wire types, their renderer store fields,
   and the button in the *Connected editors* pane (§3.2, §3.5, D14).
7. The SCM title-bar button and the status-bar item (§3.3, D15, D16).
8. The command-palette audit: one table, seventeen new commands, one new contract event, and the
   test that keeps it honest (§3.3, §3.4, D9, D17–D20).
9. Docs, CI and the proof (§3.6, §6).

### 0.3 Not in this phase

- **Marketplace or OpenVSX publishing.** SPEC "Out of scope for v1.3" is explicit; DMG bundling is
  this chapter's answer. Nothing here logs in, signs for, or uploads to a gallery — which is also
  why `@vscode/vsce-sign`'s blocked postinstall stays blocked (F7).
- **Notarization or a Developer ID signature.** The bundle stays ad-hoc signed
  (`docs/PACKAGING.md` §7); a `.vsix` inside an ad-hoc-signed `.app` needs nothing extra.
- **Any redesign of `packages/git-ui`.** Four `defineExpose` lines, one dispatcher, one mount
  option. No new component, no native tree/quickpick replacement (SPEC "Out of scope").
- **Palette commands for operations that do not exist yet** — the nine unserved `op.run` kinds
  (five stash, reset, cherryPick, tagPush, tagDeleteRemote) and `search.run`. They get a *table
  entry* marked with the phase that owns them (D18), which is the whole enforcement mechanism, but
  no command and no manifest entry.
- **Branch/ahead-behind text in the status-bar item.** Declined with a stated reason (D16).
- **A second Kira Studio surface for git.** The button lives inside the pane G1 already built.
- **Editing `docs/v1.3/SPEC.md`.** `docs/v1.1/README.md`'s standing rule.

### 0.4 Ground rules

- Every decision cites a finding; every finding cites something read or run here.
- **No shell in any spawn this phase adds.** `os/exec` with an argv slice, never `sh -c`, never a
  string command line — `gitclient/runner.go`'s own discipline, and `internal/gitvsix` is written
  to the same rule. The `.vsix` path is a filesystem path this app produced; it is still passed as
  a single argv element and never interpolated into anything.
- **Tests only where `AGENTS.md`'s bar is met.** This phase clears it in exactly two places: the
  installer's probe-order/argv/outcome decision structure (a real decision table with five
  outcomes and two fallible spawns), and the palette-audit drift guard (an enforcement test in the
  spirit of `layering_test.go` and `verify-packaging.sh`, not a unit test of a function body).
  Nothing else gets a test: `package-vscode.ts` is proven by running it, the manifest by `vsce`
  itself, the `defineExpose`s by `typecheck:git`.
- **No stubbed error handling, no `TODO`.** Every outcome the installer can produce is a named
  value the pane renders.

---

## 1. Findings

### F1 — `vsce` runs here and produces a real `.vsix`; `--no-dependencies` is not optional

`@vscode/vsce@3.9.2` is a pure-Node CLI with no platform-specific packaging path. It packaged the
*actual* `apps/kira-studio-vscode` directory in this Linux container, exit 0, producing a
well-formed `.vsix` (a zip carrying `[Content_Types].xml`, `extension.vsixmanifest`, and the
`extension/` tree).

`--no-dependencies` is mandatory, not a tidiness flag. Without it vsce shells `npm list --production
--parseable --depth=99999` to compute which `node_modules` subtrees to bundle, and npm cannot
resolve Bun's `workspace:*` protocol: `ELSPROBLEMS — missing: @kira/git-core@workspace:*` with the
directory clean, `invalid: @kira/git-core@ …` with Bun's symlinks in place. Neither ever succeeds.
This is correct *and* desirable regardless: `dist/extension.cjs` is a complete bundle (D6), so
there is nothing in `node_modules` the extension needs at runtime.

### F2 — Without a `publisher`, the packaged extension's identity is literally `undefined`

`vsce package` did **not** fail on the missing field. It emitted
`<Identity … Id="kira-studio-vscode" Version="0.0.0" Publisher="undefined"/>`. That is the id VS
Code would register the installed extension under, show in the Extensions pane, and key
`context.globalState`/`context.secrets` off. Shipping that would be a defect discovered by a user,
not by any test — the packaging step passes.

`DisplayName` likewise fell back to the raw package name (`kira-studio-vscode`) because there is no
`displayName`.

### F3 — Three warnings, none fatal, and only one of them cosmetic

`repository` missing ("Use `--allow-missing-repository` to bypass"), no `LICENSE`, no
`.vscodeignore`. All three printed and the run continued. The `.vscodeignore` one is not cosmetic:
without it the `.vsix` shipped `src/**` (12 TypeScript files, ~72 KB) and `tsconfig.json`. Adding a
two-line ignore file dropped the package from 31 files/219 KB to 11 files/188 KB.

The `repository` warning's "continue anyway" behaviour depends on stdin not being a TTY. A
developer running the packaging script from an interactive terminal could be *prompted*. Declaring
`repository` removes the question entirely.

### F4 — `dist/ui/.vite/manifest.json` is read at runtime and survives packaging today

`html.ts:51-59` reads `dist/ui/.vite/manifest.json` with `readFileSync` on every
`resolveWebviewView` to turn `webview/main.ts` into its hashed built filename. It is present in the
packaged tree (verified). A `.vscodeignore` written with a broad `**/.*` or `**/.vite/**` pattern
would silently produce a `.vsix` whose every webview throws
`html.ts: no "…" entry in …/manifest.json` at first open — a failure with no packaging-time signal
at all. **The `.vscodeignore` must be written as an allow-what-is-needed list of exclusions, and
`dist/**` must not be touched.**

### F5 — The extension bundle is ESM today, and this is the phase where that stops being theoretical

`build-vscode.ts` emits `format: 'esm'` into `dist/extension.js`, and the manifest declares
`"type": "module"`, so Node resolves it as ESM. VS Code's extension host loads `main` through
`require`. Whether that works depends on the host's Node version supporting `require(esm)` and on
VS Code not rejecting it earlier — and **nobody has ever loaded this extension from an installed
`.vsix`**; every prior phase's manual step used `--extensionDevelopmentPath`, which loads the same
file the same way, but no phase's exit criteria ever recorded that it actually activated.

This is not something this container can settle. It is something that can be *removed as a
question*: `Bun.build({format:'cjs'})` on the real entry point succeeds here, emits
`require("vscode")` and `exports.activate`, weighs 137 KB (vs 136 KB for ESM), and still passes
`build-vscode.ts`'s own `bun:`/`Bun.` purity check (all verified).

### F6 — `vsce` under Bun works, so no Node dependency is introduced

`verify-packaging.sh`'s own comment records that "this repository does not declare `node` as a
dependency anywhere". Running `bun node_modules/@vscode/vsce/vsce package …` produced the same
`.vsix` as `node …` did. The packaging script can stay Bun-only, consistent with every other script
in `scripts/`.

### F7 — `@vscode/vsce` costs 120 MB / 280 packages, installs in 5 s, and its one blocked postinstall does not matter

Measured with `bun add -d @vscode/vsce@3.9.2` in a scratch workspace. Bun blocks
`@vscode/vsce-sign@2.1.0`'s postinstall by default (its untrusted-lifecycle-script gate);
`vsce package` from that tree still exits 0. Signing is only reached on the publish path, which
this chapter never takes. **No `trustedDependencies` entry is needed, and the "Blocked 1
postinstall" line on `bun install` is expected output, not a problem to fix.**

The workspace's `node_modules` is already 437 MB, so this is a ~27% increase on a directory nobody
ships.

### F8 — `build:vscode` was never wired in, and G3 deliberately left it that way

G1 §5.2 wrote "G3, the phase that first loads a webview, wires this in". G3 did not: its D20 says
`build:vscode` "stays out of `bun run build` and `scripts/setup.sh` (it is not on the critical
path…)" and instead made `bun run build:vscode` a green-exit-criterion of every phase from G3 on
(G4 §(h), G5 §(h), G6 §(h) all repeat it). So it is still wired into nothing, and G3's reasoning
still holds for `bun run build` (the frontend build, on `tests/e2e-real`'s prerequisite path) and
for `setup.sh` (on every dev run's critical path).

It does **not** hold for packaging, which is the one path that genuinely cannot work without it.

### F9 — Older plans' phase numbers are one behind, because G9 was inserted late

`2a0ad11e` added the FSEvents phase as G9 and renumbered everything after it. Plans G1–G8 were
written before that. So in G5/G6/G7/G8's prose:

| They wrote | It now means |
|---|---|
| G9 (Ship, the palette audit, `.vsix`, DMG bundling) | **G10 — this phase** |
| G10/G11 (`review.db`, blob snapshots, AI comments) | G11/G12 |
| G12/G13 (stash; reset/cherry-pick; and `tagPush`/`tagDeleteRemote`) | G13/G14 |
| G10 (search, the RE2-vs-`RegExp` reconciliation) | G15 |

Every "G9 owns the palette audit" note in G5:1488, G6:929/1436, G7:157/1847 and G8:1314 is
addressed to **this** plan. `gitsession/ops.go:64`'s own comment ("G7's tagPush/tagDeleteRemote,
G12's five stash kinds, G13's reset/cherryPick") is stale twice over — G7 did not take the tag
kinds, and the numbers moved.

### F10 — The complete list of mutating operations that exist today

From `opTable` (ten served) plus `remote.run` (five served) plus `undo.run` and `remote.cancel`:

| Operation | Wire | Served | UI affordance that drives it today |
|---|---|---|---|
| checkout | `op.run` | ✅ | branch picker row click; row menu "checkout detached" |
| branchCreate | `op.run` | ✅ | row menu → `branchDialogState` |
| branchDelete | `op.run` | ✅ | ref context menu inside the picker |
| branchRename | `op.run` | ✅ | ref context menu → `renameRefDialogState` |
| tagCreate | `op.run` | ✅ | row menu → `tagDialogState` |
| tagDelete | `op.run` | ✅ | `TagList.vue` row menu |
| revert | `op.run` | ✅ | row menu `revertThisCommit` → `opsState.runRevert([sha])` |
| opContinue / opAbort / opSkip | `op.run` | ✅ | `ConflictBanner.vue` |
| fetch / push / forcePush | `remote.run` | ✅ | `AppToolbar.vue` `doFetch`/`doPush`/`doForcePush` |
| pull | `remote.run` | ✅ | `PullStrategyPicker.vue` `runDefault` |
| deleteRemoteBranch | `remote.run` | ✅ | ref context menu on a remote row |
| (cancel a remote op) | `remote.cancel` | ✅ | `AppToolbar.vue` `doCancel` |
| undo | `undo.run` | ✅ | `UndoButton.vue` |
| tagPush, tagDeleteRemote | `op.run` | ❌ | `TagList.vue` calls them; the server refuses |
| stashPush/Apply/Pop/Drop/Branch | `op.run` | ❌ | G13 |
| reset, cherryPick | `op.run` | ❌ | G14 |

`credential.provide` is correctly excluded: it is answered by the extension in response to a server
event, never invoked by a user (`extension.ts:144-156`).

### F11 — There is no way to reach the webview from the extension host except a contract event

`RpcServer.emit(key, payload)` runs `assertContractShape('event', key, payload)`, which throws for
any key not in `EVENT_KEY_MAP` (`validate.ts:98-104,145-160`), and every frame is wrapped by
`wrapVersioned` carrying `CONTRACT_VERSION`. The extension→webview channel is governed by the same
contract as the socket. There is no out-of-band `postMessage` path that `rpc.ts` would not reject.

The bootstrap island (`html.ts:97-102` → `webview/main.ts`'s `readBootstrap()` →
`git-ui/src/main.ts`'s `MountOptions`) reaches the webview *without* the contract — but only on a
cold `resolveWebviewView`. `panelView.ts:1-5` records that `retainContextWhenHidden` is
deliberately off, so a hidden view is re-resolved (island works) while an already-visible one is
not (island never re-runs). `reviewView.ts` needs and uses **both** arms for exactly this reason.

### F12 — A Finder-launched macOS app does not have `/usr/local/bin` on `PATH`

`code` reaches `PATH` on macOS only through VS Code's own "Shell Command: Install 'code' command in
PATH", which writes `/usr/local/bin/code`. A GUI app launched from Finder inherits launchd's
environment, whose `PATH` is `/usr/bin:/bin:/usr/sbin:/sbin`. A bare `exec.LookPath("code")` from
inside `Kira Studio.app` would therefore fail for essentially every user, and the Install button
would *always* fall back to reveal-in-Finder — technically satisfying SPEC's sentence while
delivering none of its value.

This repo already solved the identical problem for `git`: `gitclient/discovery.go:64-90`'s
`darwinLocator` probes the setting, then `PATH`, then `/opt/homebrew/bin`, then `/usr/local/bin`,
then `/usr/bin`, records every path it considered in `probed`, and reports the miss with that list.
The same shape applies directly.

### F13 — The button has no natural home in a dev build, and that is acceptable

`os.Executable()` inside a packaged app is
`…/Kira Studio.app/Contents/MacOS/Kira Studio`, so `Contents/Resources/kira-version.vsix` is one
`filepath.Join(dir, "..", "Resources", …)` away. Under `wails3 task dev` the binary sits in
`apps/kira-studio/bin/` with no `Contents/` above it, and nothing at runtime knows the repository
root. `darwin:run` *does* build a real `Kira Studio.dev.app` bundle with a `Contents/Resources`,
so a developer on macOS can exercise the real path — provided the `.vsix` is copied there too.

`config.IsDev()` exists but is the wrong tool here: the question is not "is this a dev build" but
"is there a `.vsix` beside me", which is answerable directly and honestly.

### F14 — Nothing imports the extension package by name

`grep` across the workspace finds `kira-studio-vscode` only as a `workspaces` path entry and inside
`packages/git-ui/vite.config.ts` as a *directory* path. The manifest's
`exports: {".": "./src/index.ts"}` has no consumer, and `src/**` is exactly what `.vscodeignore`
removes from the `.vsix` — so shipping that field would put a dangling `exports` map in the
installed manifest.

### F15 — `AppToolbar.vue` already has the exposure pattern this phase needs

`defineExpose({ refresh: () => refreshButtonRef.value?.refresh() })` (`:74-77`) exists precisely so
`App.vue` can drive the same code path a button click does, "rather than App.vue reimplementing
RefreshButton's own idempotency and hasPendingChange bookkeeping a second time". That sentence is
the whole design rationale for how palette commands should reach the toolbar's operations, already
written by an earlier phase.

### F16 — `OpsState` is already the complete operation surface

Every mutating operation in F10 is a method on the single `OpsState` instance `App.vue` holds
(`ops.ts:286`–`:1219`). A palette dispatcher does not need to reimplement preflight handling,
dialog routing, protected-branch confirmation, or announcement composition — those all live behind
those methods and their `resolve*Dialog` counterparts. The dispatcher is a `switch`.

### F17 — `engines.vscode` is `^1.134.0`, matching the only `@types/vscode` this repo typechecks against

Upstream D7 ("`engines.vscode` floor … revisited at P13") is this phase's question. The extension
uses no API newer than webview views, status-bar items, `createInputBox` and
`registerTextDocumentContentProvider` — all long-stable — so a lower floor would be *possible*. It
would also be a claim nothing in this repo checks: `@types/vscode` is pinned to `1.134.0` and
`typecheck:git` compiles against exactly that.

### F18 — `verify-packaging.sh` has a check shape that fits the bundled `.vsix` exactly

Artifact checks run only when the `.app` exists and print "skipped" otherwise (`A1`/`A3`/`A5`/`N2`),
every check runs before exit, and check IDs are stable because `docs/PACKAGING.md` cross-references
them. A new artifact check for the bundled `.vsix` and a new static check for version agreement
drop straight in, with `S9`/`A6` as the next free ids.

### F19 — The release workflow already rewrites one version file, and one only

`.github/workflows/release.yml:33-40` `perl -i -pe`s `build/config.yml`'s `info.version` from the
tag and then asserts the write landed. Nothing writes `apps/kira-studio-vscode/package.json`'s
`version`, which is `"0.0.0"` — the same value `config.yml` holds today, so they agree *now* and
would silently diverge on the first tagged release.

### F20 — `test:unit` does not cover the extension directory

`"test:unit": "bun test apps/kira-studio/tests/unit packages/api-core/test packages/git-ipc/src"`.
Any enforcement test placed under `apps/kira-studio-vscode/src` needs that directory added, or it
never runs.

---

## 2. Decisions

### D1 — `@vscode/vsce@3.9.2` goes into root `devDependencies`, not a `.tools/` fetch

`scripts/generate-wire.sh`'s gitignored, digest-pinned `.tools/flatc-*` cache is the repo's
precedent for a packaging-only tool, and it was considered. It is declined here for a specific
reason: `flatc` is a **prebuilt platform binary with no package manager**, so a hand-rolled fetch
with a SHA-256 pin is the *only* way to pin it. `@vscode/vsce` is an ordinary npm package;
`bun.lock` plus `bunfig.toml`'s `exact = true` already give it a stronger pin (a full integrity
hash per transitive package) than a hand-rolled fetcher would, and `bun install --frozen-lockfile`
in CI already installs it before `bun run package` runs. Building a second dependency-acquisition
path for something the lockfile handles is the kind of hand-rolled infrastructure `AGENTS.md` tells
us to reach for a library instead of.

Cost, measured rather than estimated (F7): +120 MB and +5 s on a `node_modules` that is already
437 MB, and one *expected* "Blocked 1 postinstall" line that needs no `trustedDependencies` entry.

Invoked as `bun <root>/node_modules/@vscode/vsce/vsce`, never `node` (F6, and
`verify-packaging.sh`'s own note that this repo declares no `node` dependency).

### D2 — The manifest gains identity fields; `name` does **not** change

Added: `displayName: "Kira Version"`, `description`, `publisher: "kirathecat"`, `license: "MIT"`,
`categories: ["SCM Providers"]`, `repository`, `icon`, `activationEvents`, `contributes.menus`, and
the new commands. Removed: `exports` (F14).

`name` stays `kira-studio-vscode`. It is the workspace package's identity — referenced by
`package.json#workspaces`, `biome.json`'s override block, `tsconfig.json` paths and the
`apps/kira-studio-vscode/node_modules/@kira/*` symlink layout — and the string a *user* sees is
`displayName`, which becomes "Kira Version". The installed id is therefore
`kirathecat.kira-studio-vscode`. Recorded here so it is not relitigated in a later phase.

`publisher: "kirathecat"` matches the app's own identity throughout
(`com.kirathecat.kira-studio`, `github.com/kirathecat/kira-studio`, `docs/ARCHITECTURE.md`'s "App
identity" paragraph). It is never used to authenticate against a gallery — SPEC puts publishing out
of scope — it exists so the extension has a real id instead of `undefined` (F2).

`private: true` **stays**: it is a true statement (this is never published to npm) and it did not
impede `vsce package` (verified).

### D3 — `activationEvents: ["onStartupFinished"]`

Today the extension has no `activationEvents` at all and activates only through the implicit
`onView:` events its two webview views contribute. That is correct for the graph, and wrong for a
status-bar item: an item created in `activate()` cannot appear until something else has already
activated the extension, so the entry point that exists to *lead* a user to the panel would only
appear after they had already opened the panel by hand.

`onStartupFinished` (not `*`) is the standard, non-blocking answer: VS Code activates after the
window's own startup work is done, so nothing on the critical path is delayed. The activation cost
is one socket dial with backoff, which `ConnectionManager` already handles when Kira Studio is not
running.

### D4 — `.vscodeignore` is a short exclusion list, and `dist/**` is never touched

```
src/**
tsconfig.json
.vscodeignore
node_modules/**
**/*.map
```

`src/**` and `tsconfig.json` are the two real inclusions to remove (F3). `node_modules/**` and
`**/*.map` are belt-and-braces (vsce already excludes the former under `--no-dependencies`, and no
sourcemaps are emitted today) — cheap, and they stop a future build-flag change from silently
inflating the artifact.

**Deliberately absent: any pattern matching `dist/`, `.vite/`, or a leading dot.** F4: the webview
resolves its own hashed asset names by reading `dist/ui/.vite/manifest.json` at runtime, and an
over-broad ignore would produce a `.vsix` that packages cleanly and then fails at the first webview
open, with no packaging-time signal. A comment in the file says so.

### D5 — `LICENSE` is copied into `apps/kira-studio-vscode/`, committed

The last remaining vsce warning. The root `LICENSE` (MIT) is copied to
`apps/kira-studio-vscode/LICENSE` and committed rather than copied at package time: a distributed
artifact should carry its licence, and a build-time copy is a step that can be skipped by anyone
invoking `vsce` directly.

### D6 — The extension bundle becomes CommonJS: `dist/extension.cjs`

F5. `build-vscode.ts` switches to `format: 'cjs'` and writes `dist/extension.cjs`; the manifest's
`main` becomes `"./dist/extension.cjs"`. `"type": "module"` stays (it is correct for the source
tree and for the Vite-built webview bundle); a `.cjs` extension is unambiguous regardless of it.

Rationale, stated plainly: this is the first phase whose artifact is loaded by a real extension
host from a real install, the ESM-`main` question cannot be answered in this container, and the CJS
answer is *free* — measured here at +1 KB, still purity-clean, still exporting `activate`. Carrying
an unresolved "does the host accept an ESM entry point" question into a shipped `.vsix` would be
the one failure mode where nothing works at all and no test anywhere would have said so.

The webview bundle is untouched (Vite, ESM, browser target — loaded by a `<script type="module">`
tag, never `require`d).

### D7 — `scripts/package-vscode.ts`, and `build-vscode.ts` grows an exported entry point

`build-vscode.ts` is refactored the minimum amount: its two build functions and the purity check
are wrapped in one exported `buildVsCodeBundles()`, and `main()` becomes
`if (import.meta.main) …`. `bun run build:vscode` behaves exactly as before.

`scripts/package-vscode.ts` (new, ~70 lines):

1. `await buildVsCodeBundles()` — an import, not a subprocess, so there is one implementation of
   "build the extension".
2. Spawns vsce, argv-only, no shell:
   `Bun.spawn([process.execPath, join(ROOT,'node_modules/@vscode/vsce/vsce'), 'package',
   '--no-dependencies', '--out', OUT], { cwd: VSCODE_APP, stdio: ['ignore','inherit','inherit'] })`
   where `OUT = apps/kira-studio/bin/kira-version.vsix`.
3. Fails loudly on a non-zero exit, on a missing output file, or on an output smaller than a sanity
   floor (a `.vsix` that does not start with `PK`).
4. Prints the output path and its size.

`package.json` gains `"package:vscode": "bun run scripts/package-vscode.ts"`.

**Output location: `apps/kira-studio/bin/kira-version.vsix`.** It is the repo's one build-output
directory (already gitignored, already where `Kira Studio.app`/`.dmg` land, already the directory
`sign-bundle.sh` and `verify-packaging.sh` both name), and — decisively — it is *outside* the
directory vsce packages, so a previous run's `.vsix` can never be packaged into the next one. A
fixed filename (no version in it) keeps the Taskfile copy step and the Go-side path constant; the
version lives inside the manifest, where `code` reads it.

### D8 — Packaging wiring: a `common:build:vsix` task, a copy in `create:app:bundle`, a conditional copy in `run`

`build:vscode` still stays out of `bun run build` and `scripts/setup.sh` — G3 D20's reasoning is
untouched, and both are on paths (`tests/e2e-real` prerequisites, every `bun run dev`) that have no
use for an extension bundle. What changes is that **packaging** now genuinely needs it (F8), so it
is wired into the packaging graph and nowhere else:

- `apps/kira-studio/build/Taskfile.yml` gains `build:vsix` — `run: once`, `dir:
  {{.WORKSPACE_ROOT}}`, `deps: [install:frontend:deps]`, `sources:` the extension and the three
  `packages/git-*` trees plus both scripts (excluding `dist`), `generates:
  apps/kira-studio/bin/kira-version.vsix`, `cmds: [bun run scripts/package-vscode.ts]`.
- `darwin:package` and `darwin:package:universal` gain `common:build:vsix` alongside their existing
  `build` dep.
- `create:app:bundle` copies it into `Contents/Resources/kira-version.vsix`, **before**
  `codesign:adhoc` (so the signature covers it) and with a hard failure if it is missing — the same
  posture the existing PlistBuddy step takes for a broken environment. It cannot be missing in
  practice, because the two tasks that reach `create:app:bundle` both depend on `build:vsix`; the
  check exists so a future task that forgets the dep fails at build time rather than shipping a
  `.dmg` whose Install button reports "not bundled".
- `run:` (the `.dev.app`) copies it **conditionally** (`if [ -f … ]`), because `darwin:run` does not
  and should not build it. This is what makes the button exercisable on a Mac without cutting a
  `.dmg` (F13).

`bun run package` itself is unchanged, which keeps `verify-packaging.sh`'s S5 check
(`*"wails3 task darwin:package:dmg"*`) true as written.

### D9 — One new contract event, `ui.action`; `CONTRACT_VERSION` 16 → 17. Flagged, not smuggled

**This is the one place this phase touches the wire contract, and the chapter's expectation was
that it would not have to.**

The requirement is a palette command for every mutating operation (SPEC's G10 row). The operations
themselves live behind `OpsState` inside the webview (F16), together with every preflight dialog,
protected-branch confirmation and undo-slot interaction. F11 establishes that the *only* way the
extension host can reach a live webview is a contract event.

Alternatives, all rejected:

| Alternative | Why not |
|---|---|
| Implement each palette command host-side against the server RPCs, with native quickpicks for input | A second, unproven implementation of hazard resolution (checkout's `blockedByTracked` discard-vs-stash-and-carry route, force-push's protected-branch token, pull's strategy resolution). It is also literally the thing SPEC's "Out of scope" list rejects: "redesigning the extension's UI around native VS Code surfaces". |
| Bootstrap island only (no event) | Works only when the view is currently hidden and gets re-resolved. A palette command run while the panel is open would do nothing (F11). |
| A non-contract `postMessage` alongside the RPC frames | `rpc.ts`'s `onMessage` handler and `assertContractShape` reject anything that is not a versioned contract frame. It would mean adding a second, unvalidated message path to a channel this chapter deliberately keeps under one contract. |
| Reuse an existing event | None of the five carries an action; overloading `repo.changed` or `settings.changed` to smuggle a command would be worse than a new key by every measure. |

So: `contract.ts`'s `events` gains

```ts
/** G10: host -> the GRAPH webview only (never the review sidebar, which renders no operation
 *  UI). One palette command's action, routed to the affordance the toolbar or a context menu
 *  already drives — the palette is an entry point, never a second implementation. */
'ui.action': { readonly action: UiActionKind };
```

with `UiActionKind` exported beside it, `EVENT_KEY_MAP` gaining `'ui.action': true` (a compile
error until it does), and `CONTRACT_VERSION` **17** in `validate.ts:7` and `gitrpc/contract.go:13`
together.

**Why the cost is genuinely near-zero here, and would not be later:** the version is a hard-lockstep
handshake between two halves of one release (SPEC §3.4), the mismatch panel already exists and is
already exercised, and **no `.vsix` has ever been installed by anybody** — this phase is the first
one that produces an installable artifact at all. A user cannot be on the far side of this bump.
Every one of G3/G4/G6/G7 bumped the contract for less. If a *later* phase finds itself wanting a
second `ui.action` member, that is one more union member and one more bump, in a chapter where the
extension and the app already ship together in one DMG.

`gitwire`/FlatBuffers are untouched — `ui.action` is a JSON control frame on the extension↔webview
channel and never crosses the socket, so the Go server neither emits nor parses it. The Go constant
moves only because the constant is the single compatibility authority.

### D10 — `internal/gitvsix`: a new domain package, not logic inside `bridge`

Locating an artifact, probing for a binary and spawning it is domain logic; `internal/bridge` is the
Wails adapter layer, and `internal/layering_test.go` exists to keep that line. The new package is
`internal/gitvsix`, named for the git module per SPEC §7's `internal/git*` convention. It imports
nothing from `bridge` and nothing from `gitclient` (it shares that package's *discipline*, not its
code — a git spawn and a `code` spawn have nothing in common but the rule "argv, no shell").

Its whole API:

```go
type Deps struct {
    Executable func() (string, error)                                   // os.Executable
    LookPath   func(string) (string, error)                             // exec.LookPath
    Stat       func(string) (os.FileInfo, error)                        // os.Stat
    Run        func(ctx context.Context, path string, args []string) error // argv-only exec
}

type Installer struct{ /* deps */ }
func New(d Deps) *Installer          // zero-value fields fall back to the real implementations

type Status struct {
    Bundled   bool     // a .vsix was found next to the running executable
    VsixPath  string   // "" unless Bundled
    CodePath  string   // "" when `code` was not found
    Probed    []string // every path considered for `code`, in order — always populated
}
func (i *Installer) Status() Status

type Result struct {
    Outcome  string   // see D12
    VsixPath string
    CodePath string
    Probed   []string
    Detail   string   // a bounded, one-line reason on a failure; never a path secret, never stderr verbatim
}
func (i *Installer) Install(ctx context.Context) Result
```

`Install` **never returns an error** — `connections.Service.Reveal`/`apivars.Reveal`'s precedent,
which G1 D19 already applied to `GitClientsService` for exactly this class of user action.

### D11 — The `.vsix` is found relative to `os.Executable()`, and nowhere else

`filepath.Join(filepath.Dir(exe), "..", "Resources", "kira-version.vsix")`, then `Stat` +
regular-file check. That single probe resolves correctly inside `Kira Studio.app` and inside
`Kira Studio.dev.app` (D8's conditional copy), and resolves to nothing under `wails3 task dev`,
which reports `notBundled` — an honest answer, not an error (F13).

No `KIRA_*` environment override. `verify-packaging.sh`'s S8 already forbids env-driven dev
branches in `main.go`, and the same instinct applies here: the dev story is `darwin:run`, which
produces a real bundle, not an env var that makes a non-bundle pretend to be one.

### D12 — Probe order for `code`, and the five outcomes

Probe order, mirroring `gitclient/discovery.go:64-90`'s shape (`PATH` first, then the well-known
absolute paths, every candidate recorded in `Probed` either way):

1. `LookPath("code")`
2. `/usr/local/bin/code` — where VS Code's own "Shell Command: Install 'code' command in PATH"
   writes its symlink
3. `/opt/homebrew/bin/code`
4. `/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`
5. `$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`

F12 is why steps 2–5 exist at all: a Finder-launched bundle has launchd's `PATH`, so step 1 alone
would miss for nearly every user and the button would permanently degrade to reveal-in-Finder.

**Insiders and VSCodium are deliberately not probed.** Installing into an editor the user may not
run is a worse outcome than handing them the file: the reveal fallback lets them drag it into
whichever editor they actually use. Named here so it reads as a decision rather than an omission.

The command is `code --install-extension <absolute .vsix path> --force`. `--force` matters: without
it, re-installing a `.vsix` whose version has not changed (the normal case during a release cycle,
since `build/config.yml` is `0.0.0` between tags) is a no-op or an error, and the button would
appear to do nothing.

Reveal is `open -R <absolute .vsix path>`, with `open` resolved by `LookPath` then `/usr/bin/open`.

Outcomes (`Result.Outcome`), exhaustive:

| Outcome | Meaning | What the pane says |
|---|---|---|
| `installed` | `code` found, exit 0 | "Installed into VS Code. Reload the window to activate it." |
| `revealed` | `code` not found, `open -R` succeeded | "VS Code's `code` command isn't available. Revealed the file in Finder — drag it onto VS Code, or run Shell Command: Install 'code' command in PATH." |
| `notBundled` | no `.vsix` beside the executable | "The extension ships inside the packaged app. This build has none." |
| `installFailed` | `code` found, non-zero exit or spawn error | "VS Code refused the install: `<Detail>`." + the reveal hint |
| `revealFailed` | `code` not found *and* the reveal failed | names the `.vsix` path so the user can find it by hand |

`installFailed` does **not** silently fall back to reveal: a `code` that exists and refused is a
different problem from a `code` that is absent, and collapsing the two would hide it. The message
names both the failure and the manual route.

`Detail` is derived from the exit status and a bounded first line of stderr (capped, single-line),
following `gitclient`'s own `maxStderrBytes` instinct that a child's stderr is untrusted text
heading for a UI string.

A 60-second `context.WithTimeout` bounds both spawns; a timeout reports `installFailed` with
"timed out". `code --install-extension` is a local, fast operation — this bound exists so a wedged
child can never hang a bound call, matching the graceful-stop posture `gitclient` takes everywhere.

### D13 — argv-only, and the seam is the same shape `gitclient.Runner` established

The real `Run` is:

```go
cmd := exec.CommandContext(ctx, path, args...)
cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
cmd.Env = os.Environ()   // unmodified: `code` needs the user's own HOME/PATH to find its install
cmd.WaitDelay = gracefulStopDelay-equivalent
```

No `sh`, no `-c`, no string command line, no interpolation of the path into anything. `os/exec`
never interprets `args`, so a `.vsix` path containing a space (`/Applications/Kira Studio.app/…` —
and the app's own executable is literally `Contents/MacOS/Kira Studio`, space included) is passed as
one argument by construction. This is stated explicitly because the space in the bundle name makes
it a *realistic* rather than theoretical failure for any shell-based alternative.

The test seam is the `Deps` function fields (D10) rather than an interface, because there are four
independent injection points and no behaviour to share between them. Tests inject a `Run` that
records `(path, args)`, a `LookPath` that answers from a fake table, and a `Stat` over a
`t.TempDir()`.

### D14 — `GitClientsService` gains two methods; the pane gains one button and one status line

```
VsixStatus()                → GitVsixStatus{ bundled, vsixPath, codeAvailable, probed }
InstallVsCodeIntegration()  → GitVsixInstallResult{ outcome, vsixPath, detail }
```

Both are no-argument, mirroring `PendingPairing()`'s existing shape; neither returns a Go error.
The service gains one field, `Vsix GitVsix`, where `GitVsix` is a two-method interface **declared in
`bridge/gitclients.go`** beside the existing `GitSock`/`GitBroker` — the same "declare the interface
where it is consumed" precedent that file already sets.

`VsixStatus` exists so the pane can render honestly *before* a click: the button reads "Install VS
Code Integration" when `codeAvailable`, "Reveal Extension in Finder" when bundled without `code`,
and the section renders an explanatory line instead of a button when `!bundled`. It is advisory
only — `Install` re-resolves everything itself and is the authority — and the doc comment says so,
because a `code` installed after the pane rendered must still work.

`probed` is surfaced (as a tooltip/expandable line) for the same reason `GitStatus.Probed` is: when
the answer is "not found", the useful information is *what was looked at*.

### D15 — SCM title-bar button: `kiraVersion.focusGraph`, contributed to `scm/title`

```jsonc
"menus": {
  "scm/title": [
    { "command": "kiraVersion.focusGraph", "group": "navigation" }
  ]
}
```

The command already exists and already does exactly one thing —
`vscode.commands.executeCommand('kiraVersion.graph.focus')` (`extension.ts:197-199`). SPEC's "entry
points, not a redesign" is satisfied structurally: this contributes no new behaviour whatsoever,
only a second place to invoke an existing command. Its title becomes "Open Git Graph" (upstream
6.5's own wording) and it gains `"icon": "$(git-branch)"` so the title bar renders a glyph rather
than text.

No `when` clause: the SCM view title is only visible when there is an SCM provider at all, and
gating on `scmProvider == git` would hide the button in a repository VS Code's built-in git
extension has not claimed while ours works fine.

### D16 — Status-bar item: an entry point with connection state, and **no** branch/ahead-behind

Created in `activate()`, `StatusBarAlignment.Left`, disposed with the extension, `command:
'kiraVersion.focusGraph'`, text `$(git-branch) Kira Version`, tooltip naming the connection state
and (when known) the active repository root. Shown only when the connection is `connected`;
hidden otherwise, driven off `manager.onStateChange`, which `activate()` already subscribes to.

Gated by a new **host-only** setting `kiraVersion.statusBar.enabled` (default `true`), upstream
6.5's own escape hatch for a crowded status bar. It is declared in `contributes.configuration` and
read directly with `vscode.workspace.getConfiguration().get(...)` — deliberately **not** added to
`SETTINGS`/`SettingsSnapshot`, because the webview has no use for it and putting it there would be
a second, gratuitous contract change on top of D9's.

**Branch and ahead/behind are declined**, a named departure from upstream 6.5's `⎇ main ↓2 ↑3`.
The extension host holds no head state: `repo.changed` carries only `{repoId, kind}`
(`contract.ts:1169`), so rendering that text would mean a per-window `status.get`/`refs.list` poll
on every watcher event, maintaining a host-side copy of state the webview already owns and renders
in its own toolbar — a second source of truth, and exactly the "redesign" this chapter excludes.
Recorded in §9 as available to a later phase if it earns its keep.

Its exact left/right position relative to the built-in git extension's own item cannot be
determined here (it depends on that extension's priority in the shipping VS Code build); a plain
priority is chosen and its placement is a tier-3 observation, not a claim.

### D17 — Palette commands: one table, seventeen new commands, three action shapes

`apps/kira-studio-vscode/src/commands.ts` (new) is **data only** and imports no `vscode` — which is
what lets a plain `bun test` import it (F20, D20).

```ts
export type MutatingAction =
  | OpRequest['kind']          // 19 members
  | RemoteOpParams['kind']     // 5 members
  | 'undo'                     // undo.run
  | 'cancel';                  // remote.cancel

export interface PaletteCommand {
  readonly command: string;    // "kiraVersion.…"
  readonly title: string;
  readonly action: UiActionKind;
}
export type MutatingEntry =
  | PaletteCommand
  | { readonly pending: 'G13' | 'G14' };   // served by no phase yet — see D18

export const MUTATING_COMMANDS: Record<MutatingAction, MutatingEntry> = { … };
export const OTHER_COMMANDS: readonly PaletteCommandOrHandlerless[] = [ … ];
export const ALL_COMMANDS: readonly { command: string; title: string }[] = …;
```

`Record<MutatingAction, …>` is the same mapped-type trick `validate.ts:45-58` documents at length:
a **missing** key is a compile error, so the day `contract.ts` grows a twentieth `OpRequest` kind,
this table stops compiling until someone decides what its palette command is.

The seventeen new commands and the `UiActionKind` each drives:

| Command | Title | `UiActionKind` | What it reaches |
|---|---|---|---|
| `kiraVersion.checkout` | Checkout… | `openBranchPicker` | `BranchPicker.open()` |
| `kiraVersion.createBranch` | Create Branch… | `createBranch` | `branchDialogState` at the selection, else `HEAD` |
| `kiraVersion.deleteBranch` | Delete Branch… | `openBranchPicker` | the picker's per-row menu |
| `kiraVersion.renameBranch` | Rename Branch… | `openBranchPicker` | the picker's per-row menu |
| `kiraVersion.createTag` | Create Tag… | `createTag` | `tagDialogState` at the selection, else `HEAD` |
| `kiraVersion.deleteTag` | Delete Tag… | `openBranchPicker` | the picker's `TagList` section |
| `kiraVersion.deleteRemoteBranch` | Delete Remote Branch… | `openBranchPicker` | the picker's remote rows |
| `kiraVersion.revertCommit` | Revert Commit… | `revertSelected` | `opsState.runRevert([selection.sha])` |
| `kiraVersion.continueOperation` | Continue Operation | `continueOperation` | `opsState.continueOp()` |
| `kiraVersion.abortOperation` | Abort Operation | `abortOperation` | `opsState.abortOp()` |
| `kiraVersion.skipCommit` | Skip Commit | `skipCommit` | `opsState.skipOp()` |
| `kiraVersion.undo` | Undo Last Operation | `undo` | `opsState.undo()` |
| `kiraVersion.fetch` | Fetch | `fetch` | `AppToolbar` `doFetch` |
| `kiraVersion.pull` | Pull | `pull` | `PullStrategyPicker` `runDefault` |
| `kiraVersion.push` | Push | `push` | `AppToolbar` `doPush` |
| `kiraVersion.forcePush` | Force Push… | `forcePush` | `AppToolbar` `doForcePush` |
| `kiraVersion.cancelRemoteOperation` | Cancel Remote Operation | `cancelRemoteOperation` | `AppToolbar` `doCancel` |

Plus one non-mutating addition, `kiraVersion.refresh` → `refresh` (upstream 6.5 lists "open panel,
refresh, search"; `AppToolbar` already exposes `refresh`, F15). Search's own command lands with
G15, which serves `search.run`.

**Five ref-scoped commands share `openBranchPicker`, and that is deliberate.** The picker is the
only place the UI names a ref to act on, and each row already carries a "…" menu button
(`BranchPicker.vue:106-111`). A palette entry per operation exists because a palette is a *search*
surface — someone typing "delete branch" must find the way there — and the alternative (a bespoke
native quickpick per operation) is the redesign SPEC forbids. The trailing ellipsis is VS Code's own
convention for "opens a chooser", so the titles do not over-promise.

The two selection-driven commands (`revertCommit`, and the create-dialog pair when nothing is
selected) degrade the way the UI already degrades elsewhere: the dispatcher falls back to `HEAD` for
create, and `revertCommit` with no selection posts the same live-region announcement the row menu
path would ("select a commit first") rather than silently doing nothing.

### D18 — Unserved kinds get a `pending` entry naming their phase; that is the drift mechanism

The nine unserved kinds (F10) are present in `MUTATING_COMMANDS` as `{ pending: 'G13' }` (the five
stash kinds), `{ pending: 'G14' }` (reset, cherryPick) and `{ pending: 'G14' }` for
`tagPush`/`tagDeleteRemote` — which G7 handed forward to "whichever of G12/G13 takes them", i.e.
G13/G14 under the corrected numbering (F9); G14 is chosen because both are `push` operations that
belong with the reset/cherry-pick sweep rather than the stash one, and the entry's comment says so
plus "move it if G13 takes them instead".

This is exactly what SPEC's G10 row means by later phases "each responsible for registering its own
palette command when it lands": a phase that serves `stashPush` in `opTable` and does nothing else
**fails a test** (D20) that names the kind and points at this table.

### D19 — `activate()` registers from the table, not from a hand-written list

`extension.ts` builds its registrations by iterating `ALL_COMMANDS`, resolving each id to a handler
from one `Record`:

- every `MUTATING_COMMANDS` entry that is a `PaletteCommand` → `() => graphProvider.runUiAction(entry.action)`;
- the five non-mutating ids → an explicit `Record<OtherCommandId, () => void>`, so TypeScript
  requires a handler for each and rejects one for an id that does not exist.

This is what makes D20's manifest↔table test sufficient: there is no third place (a forgotten
`registerCommand` call) where the sets could diverge.

`KiraGraphViewProvider` gains `runUiAction(action)`, built on `reviewView.ts:77-86`'s proven
two-arm pattern, because a webview view that is currently hidden has no live `RpcServer` and a
`postMessage` into a document that has not booted yet is dropped (F11):

- set `#pendingAction`;
- `executeCommand('kiraVersion.graph.focus')`;
- if a server is live, `emit('ui.action', {action})` and clear;
- otherwise `resolveWebviewView` renders `renderHtml({view:'graph', pendingAction})`, and the
  island carries it into the mount — the same route `review.target` takes.

### D20 — The enforcement mechanism is one Bun test that reads the manifest **and Go's own `opTable`**

`apps/kira-studio-vscode/src/commands.test.ts`, run by `bun run test:unit` once F20's path is added.
Five assertions:

1. **Every served mutating kind has a command.** The served set is extracted from the Go source
   itself — `internal/gitsession/ops.go`'s `var opTable = map[string]opSpec{ … }` block and
   `internal/gitsession/remote.go`'s `RunRemote` switch — with a narrow regex, plus a *sanity guard*
   asserting the extracted sets are non-empty and contain known anchors (`checkout`, `revert`;
   `fetch`, `pull`). Without that guard, a regex that stopped matching would make the test pass
   vacuously, which is the failure mode this whole test exists to prevent.
2. **No served kind is marked `pending`**, and **no unserved kind carries a command** — the two
   directions of the same fact, so a phase cannot half-land either side.
3. **Every table command id is declared in `package.json`'s `contributes.commands`**, with a
   non-empty `title` and `category: "Kira Version"`.
4. **Every `kiraVersion.*` command in the manifest is in the table** — no orphan manifest entry
   surviving a rename.
5. **Ids are unique** across the whole table.

Why a Bun test and not a Go one: the manifest is JSON and the table is TypeScript, so two of the
three inputs are already native here; only the served-kind extraction crosses the language line, and
it crosses in the direction where the reading side has the better tooling. Why a test rather than a
committed checklist: a checklist cannot fail CI, and SPEC explicitly hands future phases the
responsibility of registering their own command — they need something that *stops them*, not
something they must remember to read.

Why this clears `AGENTS.md`'s test bar despite not being "advanced logic": it is the same category
as `internal/layering_test.go` (auto-enumerating packages to enforce a boundary) and
`scripts/check-tokens.sh` — an invariant guard, not a unit test of a function body. `AGENTS.md`'s
bar governs *behavioural* tests.

### D21 — Version agreement is asserted, and the release workflow writes both files

`.github/workflows/release.yml`'s "Set the app version from the release tag" step gains a second
`perl -i -pe` over `apps/kira-studio-vscode/package.json`'s top-level `"version"` (anchored to
`^  "version": `, which matches only the top-level key at two-space indent — the same anchoring
idiom the existing `config.yml` rewrite uses), plus the same read-back assertion.

`verify-packaging.sh` gains **S9**: the extension manifest's `version` must equal
`build/config.yml`'s `info.version`. Both are `"0.0.0"` today, so it passes immediately and stays
true after a tagged release writes both. A static check, so it runs on Linux and in every CI job,
not only when a bundle exists.

And **A6** (artifact, runs only when the `.app` exists):
`Contents/Resources/kira-version.vsix` exists, is non-empty, and begins with `PK` — a real archive,
not a truncated copy.

### D22 — `engines.vscode` stays `^1.134.0`

Upstream D7 says the floor is "roughly six months behind current stable" and is "revisited at P13".
Revisited here, and kept, for a reason specific to this chapter's substitution of DMG bundling for
marketplace publishing: **reach is not a factor.** The `.vsix` is only ever installed by someone who
has just installed the matching Kira Studio, the two are hard-lockstepped on `CONTRACT_VERSION`
anyway, and `1.134.0` is the only `@types/vscode` this repo compiles against (F17) — a lower floor
would be an untested claim about API availability, which is worse than a conservative one. Recorded
so upstream's D7 is answered rather than quietly dropped.

---

## 3. File by file

### 3.1 Packaging

**`package.json` (root)** — edited:
- `devDependencies` gains `"@vscode/vsce": "3.9.2"` (D1; `bunfig.toml`'s `exact = true` pins it).
- `scripts` gains `"package:vscode": "bun run scripts/package-vscode.ts"`.
- `scripts.test:unit` gains `apps/kira-studio-vscode/src` (F20).
- `scripts.package` is **unchanged** (D8).
- `bun.lock` changes.

**`scripts/build-vscode.ts`** — edited (D6, D7): `format: 'cjs'`, output `dist/extension.cjs`,
functions wrapped in an exported `buildVsCodeBundles()`, `main()` behind `import.meta.main`. The
purity check and its comment stay; the file's own "not wired into setup.sh or bun run build" header
comment is updated to say what D8 actually did (wired into the *packaging* graph, still out of
`build`/`setup.sh`, with G3 D20's reason preserved).

**`scripts/package-vscode.ts`** — new, ~70 lines (D7).

**`apps/kira-studio/build/Taskfile.yml`** — edited: new `build:vsix` task (D8).

**`apps/kira-studio/build/darwin/Taskfile.yml`** — edited (D8): `package`/`package:universal` gain
the `common:build:vsix` dep; `create:app:bundle` gains the hard copy before `codesign:adhoc`;
`run` gains the conditional copy.

**`scripts/verify-packaging.sh`** — edited: S9 and A6 (D21). No existing check id is renumbered
(the file's own header explains why ids are stable).

**`.github/workflows/release.yml`** — edited: the version step writes both files (D21).

### 3.2 Go

**`apps/kira-studio/internal/gitvsix/install.go`** — new, ~180 lines: `Deps`, `Installer`, `New`,
`Status`, `Result`, `Install`, the probe order, the outcome table, the bounded `Detail`. Doc
comments carry D11/D12's reasoning (why relative to `os.Executable()`, why the five probe paths,
why Insiders is not probed, why `--force`, why `installFailed` does not fall through to reveal).

**`apps/kira-studio/internal/gitvsix/exec.go`** — new, ~40 lines: the real `Run` (D13), the real
`LookPath`/`Stat`/`Executable` defaults, `gracefulStopDelay`.

**`apps/kira-studio/internal/gitvsix/install_test.go`** — new. The one Go test this phase adds,
against injected seams (no real `code`, no real VS Code):
- `code` on `PATH` → `installed`, and the recorded argv is exactly
  `[<codePath>, "--install-extension", <vsixPath>, "--force"]` — asserted element by element, which
  is the argv-only guarantee made checkable;
- a `.vsix` path containing a space survives as **one** argv element;
- `code` missing at every probe step → `revealed`, argv exactly `[<open>, "-R", <vsixPath>]`, and
  `Probed` lists all five candidates in order;
- `code` present but exiting non-zero → `installFailed`, `Detail` non-empty and single-line, and
  **no** reveal spawn recorded;
- reveal also failing → `revealFailed`;
- no `.vsix` beside the executable → `notBundled`, and **no spawn at all** recorded;
- a `code` candidate that exists but is not executable is skipped, not selected
  (`isExecutable`-equivalent behaviour).

**`apps/kira-studio/internal/bridge/gitclients.go`** — edited: the `GitVsix` interface, the `Vsix`
field, `VsixStatus()`/`InstallVsCodeIntegration()` and their wire projections (D14), following the
file's existing `toWire*` shape.

**`apps/kira-studio/main.go`** — edited: one line, `Vsix: gitvsix.New(gitvsix.Deps{})`, in the
existing `application.NewService(&bridge.GitClientsService{…})` literal at `:299`.

**Bindings must be regenerated** — `wails3 task common:generate:bindings` (or `scripts/setup.sh`).
`AGENTS.md` is emphatic that `-names` is load-bearing and that `frontend/bindings/**` are real Vite
import targets; two new bound methods without a regeneration fail the frontend build outright.

### 3.3 The extension

**`apps/kira-studio-vscode/package.json`** — edited (D2–D6, D15, D16, D17): identity fields,
`activationEvents`, `main` → `./dist/extension.cjs`, `exports` removed, `contributes.commands` grows
from 4 to 22 entries (17 mutating + `refresh`, plus the existing four, one of which gains an icon
and a new title), `contributes.menus.scm/title`, one new `contributes.configuration` property
(`kiraVersion.statusBar.enabled`).

**`apps/kira-studio-vscode/.vscodeignore`** — new (D4), with the comment F4 demands.

**`apps/kira-studio-vscode/LICENSE`** — new, a copy of the root `LICENSE` (D5).

**`apps/kira-studio-vscode/src/commands.ts`** — new (D17). Imports types from `@kira/git-ipc` only;
never imports `vscode`.

**`apps/kira-studio-vscode/src/commands.test.ts`** — new (D20).

**`apps/kira-studio-vscode/src/extension.ts`** — edited (D3, D16, D19): the table-driven
registration loop, the status-bar item and its `onStateChange`/configuration wiring. The existing
`showConnectionStatus`/`openRepository` handler functions are untouched.

**`apps/kira-studio-vscode/src/panelView.ts`** — edited (D19): `#pendingAction`, `runUiAction`, the
flush inside `resolveWebviewView`, and `renderHtml` gaining the pending action.

**`apps/kira-studio-vscode/src/html.ts`** — edited (D19): `RenderHtmlOptions.pendingAction`, and the
bootstrap island gaining `pendingAction: view === 'graph' ? (pendingAction ?? null) : null` — the
exact mirror of the existing `target` line.

**`apps/kira-studio-vscode/src/webview/main.ts`** — edited: `Bootstrap.pendingAction`, passed into
`mount()` on the graph branch.

### 3.4 `packages/git-ipc` and `packages/git-ui`

**`packages/git-ipc/src/contract.ts`** — edited: `UiActionKind` exported, `events['ui.action']`
added (D9).

**`packages/git-ipc/src/validate.ts`** — edited: `CONTRACT_VERSION = 17`, `EVENT_KEY_MAP` gains
`'ui.action': true` (D9).

**`apps/kira-studio/internal/gitrpc/contract.go`** — edited: `ContractVersion = 17`, its comment
noting the bump is a client-side event and that the server neither emits nor parses it (D9).

**`packages/git-ui/src/main.ts`** — edited: `MountOptions.pendingAction?: UiActionKind | null`,
passed to `AppRoot` (the exact shape `target` already has for `ReviewView`).

**`packages/git-ui/src/App.vue`** — edited, and this is the whole of the UI delta:
- one prop, `pendingAction`;
- one `bridge.on('ui.action', …)` subscription registered beside the existing ones and disposed the
  same way;
- one `runUiAction(action: UiActionKind)` dispatcher — a `switch` over `opsState` methods,
  `branchDialogState`/`tagDialogState`, `selection.sha.value`, and two `defineExpose`d toolbar
  methods;
- one call to it at mount when `props.pendingAction` is set.

**`packages/git-ui/src/components/AppToolbar.vue`** — edited: `defineExpose` grows from `{refresh}`
to `{refresh, openBranchPicker, fetch, pull, push, forcePush, cancelRemote}`, each a one-line
delegation to the existing `doFetch`/`doPush`/`doForcePush`/`doCancel`, the nested
`BranchPicker`'s `open`, and the nested `PullStrategyPicker`'s `runDefault`.

**`packages/git-ui/src/components/BranchPicker.vue`** — edited: `defineExpose({ open })`, two lines.

**`packages/git-ui/src/components/PullStrategyPicker.vue`** — edited:
`defineExpose({ run: runDefault })`, two lines.

No other file under `packages/git-ui` is touched. No component is added, removed, restyled or
restructured.

### 3.5 The Wails frontend

**`packages/shared/domain/git.ts`** — edited: `gitVsixStatusSchema` and
`gitVsixInstallResultSchema` beside the existing four, in the same style.

**`apps/kira-studio/frontend/src/bridge/index.ts`** — edited: `gitVsixStatus()` and
`gitVsixInstall()` beside the existing `gitClients*` calls (`:247-259`).

**`apps/kira-studio/frontend/src/state/gitClients.ts`** — edited: `vsix` on the reactive store,
fetched in `hydrateGitClients()`'s existing `Promise.all`, plus an `installVsCodeIntegration()`
action that re-reads the status afterward (an install can flip nothing, but a failure message must
be replaced on the next attempt).

**`apps/kira-studio/frontend/src/workbench/SettingsDialog.vue`** — edited: one block at the top of
the *Connected editors* branch (before the paired-client list at `:583`), rendering the button, the
outcome line and — when nothing was found — the probed paths. `data-testid`s on the button and the
outcome line. `pendingPatch`/`draft`/`isDirty` are untouched, exactly as G1 D16 requires of this
section.

**`apps/kira-studio/tests/ui/support/mockRuntime.ts`** — edited: two `CHANNEL_TO_FQN` entries and a
`gitVsixStatus` default (`{bundled:false,…}`), for the same reason G1's own entries exist —
`hydrateGitClients()` runs on every boot, so every existing `tests/ui/` spec would otherwise hit an
unmapped bound call at boot.

### 3.6 Docs

**`docs/ARCHITECTURE.md`** — the Stack table's Packaging row gains one clause: the `.dmg` also
carries `Contents/Resources/kira-version.vsix`, installed from the *Connected editors* pane.

**`docs/PACKAGING.md`** — §1 gains the `.vsix` step; §3/§5 gain S9/A6; §4's human checklist gains
the install walkthrough (§6.3 below is the source text).

**`AGENTS.md`** — no change. Nothing here is a standing rule about how the team works.

---

## 4. Commit order

- **C1** `build(vscode): package a real .vsix — manifest identity, CJS bundle, vsce`
  D1–D7: manifest fields, `.vscodeignore`, `LICENSE`, `main` → `.cjs`, `build-vscode.ts`,
  `package-vscode.ts`, root `package.json`, `bun.lock`. Provable on its own: `bun run
  package:vscode` produces a `.vsix` whose manifest carries a real publisher.
- **C2** `build(package): carry the .vsix inside the app bundle`
  D8, D21's S9/A6 and the release-workflow change. Taskfile + `verify-packaging.sh` + `release.yml`
  + `docs/PACKAGING.md`.
- **C3** `feat(gitvsix): locate and install the bundled .vsix, argv-only`
  D10–D13: the package and its test. No caller yet.
- **C4** `feat(settings): Install VS Code Integration in the Connected editors pane`
  D14: bridge methods, `main.go`, regenerated bindings, shared schemas, renderer store, the pane,
  `mockRuntime.ts`.
- **C5** `feat(ipc)!: ui.action, the palette's route into the existing webview — CONTRACT_VERSION 17`
  D9. Conventional Commits `!` because the wire contract changes: `contract.ts`, `validate.ts`,
  `gitrpc/contract.go` in one commit, so the two constants can never be seen apart.
- **C6** `feat(git-ui): expose the toolbar and picker actions, and dispatch ui.action`
  D17's UI half: `main.ts`, `App.vue`, three `defineExpose`s.
- **C7** `feat(vscode): a palette command for every mutating operation, plus the SCM and status-bar entry points`
  D15, D16, D17, D19: `commands.ts`, the manifest's commands/menus/configuration, `extension.ts`,
  `panelView.ts`, `html.ts`, `webview/main.ts`.
- **C8** `test(vscode): keep the palette table, the manifest and Go's opTable in agreement`
  D20: the test and `test:unit`'s new path. Last, so it is written against the finished table and
  its deliberate-removal proof (§6.1) is run at the end.
- **C9** `docs: the bundled .vsix and the install path` — `docs/ARCHITECTURE.md`, and any
  `docs/PACKAGING.md` text C2 did not already need.

C5 and C6 must land together in sequence: between them the contract declares an event nothing
handles, which typechecks but would be an incoherent tree to stop at. C7 depends on both.

---

## 5. What a reviewer should look at first

1. **`.vscodeignore`** — does it touch `dist/`, `.vite`, or anything starting with a dot? If yes,
   the webview is broken in a way no test catches (F4).
2. **The argv assertions in `install_test.go`** — element-by-element, including the space case. A
   test that asserts on a joined string would pass for a shell-based implementation.
3. **`CONTRACT_VERSION` in both languages in one commit** (C5). One without the other is a
   handshake that rejects every connection.
4. **`commands.test.ts`'s sanity guard** — without the "extracted set is non-empty and contains
   `checkout`" assertion, the whole enforcement mechanism can silently degrade to a no-op.
5. **`create:app:bundle`'s copy is before `codesign:adhoc`.** After it, the bundle's signature does
   not cover the `.vsix` and `codesign --verify --deep --strict` fails (N2).
6. **`App.vue`'s diff size.** If it is more than the prop, the subscription, the dispatcher and the
   mount-time call, `packages/git-ui` is being redesigned and the rule is being broken.

---

## 6. Exit criteria

Three tiers, per the SPEC's "Full verification scope, 2026-09-07" convention: what this container
proves, what needs a macOS builder but no judgement, and what needs a person at a Mac with VS Code.

### 6.1 Tier 1 — fully provable here, and expected green

| # | Proof | Command |
|---|---|---|
| a | `vsce package` succeeds and the artifact is real | `bun run package:vscode`; then `unzip -p apps/kira-studio/bin/kira-version.vsix extension.vsixmanifest \| grep Identity` shows `Publisher="kirathecat"` and `Id="kira-studio-vscode"` — **not `undefined`** (F2) |
| b | the `.vsix` carries what the runtime needs and nothing it does not | `unzip -l` lists `extension/dist/extension.cjs`, `extension/dist/ui/.vite/manifest.json`, `extension/dist/ui/assets/*`, `extension/resources/*`, `extension/package.json`, `extension/LICENSE`, and **no** `src/`, `tsconfig.json` or `node_modules/` |
| c | the bundle is CommonJS and purity-clean | `node -e "require('./apps/kira-studio-vscode/dist/extension.cjs')"` fails only on `Cannot find module 'vscode'` (proving it got as far as the host import), and `build-vscode.ts`'s own check passes |
| d | the palette audit's enforcement actually catches drift | delete `kiraVersion.fetch` from `contributes.commands` → `bun run test:unit` fails naming it; restore. Change one `MUTATING_COMMANDS` entry from a command to `{pending:'G13'}` → it fails naming the served kind; restore. Break the `opTable` regex's anchor → the sanity guard fails rather than the suite passing vacuously. **All three deliberate breakages must be run and their failure messages recorded in the phase's own commit message or report.** |
| e | the table is total over the contract | remove one key from `MUTATING_COMMANDS` → `bun run typecheck:git` fails; restore |
| f | the installer's decision structure | `go test ./apps/kira-studio/internal/gitvsix/...` — all seven cases in §3.2 |
| g | the git packages still pass under race | `go test -race ./apps/kira-studio/internal/{gitclient,gitclient/porcelain,gitclient/catfile,gitclient/logsession,gitpreflight,gitops,gitsession,gitrpc,gitsock,gitstore,gitwire,gitvsix,bridge,bridge/rpcstream} ./apps/kira-studio/internal` (SPEC's scoped set, plus this phase's new package) |
| h | nothing else moved | `bun run lint`, `bun run typecheck`, `bun run build`, `bun run build:vscode`, `bun run test:unit`, `bun run test:ui`, `bun run verify:packaging` (S9 passes; A1/A3/A5/A6/N2/N3 print "skipped" with no `.app` present) |
| i | the contract bump is complete | `grep -rn "CONTRACT_VERSION = 17" packages/git-ipc/src/validate.ts` and `grep -n "ContractVersion = 17" apps/kira-studio/internal/gitrpc/contract.go` both hit; `go test ./apps/kira-studio/internal/gitsock/...` still passes (its handshake tests read the constant, not a literal) |

### 6.2 Tier 2 — needs a macOS builder, no human judgement

Runnable unattended on a macOS runner (the release workflow's `macos-15`, or any Mac with the
toolchain). Nothing here needs a person to *look* at anything.

1. `bun run package` — `wails3 task darwin:package:dmg` must build the `.vsix` via the new
   `common:build:vsix` dep, `create:app:bundle` must copy it, and `sign-bundle.sh` must succeed.
2. `bun run verify:packaging` — with a real `.app` and `.dmg` present, **A6** must pass
   (`Contents/Resources/kira-version.vsix` exists, non-empty, `PK`-prefixed) alongside every
   pre-existing check, and **N2** (`codesign --verify --deep --strict`) must still pass with the
   new file inside the bundle.
3. `codesign -dv --verbose=2` on the `.app` still reports `Signature=adhoc` (A1).
4. A tagged dry run of `release.yml`'s version step: both `build/config.yml` and
   `apps/kira-studio-vscode/package.json` carry the tag, and S9 agrees.

**If (2)'s N2 fails, the copy landed after `codesign:adhoc`** — that is the one predictable way this
tier breaks, and it is a Taskfile ordering fix, not a design problem.

### 6.3 Tier 3 — needs a human on a Mac with VS Code

This is the first phase whose acceptance run installs a real extension rather than using
`--extensionDevelopmentPath`, which is the change from G8's own pre-ship script (`:1191`).

1. Mount the `.dmg`, drag to `/Applications`, clear quarantine, launch.
2. Settings → **Connected editors**. With `code` on `PATH`: the button reads **Install VS Code
   Integration**. Click it. Expect `installed` and VS Code's own "Completed installing extension"
   in its Extensions pane, under **Kira Version**, publisher `kirathecat`.
3. Rename `/usr/local/bin/code` aside and relaunch Kira Studio: the button now reads **Reveal
   Extension in Finder**, clicking it opens Finder with `kira-version.vsix` selected, and the
   probed-paths line names all five candidates. Restore.
4. **The activation question F5 exists for**: with the extension installed from the `.vsix` (not a
   development host), open a git repository. The Git Graph panel must render. If it does not, check
   VS Code's Extension Host log — this is the single scenario D6 exists to make safe, and it has
   never been observed on any build.
5. The **status-bar item** appears once the connection is up (D3's `onStartupFinished` is what makes
   it appear before the panel is ever opened — verify by checking the item is present in a fresh
   window with the panel never touched). Note where it sits relative to the built-in git item;
   toggle `kiraVersion.statusBar.enabled` off and confirm it disappears.
6. The **SCM title-bar button**: open the Source Control view, confirm the `$(git-branch)` action in
   its title bar opens the graph.
7. **The palette, exhaustively.** For each of the eighteen new commands, run it from a cold panel
   (hidden — proving the bootstrap-island arm) and again from an open panel (proving the event arm),
   and confirm it lands on the affordance the D17 table names. Specifically confirm: `Revert
   Commit…` with a selection reverts it and with none announces rather than silently no-ops;
   `Create Branch…` with no selection seeds `HEAD`; `Fetch`/`Pull`/`Push` behave identically to
   their toolbar buttons; `Cancel Remote Operation` cancels a running fetch.
8. **Two windows.** Install once; open two VS Code windows on two repositories. Both pair (the
   second queues behind the first's prompt). Run a palette command in each and confirm it acts on
   its own window's repository.
9. **Revoke** one from the *Connected editors* pane and confirm the status-bar item hides.

Steps 4, 5 and 7 are the ones that can only be answered here. Steps 8 and 9 re-run G8's own
walkthrough against an *installed* extension rather than a development host, which is the last
untested variable in the transport.

### 6.4 The checklist

- [ ] `vsce package` produces a `.vsix` whose `Publisher` is `kirathecat`, not `undefined`
- [ ] `.vscodeignore` excludes `src/`/`tsconfig.json` and touches nothing under `dist/`
- [ ] `dist/extension.cjs` is CommonJS, exports `activate`, contains no `Bun.`/`bun:`
- [ ] `apps/kira-studio/bin/kira-version.vsix` is produced by `bun run package:vscode` and by
      `wails3 task darwin:package:dmg` without a separate command
- [ ] `create:app:bundle` copies it before `codesign:adhoc`; `run` copies it conditionally
- [ ] `verify-packaging.sh` S9 and A6 exist and pass (S9 here, A6 on macOS)
- [ ] `gitvsix` spawns argv-only; the tests assert argv element by element, space included
- [ ] all five outcomes are reachable and rendered by the pane; none is an error return
- [ ] the probe order matches D12 exactly and `Probed` is populated on every path
- [ ] `CONTRACT_VERSION` is 17 in TypeScript and Go, in one commit
- [ ] `MUTATING_COMMANDS` is total over `OpRequest['kind'] | RemoteOpParams['kind'] | 'undo' | 'cancel'`
- [ ] every served kind has a command; every unserved kind names its phase
- [ ] `commands.test.ts` fails on all three deliberate breakages in §6.1(d), with the messages recorded
- [ ] `activate()` registers from the table, with no hand-written second list
- [ ] `packages/git-ui`'s diff is the prop, the subscription, the dispatcher, the mount call and
      three `defineExpose`s — nothing else
- [ ] bindings regenerated; `tests/ui/` still green
- [ ] `docs/ARCHITECTURE.md` and `docs/PACKAGING.md` updated

---

## 7. Sequencing

**One Sonnet subagent, sequential.** The work is a single chain: the manifest must be packageable
before the Taskfile can carry the artifact, the artifact must exist before the Go installer has
anything to find, the contract must change before the UI can dispatch, and the enforcement test must
be written against the finished table. There is no genuinely independent slice worth splitting, and
the two places that look parallel (the Go installer and the palette audit) both terminate in
`extension.ts`/the pane and would collide.

Estimated shape: C1–C2 are the riskiest to get *quietly* wrong (F4's ignore trap, the codesign
ordering) and the cheapest to verify; C5–C7 are the largest diff; C8 is short but must be run with
its deliberate breakages rather than assumed.

Per `AGENTS.md`: implement the whole plan, then run the expensive verification once (§6.1(g)/(h))
and land fixes as follow-up commits. Fast checks (`typecheck:git`, `lint`, `build:vscode`) per
commit.

---

## 8. Explicit non-goals

| Not this phase | Where it lives |
|---|---|
| Marketplace/OpenVSX publishing, `vsce publish`, gallery metadata beyond identity | SPEC "Out of scope for v1.3", permanently |
| Notarization, Developer ID | `docs/PACKAGING.md` §7, unchanged |
| Auto-update of the extension | no updater anywhere in this app (S1/S2) |
| Palette commands for stash / reset / cherry-pick / tag push / search | G13, G14, G15 — each registers its own, checked by D20's test |
| Branch + ahead/behind in the status-bar item | D16; §9 |
| A native tree/quickpick replacement for any part of the graph | SPEC "Out of scope" |
| `review.db`, blob snapshots, AI comments | G11, G12 |
| Serving `tagPush`/`tagDeleteRemote` | G14 (F9's renumbering; G7 handed them forward) |

---

## 9. Handed forward

- **`kiraVersion.statusBar.enabled` is host-only** and deliberately outside `SettingsSnapshot`
  (D16). If a later phase wants the webview to know about it, that is a contract change with its
  own justification, not a mechanical addition.
- **Branch/ahead-behind in the status bar** (D16) needs the extension host to hold head state. The
  cheapest honest route, if it is ever wanted, is a new field on `repo.changed` rather than a poll —
  which is a contract change, so it belongs to a phase that is already making one.
- **`ui.action` grows by union member.** G13/G14/G15 each add their served kinds' commands: a table
  entry, a `UiActionKind` member, a manifest entry, a `case` in `App.vue`'s dispatcher, and a
  `CONTRACT_VERSION` bump. D20's test is what will tell them.
- **`gitsession/ops.go:64`'s comment is stale** (F9) and should be corrected by whichever phase next
  touches `opTable`, to the corrected numbering.
- **The `.vsix` is not versioned in its filename** (D8). If a future phase ever wants to ship two
  side by side, that is the thing to change, and the Go-side path constant is the one place to
  change it.
- **`build:vscode` is still out of `bun run build` and `scripts/setup.sh`** (D8, preserving G3 D20).
  A future phase that adds an automated test *loading the built extension* would be the first with a
  real reason to revisit that.

---

## 10. Two things that want a human call, not an engineering one

### 10.1 The publisher id, and whether the extension should be renamed

D2 picks `publisher: "kirathecat"` and keeps `name: "kira-studio-vscode"`, giving the installed id
`kirathecat.kira-studio-vscode` and the displayed name **Kira Version**. Those are defensible but
they are *product* choices: the id is what a user sees in `code --list-extensions`, what any future
marketplace listing would have to match, and — if a publisher account is ever registered — a name
that must be available. Renaming later is a real migration (a user ends up with two installed
extensions). Worth a nod before C1 lands, not because the engineering is uncertain but because it
is the one string in this phase that is expensive to change afterwards.

### 10.2 Five palette commands share one action

D17 maps `Checkout…`, `Delete Branch…`, `Rename Branch…`, `Delete Tag…` and `Delete Remote Branch…`
onto `openBranchPicker`, because the picker is the only place the existing UI names a ref to act on
and building a per-operation native quickpick is the redesign SPEC forbids. The engineering is not
in question; the judgement is whether five palette entries that open the same panel read as
thorough or as padding. The alternative is a single `Branches & Tags…` command, which D20's test
would accept just as happily (a shared command still satisfies "every served kind has a command").
The plan takes the five-entry route on the strength of SPEC's own wording ("a command for every
mutating operation") and of a palette being a search surface, and flags it here rather than
pretending the question does not exist.
