# P103 — share the identical app base between Kira Studio and Kira Space

Plan for `docs/v1.9/SPEC.md`'s P103 row. P100 split one app into two and duplicated the base; this
phase makes the duplicated base one copy.

Scope here is **larger than the P103 row's own list**. The row named seven workbench components,
the tab-kind registry, `SettingsDialog.vue`, `bridge/*`, `internal/shell` and `model.Settings`. A
full sweep of both apps' `frontend/src`, `tests/` and `internal/` trees (§1.1) found 34 more
files duplicated byte-for-byte or code-for-code that the row never names, including a whole Go
package (`internal/terminal`, 751 lines, two real differences). The user's own instruction covers
them: "research and try to modularise and extract as much shared parts as possible on both
frontend and backend."

---

## 0. What SPEC leaves open, and how each is resolved

| Open question | Resolution |
|---|---|
| P100 §5.2 **declined** hoisting `packages/workbench`. Does P103 overturn that? | It completes it. §5.2's two named reasons were (a) cost — reopening P99's 48 converted files for one-and-a-third consumers, (b) "the state layer is not shareable as-is … parameterizing the kind registry and the bridge surface, a redesign this phase's own scope explicitly is not." (b) *is* P103's mandate, stated by P100 itself. (a) is paid once here, immediately before P104 reopens the same files anyway. §2 restates this as a scope decision, not an assumption. |
| The row says Kira Space's `internal/shell` "is trimmed … Kira Studio's has a per-window flush handshake" | **Factually stale post-Part-2.** `shell/quit.go` and `shell/closeflush.go` differ by exactly one line each — the `bridge` import path (§1.8). Kira Space has the full per-window flush handshake. The row's other claims (`Dialogs`, `AttachSystemWake`, fuller menu) still hold. §3.1 corrects the row. |
| The row says `SettingsDialog.vue` splits into "a shared shell (layout, **search**, nav chrome)" | **Neither app has settings search today** (`grep -n "search" ` on both files: zero hits, §1.6). Building one is a new feature, not a dedup. Declined, named: P103 shares the chrome that exists. |
| `Advanced.GitLogLevel` as a shared-base field — one `string`, against a Wails binding-shape risk | Kept per the row, but gated: §7.2 gives a concrete regenerate-and-diff procedure and a named fallback (share the validator, declare the leaf per app) if the generated models change shape. |
| Is this one pass or several? | Four parts (§3). Measured: ~3,800 lines of verbatim-shareable code plus six genuinely parameterized subsystems across two languages. |

---

## 1. Confirmed current state

### 1.1 Method

Three sweeps, all re-runnable:

1. **Same relative path, both apps** — every file under `frontend/src`, `tests/` and `internal/`
   present at the same path in both apps, diffed. 42 + 10 + 42 common paths.
2. **Comment-blind diff** — the same pairs with block comments, line comments and trailing `//`
   tails stripped, then diffed. This is what separates "same code, different prose" from real
   divergence. Numbers below are reported as `raw` / `code`.
3. **Content hash, whole tree** — `md5sum` over every `.ts`/`.vue`/`.go`/`.css`/`.sql` in both
   apps, grouped by hash. This catches the pairs the path sweep misses, and did: two files
   byte-identical at *different* paths (§1.2).

Two files this sweep measured — `apps/kira-studio/tests/ui/support/{ipcChannels,mockRuntime}.ts` —
were uncommitted working-tree edits from the parallel P100 Part 4 pass at measurement time. Their
numbers below are approximate; re-measure them against Part 4's landed commit before Part 1 acts
on them. Every other number is against committed content.

### 1.2 Tier A — byte-identical, still two copies

`diff` is empty. Nothing to design; these are a move.

**Frontend — 17 files, 1,644 lines** (line counts are one copy, not the sum):

| File (Kira Studio path) | Lines | Note |
|---|---|---|
| `workbench/ContextMenu.vue` | 399 | P104 reworks its internals *after* this phase |
| `workbench/state/tooltip.ts` | 328 | the tooltip singleton + `v-tooltip` directive |
| `editor/monacoTheme.ts` | 173 | |
| `editor/monacoEntry.ts` | 134 | |
| `workbench/AppTooltip.vue` | 130 | P104 reworks its internals after this phase |
| `views/terminal/terminalRenderer.ts` | 124 | **path sweep missed this** — Kira Space has it at `views/repo/terminalRenderer.ts` |
| `workbench/contextMenuKeys.ts` | 92 | |
| `workbench/ConfirmDialog.vue` | 52 | |
| `env.d.ts` | 48 | |
| `state/confirmDialog.ts` | 34 | |
| `editor/monarch/mongo.ts` | 28 | |
| `editor/monarch/redis.ts` | 26 | |
| `editor/monarch/decorators.ts` | 21 | |
| `state/queryClient.ts` | 21 | |
| `views/terminal/terminalRendererLoader.ts` | 15 | **path sweep missed this** — `views/repo/` in Kira Space |
| `state/tabRuntime.ts` | 14 | |
| `state/pinia.ts` | 5 | |

**Go — 10 files, 997 lines:**

| File | Lines |
|---|---|
| `internal/terminal/session.go` | 407 |
| `internal/terminal/session_test.go` | 285 |
| `internal/shell/registry.go` | 110 |
| `internal/shell/debounce.go` | 38 |
| `internal/storage/model/time.go` | 32 |
| `internal/shell/security.go` | 28 |
| `internal/config/env.go` | 22 |
| `internal/config/prod.go` | 9 |
| `internal/config/prod_default.go` | 7 |
| (`internal/terminal/shell.go` is Tier B — 59 lines, 2 real differences) | |

**Tests — 4 files, 269 lines:** `tests/unit/support/{wailsRuntime.ts (115), fakeSocket.ts (113),
restoreAfterEach.ts (21)}`; `tests/unit/support/window.ts` (20) is comment-only-divergent.

### 1.3 Tier B — code-identical or near, prose diverges

Every Kira Space copy carries a "Kira Studio's own X, ported verbatim" header where Kira Studio
carries the original historical rationale. That prose is the whole `raw` diff in six cases.

**Frontend:**

| File | Lines | raw | code | Real difference |
|---|---|---|---|---|
| `bridge/rpc.ts` | 85 | 47 | **0** | none — `unwrap`/`on`/`trust`/`windowKey`, identical |
| `shortcuts/keys.ts` | 66 | 12 | **0** | none |
| `state/window.ts` | 17 | 17 | **0** | none |
| `shortcuts/commands.ts` | 18 | 10 | **0** | none |
| `wheelScroll.ts` | 14 | 8 | **0** | none |
| `clipboard.ts` | 12 | 12 | **0** | none |
| `bridge/control.ts` | 10 | 14 | 1 | Studio also re-exports `unwrap` |
| `theme/floatingPosition.ts` | 114 | 22 | 2 | Studio also re-exports `autoUpdate` |
| `state/terminals.ts` | 238 | 2 | 2 | `canonicalPath` imported from `@shared/domain/path` vs `./coderepos` |
| `state/terminalTabs.ts` | 48 | 27 | 4 | `workspaceId: AppMode` vs `workspaceId: WorkspaceKey` |
| `format.ts` | 29 | 20 | 5 | Kira Space dropped `formatBytes`; its own comment calls it "a plain dedup candidate, no app-specific coupling" |
| `editor/monaco.ts` | 139 | 19 | 10 | Kira Space's own header already flags this file and its four neighbours as duplicated |

**Go:**

| File | Lines | raw | code | Real difference |
|---|---|---|---|---|
| `internal/bridge/lifecycle.go` | 41 | 17 | **0** | none |
| `internal/bridge/link.go` | 37 | 16 | **0** | none |
| `internal/buildinfo/buildinfo.go` | 17 | 15 | **0** | none — but **declined**, see §2 |
| `internal/shell/closeflush.go` | 170 | 106 | 2 | the `bridge` import path, nothing else |
| `internal/shell/quit.go` | 141 | 64 | 2 | the `bridge` import path, nothing else |
| `internal/terminal/shell.go` | 59 | 4 | 4 | `buildinfo` import path; `TERM_PROGRAM=Kira Studio` vs `Kira Space` |
| `internal/bridge/tabs.go` | 55 | 8 | 4 | import paths only |
| `internal/bridge/layout.go` | 37 | 13 | 4 | import paths only |
| `internal/storage/db.go` | 59 | 38 | 4 | `config.KiraHome()` vs `config.KiraSpaceHome()` |
| `internal/storage/migrate.go` | 30 | 16 | 2 | migrations import path |
| `internal/bridge/settings.go` | 53 | 27 | 7 | Studio's `Router.PushCacheConfig` side effect |
| `internal/storage/model/window.go` | 61 | 39 | 9 | Studio carries `Mode`/`NormalizeMode`; Kira Space has no app-mode concept |
| `internal/config/paths.go` | 52 | 41 | 10 | env var, dir name — already parameterized through repo-root `internal/kirapaths` |
| `internal/shell/window.go` | 238 | 114 | 14 | one string: `Title: "Kira Studio"` vs `"Kira Space"` |
| `internal/shell/menu.go` | 83 | 36 | 17 | Studio's `ItemEmit` kind + `IsDev`/`Events` on `MenuDeps` |
| `internal/appcore/deps.go` | 59 | 64 | 21 | `Emitter` identical (3 methods); `Deps` genuinely per-app |
| `internal/shell/menutemplate.go` | 121 | 86 | 46 | `Section`/`Item`/`ItemKind` vocabulary shared; template content per-app |
| `internal/bridge/events.go` | 182 | 189 | 95 | `Events` core (`Signal`/`SignalTo`/`Broadcast`/`NewEvents`) identical; channel constants and `Attach` per-app |

**Tests:** `tests/ui/support/server.ts` (82 / raw 8 / **code 0**), `tests/ui/fixtures.ts`
(102 / raw 39 / code 8), `tests/ui/support/bootSnapshots.ts` (47 / raw 43 / code 16).

### 1.4 The workbench components: measured divergence

| Component | Studio | Space | code-diff | What actually diverges |
|---|---|---|---|---|
| `ContextMenu.vue` | 399 | 399 | 0 | nothing |
| `AppTooltip.vue` | 130 | 130 | 0 | nothing |
| `ConfirmDialog.vue` | 52 | 52 | 0 | nothing |
| `panels/MainView.vue` | 31 | 31 | 24 | `TAB_VIEWS` lookup + workspace-key source |
| `WorkbenchShell.vue` | 145 | 110 | 42 | Studio has an Operations dock row in the grid and a `MODES` panel registry; Kira Space hardcodes `<GitPanel/>` and adds a local `keydown` binding |
| `TitleBar.vue` | 276 | 90 | 114 | the action buttons. The bar chrome (`.title-bar`/`.title-bar-actions`/`.title-action`, the `--wails-draggable` regions, the Settings teleport) is the same |
| `panels/TabStrip.vue` | 481 | 367 | 155 | which store supplies the active workspace key; `TAB_KINDS` indexing; per-app extras (incognito, agent-attention badge, seti file icons) |
| `StatusBar.vue` | 215 | 74 | 171 | the items. The bar chrome (`.p-statusbar`/`.side`/`.p-status`) and the left caret-status slot are the same |
| `SettingsDialog.vue` | 1,776 | 713 | ~1,090 | the panes. The frame, nav and the whole dirty/patch/reset engine are the same (§1.6) |

### 1.5 The tab layer: one shared union is forcing stubs in *both* apps

`packages/shared/domain/tabs.ts` declares one 16-member `tabKindSchema` covering both apps. Neither
app can render all 16, so **both** carry stubs for the other's kinds:

- Kira Studio `state/tabKinds.ts:173` — `unreachableTabKind<K>(kind)`, every member throwing
  `` `kira: tab kind "${kind}" belongs to Kira Space, never opened here` ``, registered for the
  four `repo-*` kinds. `workbench/tabViews.ts` pairs it with a `NeverRenderedTabView` entry.
- Kira Space `state/tabKinds.ts:38` — a narrower `SpaceTabKind` alias plus a documented cast
  (`state/tabs.ts:21`, `kindDef`) at every `TAB_KINDS[tab.kind]` index, because `TabRecord.kind` is
  wider than the registry.

Go mirrors the same defect in both directions: `apps/kira-studio/internal/storage/model/tabs.go`'s
`RenderableTabKinds` still lists `repo-graph`/`repo-file`/`repo-diff`/`repo-multi-diff`
(lines 49-57) which Kira Studio can no longer produce; Kira Space's own copy lists only its five.
`apps/kira-studio/tests/unit/go-ts-vocabulary-parity.spec.ts` passes today only because it compares
the shared 16-member TS list against Kira Studio's equally-wrong 16-member Go list. Nothing checks
Kira Space's five against anything.

Real vocabularies, confirmed against each app's `TAB_KINDS`/`TAB_VIEWS`:

- Kira Studio, 12: `data`, `definition`, `console`, `document`, `keyvalue`, `stream`, `browse`,
  `http-request`, `grpc-request`, `variable-set`, `environments`, `terminal`.
- Kira Space, 5: `repo-graph`, `repo-file`, `repo-diff`, `repo-multi-diff`, `terminal`.
- Shared: `terminal` only.

`state/tabs.ts` (981 vs 526) shares a real skeleton — `persistableTabs`, `saveIfChanged`, the
`saveNow`/`flushPendingTabState` pair and its two `control.on*` registrations, `setActiveTabId`,
`removeFromPreviewCohort`, `evictPreviewCohort`, `reuseExistingTab`, `insertNewTabRecord`,
`openTab`, `duplicateTab`, `closeTabInternal`, `closeTab`, `closeOthers`, `closeToTheRight`,
`closeAll`, `activateTab`, `moveTab`, `stepTab`, `isPreview`, `promoteTab`, `patchChanged`,
`patchTabState` — over one axis of real divergence: the workspace key is `AppMode` in Kira Studio
and `WorkspaceKey` (a bare repo id, or `GENERAL_WORKSPACE`) in Kira Space. Everything else is
per-kind typed sugar (`openDataTab`, `patchRepoFileTabState`, …) or Studio-only features
(incognito filtering, the `hydrated` reconnect gate, `onConnectionsChanged`/`onConnectionState`).

### 1.6 `SettingsDialog.vue`: no search exists; the engine is what's shared

Confirmed shared, line for line: the `<DialogFrame>` wrapper with its `#header`, the
`nav.section-list` button loop driven by `sections`/`activeSection`, the `section.section-pane`
body, and the whole edit engine — `cloneSections`, a frozen `baseline`, a reactive `draft`,
`valuesEqual`, `diffSection`, `pendingPatch`, `isDirty`, `isValid`, `isAtDefault`, `resetLeaf`,
`onDismiss` (with its `confirmDialogStore` discard guard), `saveError`, and the `.field`/
`.field-head`/`.helper-text`/`.field-error`/`.sec-label`/`.section-subhead` style vocabulary.

Diverging: which sections exist (`state/settings.ts`'s `sections` tuple — Studio 8, Kira Space 4)
and every pane's contents. `grep -n "[Ss]earch"` returns **zero hits in either file**.

### 1.7 `bridge/*`: 20 methods already identical across 7 services

`bridge/rpc.ts` is code-identical (§1.3). Intersecting the two `control` object literals by key:

**Shared, 20 methods** — `settingsGetAll`, `settingsSet`, `onSettingsChanged`, `layoutGetAll`,
`layoutSet`, `onLayoutChanged`, `tabsList`, `tabsSave`, `onFlushBeforeClose`, `appFlushed`,
`onWindowFlushBeforeClose`, `windowFlushed`, `terminalOpen`, `terminalWrite`, `terminalResize`,
`terminalClose`, `terminalDefaultCwd`, `onTerminal`, `filesChooseFolder`, `linkOpenExternal` —
over `SettingsService`, `LayoutService`, `TabsService`, `LifecycleService`, `TerminalService`,
`FilesService`, `LinkService`. Bodies compared: identical, including the `?? []` nil-guards and
the `trust<T>` narrowings.

Kira Studio: 114 methods over 24 binding modules. Kira Space: 44 over 11. Each app's `@bindings/*`
alias points at its own generated directory, so the *modules* differ while the call shapes do not.

### 1.8 `internal/shell`: the row's claim is stale

`quit.go` (141 lines) and `closeflush.go` (170) differ by **one line each** — the `bridge` import
path. Kira Space has the full per-window flush handshake, `Quitter`, `CloseFlushCoordinator` and
both ack seams. The row's remaining claims hold: Kira Studio's `app.go` has `EmitTo`/`EmitFocused`
doc weight, a three-panel `dialogs` (`SaveFile`/`OpenFile`/`OpenDirectory` vs Kira Space's
`OpenDirectory` only), `AttachSystemWake`, and `RegisterEngineStream` where Kira Space has
`RegisterGitStream`; `menu.go`/`menutemplate.go` carry Studio's `ItemEmit` kind and a fuller
template.

What blocks a naive hoist, precisely: `quit.go`/`closeflush.go`/`menu.go` reference
`*bridge.Events` and `bridge.Channel*`; `window.go` references `repos.WindowsRepo` and
`model.WindowRecord`; `app.go` references `bridge.Dialogs`/`bridge.SaveFileRequest`/
`bridge.OpenFileRequest`/`bridge.Browser`/`appcore.Emitter`. All are `apps/*/internal/…`, which
repo-root `internal/` cannot import — the same rule P100 Part 1 already fought (§1.3 there).

### 1.9 `model.Settings`: the base, and the TypeScript mirror problem

`AppearanceSettings` (7 fields) and `GitSettings` (4 fields) are identical in both apps' Go, field
for field and tag for tag. `AdvancedSettings` shares exactly one leaf, `GitLogLevel`; Kira Studio
adds `OpLogRetentionDays`/`ExpensiveQueryRows`. `Settings` is 8 sections in Kira Studio, 3 in Kira
Space. The validators `ValidRowDensity`, `ValidDateFormat`, `ValidLogLevel`, `InRange` and the
`validateAppearanceSection`/`validateGitSection` bodies are identical.

`storage/repos/settings.go` (352 vs 194, code-diff 164) shares `upsertAppearanceSection`,
`upsertGitSection`, `upsertSettingsLeaf` and — Studio-side only, but generic —
`leaf[T]`/`leafValid[T]`/`alwaysValid`. The per-app part is which sections `GetAll`/`Set` compose.

**The TypeScript side has the same defect as the tab union.**
`packages/shared/domain/settings.ts`'s `settingsSchema` declares all **8** Kira Studio sections.
Kira Space's `state/settings.ts` types its whole store as that `Settings`, so every Kira Space
window holds `data`/`cache`/`api`/`dbMcp`/`claudeCode` state its Go backend never sends — filled
in by each section's own `z.default()`. Splitting the Go struct without splitting this schema
leaves the asymmetry in place.

One observation, **named and not acted on**: Kira Studio's `Git` section is vestigial — P100 Part
1's result records that `GitSettings` could not be removed from Kira Studio's Go because
`packages/shared/domain/settings.ts` and `SettingsDialog.vue` still mirror it. The P103 row lists
`Git` as a field "both apps carry", so this plan keeps it in the shared base and does **not**
remove it from Kira Studio. Splitting the shared schema (§7.3) is what would finally make that
removal a one-commit change; it is the user's call whether to schedule it, not this plan's to
fold in.

### 1.10 `internal/terminal`: a whole package, two real differences

751 lines across three files. `session.go` (407) and `session_test.go` (285) are byte-identical.
`shell.go` (59) differs in two lines: the `buildinfo` import path, and
`"TERM_PROGRAM=Kira Studio"` vs `"TERM_PROGRAM=Kira Space"`. Nothing else in either app's PTY
layer diverges. The row never mentions this package.

### 1.11 Already shared — do not re-propose

- **Repo-root `internal/`**: `ipcerr`, `kirapaths`, `logging`, `notify`, `pathsafe`, `rpcstream`,
  `sqlitex`, `startupfail` (P100 Part 1). `config/paths.go`'s remaining per-app wrapper is
  `kirapaths` already parameterized correctly; `storage/migrate.go` already delegates to `sqlitex`.
- **`packages/theme`** (`@theme/*`): `tokens.css`, `base.css`, 18 `components/ui/*`, 12
  `primitives/*`, `lib/utils.ts`, `stickyBand.ts`, `connColor.ts`, `wrapSelection.ts`,
  `CodiconIcon.vue` — 122 files, P100 Part 2, the P103 row's own byte-identical tier.
- **`packages/shared`**, `packages/git-core`, `git-ipc`, `git-ui`, `kira-ui`, `api-core`.

---

## 2. Scope decision

### 2.1 Shared verbatim

Everything in §1.2 and §1.3 whose code-diff is 0, plus the pairs whose only divergence is an
import path or a single app-name string, parameterized by one argument:

- **Frontend, 17 Tier-A files + 12 Tier-B files** → `packages/workbench` (§4.1).
- **Test support, 7 files** → `packages/workbench/testing` (§4.5).
- **Go `internal/terminal`, 3 files** → repo-root `internal/terminal`, with `TERM_PROGRAM` and the
  version string passed in (§6.1).
- **Go `internal/shell`'s generic half** — `registry.go`, `debounce.go`, `security.go`, `quit.go`,
  `closeflush.go`, `window.go`, `menu.go`, plus `menutemplate.go`'s type vocabulary → repo-root
  `internal/shell` (§6.3).
- **Go `bridge.Events`' core and the shared channel constants** → repo-root `internal/appevent`,
  together with `appcore.Emitter` (§6.2).
- **Go `storage/model/time.go`, `config/{env,prod,prod_default}.go`** → repo-root (§6.4).
- **Go `bridge/{lifecycle,link}.go`** — code-identical, but see §2.3.

### 2.2 Parameterized

| Subsystem | Parameter |
|---|---|
| tab-kind registry (§5.1) | each app declares its own kind union, state schemas and `TabKindDef` map; `packages/workbench` owns only the generic types and the machinery |
| `state/tabs.ts` (§5.2) | a `WorkspaceKey` type parameter plus a small host config; per-kind sugar stays in the app |
| `state/{layout,settings,contextMenu,terminals,terminalTabs}.ts` (§5.3) | store factories taking the app's own section/panel vocabulary |
| `WorkbenchShell`/`TitleBar`/`StatusBar`/`TabStrip`/`MainView` (§5.4) | named slots + a provided `WorkbenchHost` |
| `SettingsDialog.vue` (§5.5) | a shared `SettingsShell.vue` owning frame/nav/dirty-engine; each app slots its panes |
| `bridge/*` (§5.6) | `createCoreControl(bindings)` over a structural bindings interface |
| `internal/shell` (§6.3) | `Config`, a `Signaller` interface, a `WindowStore` interface, plain-parameter dialog helpers |
| `model.Settings` (§7.2) | shared `Appearance`/`Git` section types + shared validators; each app composes its own `Settings` |

### 2.3 Declined, with the requirement named

| Candidate | Why not |
|---|---|
| `internal/buildinfo` (code-identical, 17 lines) | `Version` is set by `-ldflags "-X <module path>/internal/buildinfo.Version=…"` from **each app's own** `build/darwin/Taskfile.yml`. One shared package means one symbol, so the two apps could not carry different versions. Kira Space's own file already records this decline; it stands. |
| `internal/config/paths.go` | Already parameterized — the mechanism is repo-root `internal/kirapaths`; what remains is three literals (`KIRA_HOME`/`.kira-studio`/`kira.db`) and their package-level accessors. A shared wrapper over three literals is indirection, not reuse. |
| `internal/storage/migrations/embed.go` | `//go:embed *.sql` resolves only within its own package directory. The migration *lists* are genuinely different sets of files. The runner is already shared (`internal/sqlitex`). |
| `internal/bridge/{lifecycle,link}.go`, `tabs.go`, `layout.go` — hoisting the **service structs** | A bound Wails service's parameter and return types drive binding generation and therefore the frontend's `@bindings/*` import paths. Moving a bound service out of `apps/*/internal/bridge` moves its generated module. The win is 170 lines; the cost is a frontend import-path change in both apps plus a `verify:packaging` surface. Their *shared dependencies* (`appevent`, the settings model) are hoisted instead, which removes the duplication that matters. Re-open only if a later phase already moves bindings for another reason. |
| `main.ts` (code-diff 224) and `App.vue` (code-diff 80) | Genuinely per-app composition roots: different store sets, different boot ordering, different dialog rosters. The one shared fragment is ~12 lines of `createApp`/`pinia`/`VueQueryPlugin`/`initTooltips`/`mount`. A factory over that is longer than the code it replaces. |
| `packages/kira-ui` as a primitive layer | P100 §5.2's decline is unchanged: it is `git-ui`'s primitive layer (72 `KuiButton` callers, all inside `packages/git-ui`, zero from a Wails app) and has no Tailwind build, which `CLAUDE.md`'s P98 rule requires of a new UI surface. |
| A settings **search** box | Does not exist in either app (§1.6). Building one is a feature, not a dedup. |
| A new `TitleAction.vue` / `StatusItem.vue` button primitive | Would be a **new hand-rolled primitive** — exactly what P104 exists to delete. §5.4 shares the bar chrome and leaves each app's `<button>` markup in the app, where P104 swaps it for shadcn-vue's `Button` once. |
| Reworking `ContextMenu.vue` / `AppTooltip.vue` internals | P104's job. P103 moves them **as they are**, hand-rolled internals intact, so P104 opens one shared copy instead of two. |
| `apps/kira-studio-vscode`'s own frontend | Not an app base; out of the row. |

### 2.4 Out of scope, confirmed not forgotten

- **No behaviour change.** Every gate this phase touches must produce the same UI and the same
  wire traffic. The three exceptions are removals of code that already cannot run — the tab-kind
  stubs (§5.1), Kira Studio's unreachable Go `RenderableTabKinds` entries (§5.1), and Kira Space's
  unused settings sections (§7.3) — each with its own commit and its own reasoning.
- **Kira Space has no `WindowsService`** (P100 Part 2's result). §6.3's `WindowStore` interface is
  written so that stays true; adding one is a feature, not this phase's.
- **P104** owns primitive replacement and the Tailwind spacing scale. **P101** owns a11y.
  `biome.json`'s `**/*.vue` a11y override stays; the new package's `.vue` files land under it.
- **P102** owns the root dependency split.
- Kira Space registering the `kira-mongo`/`kira-redis` grammars it has no consumer for
  (`monacoEntry.ts`'s lazy registration, §1.2) is a real but separate bundle question. The files
  are genuinely referenced, so this is not dead-code removal; named here, not acted on.

---

## 3. Split decision: four parts, `P103 Part 1` … `Part 4`

**A split is necessary.** Measured: ~3,800 lines move verbatim across two languages; six
subsystems need real parameterization (tab registry, tab store, workbench components, settings
dialog, bridge surface, Go shell); two new frontend build wirings and four new Go packages; and
two vocabulary splits (`TabKind`, `settingsSchema`) that each touch Go, TypeScript and a parity
test at once. One cold subagent pass cannot hold that, and a pass that runs out of room mid-way
leaves a tree where neither app builds.

Per `CLAUDE.md`, an **agent-decided** split keeps the number: `P103 Part 1:` … `P103 Part 4:`,
never a fresh `P`.

| Part | Scope | Gate at its end |
|---|---|---|
| **Part 1 — `packages/workbench`, verbatim tier** | Package stood up and wired (vite alias, tsconfig paths + include, knip block, root workspace, Tailwind `@source`); §1.2/§1.3's 29 frontend files and 7 test-support files moved; both apps' copies deleted | `bun run typecheck`, `lint`, `lint:dead`, `build`, `build:space`, `test:unit`, `test:ui`, `test:ui:space`, `test:visual` |
| **Part 2 — the parameterized frontend** | `TabKind` union split; tab store/registry factories; the five workbench components; `SettingsShell.vue`; `createCoreControl`; the four store factories | the full suite (§9), both apps' UI suites, visual baselines accounted for |
| **Part 3 — the Go shell hoist** | repo-root `internal/terminal`, `internal/appevent`, `internal/shell`; each app's `internal/appshell` residue; `model/time.go` + `config/{env,prod,prod_default}.go` | `go build ./...`, `go vet`, `lint:go`, `test:go` incl. both `layering_test.go`, both binaries boot |
| **Part 4 — Go settings composition + audit** | repo-root `internal/appsettings`; both `model.Settings` recomposed; both `repos/settings.go` recomposed; `settingsSchema` split; the §10 audit | §9 in full plus §10 |

**Why this order.** Parts 1-2 land the frontend dedup first because **P104 is sequenced directly
after P103 and only depends on the frontend half** — if a part runs long, the P104-critical work
is already in. Part 1 is mechanical and creates the package Part 2 then fills; Part 2 must not be
the pass that also invents the build wiring. Part 3 is Go-only and independent of 1-2, so it
cannot be blocked by them. Part 4 depends on Part 3 only for `internal/appevent` (its
`bridge/settings.go` touch) and carries the audit, so it goes last.

**No parallel fan-out.** One sequential subagent per part. Parts 1→2 and 3→4 are order-dependent
by construction; 2→3 is ordered by `CLAUDE.md`'s one-phase-at-a-time rule, not by a data
dependency.

### 3.1 `SPEC.md`

This plan's own commit makes two edits to `docs/v1.9/SPEC.md`, both confined to the P103 row and
neither touching any `## P100 Part N result` section:

1. **Split** the single P103 row into `P103 Part 1:` … `P103 Part 4:`, each pointing at this file
   and at its own section here. Nothing is renumbered; P104, P101 keep their numbers and order.
2. **Correct two facts** the row states: that Kira Space's `internal/shell` lacks the per-window
   flush handshake (§1.8 — it has it, the two files differ by an import path), and that
   `SettingsDialog`'s shared shell includes "search" (§1.6 — neither app has one). Both
   corrections are stated as corrections, with the evidence, not silently rewritten.

The row's **scope is widened**, not narrowed: every item it names stays in, and the files of
§1.2/§1.3 it never named are added.

---

## 4. Part 1 — `packages/workbench`, the verbatim tier

### 4.1 Where it lives and how it is consumed

`packages/workbench/`, consumed through a **vite alias + tsconfig path**, following
`packages/theme`'s precedent exactly — not `packages/git-ui`'s `exports`-map precedent.

Named reason for choosing `@theme`'s shape: these files import `@theme/*` (`CodiconIcon`,
`DialogFrame`, the primitives) and `@shared/*`, and an alias-consumed package resolves those
through the **consuming app's** alias table, which is what `packages/theme/src`'s own 166
self-referential `@theme/*` imports already rely on. An `exports`-map package would need its own
resolution for `@theme`/`@shared`, i.e. a second build.

```
packages/workbench/
  package.json                  # { "name": "@kira/workbench", "private": true, "type": "module" }
  src/
    workbench.css               # @import nothing; `@source "./";` only — see §4.4
    components/                 # Part 1: ContextMenu.vue, AppTooltip.vue, ConfirmDialog.vue
                                # Part 2: WorkbenchShell, TitleBar, StatusBar, TabStrip, MainView,
                                #         SettingsShell
    state/                      # Part 1: tooltip.ts, confirmDialog.ts, tabRuntime.ts, pinia.ts,
                                #         queryClient.ts
                                # Part 2: the store factories
    bridge/                     # Part 1: rpc.ts   Part 2: createCoreControl.ts
    editor/                     # monacoEntry.ts, monacoTheme.ts, monarch/{decorators,mongo,redis}.ts
    terminal/                   # terminalRenderer.ts, terminalRendererLoader.ts
    shortcuts/                  # keys.ts, commands.ts
    util/                       # clipboard.ts, format.ts, wheelScroll.ts, contextMenuKeys.ts,
                                # floatingPosition.ts, window.ts
    testing/                    # §4.5
  env.d.ts                      # the shared ambient module declarations
```

Wiring, per app, mirroring the `@theme` entries already present:

| File | Edit |
|---|---|
| `apps/*/frontend/vite.config.ts` | `'@workbench': fileURLToPath(new URL('../../../packages/workbench/src', import.meta.url))` |
| `apps/*/frontend/tsconfig.json` | `"@workbench/*": ["../../../packages/workbench/src/*"]` in `paths`, and `"../../../packages/workbench/src/**/*.ts"`, `"…/*.vue"` in `include` |
| `apps/*/tests/unit/tsconfig.json`, `apps/*/tsconfig.tests.json` | the same `paths` entry (they typecheck code that reaches the package) |
| root `package.json` | `"packages/workbench"` in `workspaces` |
| `knip.json` | a `packages/workbench` workspace block, mirroring `packages/theme`'s |
| `scripts/check-tokens.sh` | add `packages/workbench/src` to the scanned roots (it already scans `packages/theme/src`) |

`env.d.ts` is Tier A and moves, but it is an **ambient declaration file**: verify it is picked up
from the package via each app's `tsconfig.include`, and if `vue-tsc` does not see it, keep one
`/// <reference types="@workbench/env" />`-style re-export per app rather than two copies of the
declarations.

### 4.2 `state/` files in a package, and the Pinia rule

`state/{confirmDialog,tabRuntime,queryClient,pinia}.ts` and `workbench/state/tooltip.ts` move
verbatim. `confirmDialog.ts` and `tooltip.ts` are single-concern stores already; moving a store
into a shared package does not change what it owns, so `CLAUDE.md`'s "one Pinia store, one
concern" is preserved by construction. `pinia.ts` (5 lines) is the shared `createPinia()`
instance; both apps already import the identical module, so one copy is strictly correct.

### 4.3 Parameterizing the twelve Tier-B files

Mechanical, one rule each:

| File | Rule |
|---|---|
| `bridge/rpc.ts` | moves as-is except `import { windowKey } from '../state/window'` → `'../util/window'` (the same file, also moving) |
| `shortcuts/{keys,commands}.ts`, `wheelScroll.ts`, `clipboard.ts`, `util/window.ts` | move as-is; keep Kira Studio's historical comment as the surviving prose |
| `bridge/control.ts` | **not** moved — it is a per-app re-export shim over the app's own `bridge/index.ts`. Both copies stay |
| `theme/floatingPosition.ts` | move; export `autoUpdate` unconditionally (Kira Studio already does; an extra re-export is not a behaviour change) |
| `format.ts` | move **both** functions, `formatBytes` included — Kira Space's own comment says it was dropped only for want of a caller and calls it a dedup candidate. `knip` sees a package export with one consumer, which is not a finding; confirm on the Part 1 gate |
| `state/terminals.ts` | takes `canonicalPath` as a host-config function (§5.3), since the two apps source it differently |
| `state/terminalTabs.ts` | generic over the workspace key (§5.2) — **defer to Part 2**, it cannot move before the key type is parameterized |
| `editor/monaco.ts` | **defer to Part 2** — code-diff 10, all in the app-facing bootstrap; `monacoEntry`/`monacoTheme`/`monarch/*` move in Part 1 beneath it |

### 4.4 Tailwind content scanning

P100 Part 2 found that Tailwind v4's automatic content scan roots at the Vite project root and
never reaches a sibling package, and fixed it for `packages/theme` with `@source "./";` in
`base.css`. `packages/workbench/src` needs the same. **Do not** add `@source "../../workbench/src"`
to `packages/theme/src/base.css` — that couples theme to workbench.

Instead: `packages/workbench/src/workbench.css` carries `@source "./";` and each app's `main.ts`
imports it directly after `@theme/base.css`. The `@source` directive must come after any
`@import` in that file (`noInvalidPositionAtImportRule`, the same rule Part 2 hit).

The second Part 2 finding applies too: **the bracket-integer arbitrary-value form generates no
CSS** — `z-[1]` produces nothing, `z-1` works. Moved files were already fixed for this; a moved
file must not reintroduce it.

### 4.5 Test support

`packages/workbench/testing/` takes `unit/support/{wailsRuntime,fakeSocket,restoreAfterEach,
window}.ts` and `ui/support/server.ts` (all code-identical), plus `ui/fixtures.ts` (code-diff 8)
and `ui/support/bootSnapshots.ts` (code-diff 16) once their per-app differences are read and
turned into arguments.

`tests/ui/support/{ipcChannels,mockRuntime}.ts` (code-diff 158 and 127) are **left alone in Part
1** — they are the per-app mock surfaces, they diverge for real, and they were mid-edit from the
P100 Part 4 pass when this plan measured them (§1.1). Re-measure them against Part 4's landed
commit at the start of Part 2 and decide then; if the shared core is large, it follows
`createCoreControl`'s own shape (§5.6), which is the right seam for a mock of the same surface.

`wailsRuntime.ts`'s own header warns about a shared module registry and `mock.module` interception
— read it before moving, and keep the `/wails/runtime.js` specifier exactly as written (P57 M1/M2:
a tsconfig `paths` entry for that exact specifier breaks Bun's `mock.module`).

### 4.6 Part 1 commits

`build: wire packages/workbench into both frontends`; `refactor(workbench): hoist the
byte-identical workbench files`; `refactor(workbench): hoist the shared editor and terminal
renderer`; `refactor(workbench): hoist the shared utilities and rpc primitives`;
`refactor(tests): hoist the shared unit and UI support harness`.

---

## 5. Part 2 — the parameterized frontend

### 5.1 The tab-kind vocabulary splits per app

This is the root fix; §5.2-§5.4 all depend on it.

**`packages/shared/domain/tabs.ts` keeps** what is genuinely shared: the record envelope
(`id`/`connectionId`/`path`/`kind`/`state`/`order`/`active`/`workspaceId`), `TabScope`,
`pageSizeSchema`, `sortSpecSchema` re-exports, `tabTitle`, and the `terminal` kind with
`terminalTabStateSchema` (the one kind both apps really have).

**Each app declares its own union**, beside its existing tab state:

- `apps/kira-studio/frontend/src/state/tabDomain.ts` — `studioTabKindSchema` (12 members),
  `StudioTabKind`, `STUDIO_RENDERABLE_TAB_KINDS`, `STUDIO_TAB_KIND_MODE`, and the 11 Studio state
  schemas moved out of the shared file.
- `apps/kira-space/frontend/src/state/tabDomain.ts` — the same for its 5, absorbing today's
  `SpaceTabKind`.

**`packages/workbench/src/tabs/types.ts`** owns only the generic contract:

```ts
export interface TabKindDef<K extends string, R, Icon, Color, Menu> {
  mode: TabScope;
  title(tab: R): string;
  icon(tab: R): Icon;
  railColor(tab: R): Color | undefined;
  defaultState(): unknown;
  parseState(raw: unknown): unknown | null;
  duplicateState(tab: R): unknown;
  dropResources(tabId: string): void;
  menuExtras(tab: R): Menu[];
  badge?(tab: R): { icon: string; tooltip: string } | null;
  pinned?: true;
}
export type TabKindRegistry<K extends string> = { readonly [P in K]: TabKindDef<P, …> };
export type TabViewMap<K extends string> = Record<K, Component>;
export function parseStateWith<S>(schema: { safeParse(raw: unknown): … }): (raw: unknown) => S | null;
```

`Icon`/`Color`/`Menu` are type parameters because the two apps genuinely differ: Kira Studio's
`TabIcon` is `string`, Kira Space's is `string | { readonly filePath: string }`; Kira Studio's rail
colour is `ConnectionColor`, Kira Space's is `PaletteColor`. Each app instantiates the generic once
in its own `state/tabKinds.ts` and keeps a narrow local alias, so call sites are unchanged.

**What this deletes** (each its own commit, each a removal of unreachable code):

- `apps/kira-studio/.../state/tabKinds.ts`'s `unreachableTabKind` and its four registrations;
  `workbench/tabViews.ts`'s `NeverRenderedTabView` and its four entries.
- `apps/kira-space/.../state/tabs.ts`'s `kindDef` cast and every `TAB_KINDS[tab.kind as
  SpaceTabKind]` in `TabStrip.vue` — with the union narrowed, `TabRecord['kind']` **is** the
  registry's key, so the casts are no longer expressible let alone needed.
- `apps/kira-studio/internal/storage/model/tabs.go`'s `RenderableTabKinds` entries for
  `repo-graph`/`repo-file`/`repo-diff`/`repo-multi-diff`, and the matching `repoTabKinds` members.

**Two things to hand-read, not sweep:**

1. `repoTabKinds` in Kira Studio's Go also contains `terminal`, which Kira Studio really has.
   Removing the four repo kinds leaves a one-member map. Read `TabRecord.Validate`'s use of it and
   decide there whether it collapses to a single `kind == "terminal"` check or stays a map; do not
   assume.
2. A Kira Studio user's `tabs` table may still hold rows of a repo kind from before P100. Dropping
   the kind from `RenderableTabKinds` makes such a row drop-with-a-warn on restore — which is the
   file's own documented posture for an unrecognised kind, and the correct outcome. State it in
   the commit message; no migration.

**`go-ts-vocabulary-parity.spec.ts`** currently compares the shared 16-member TS list against Kira
Studio's 16-member Go list, and nothing checks Kira Space at all. It becomes two checks: Studio's
12 against Studio's Go, Kira Space's 5 against Kira Space's Go. Add the Kira Space half under
`apps/kira-space/tests/unit/`. This test earns its keep under `CLAUDE.md`'s test bar for the
reason the file itself already states — it is the one vocabulary a TypeScript exhaustiveness check
cannot catch a miss on, and the failure mode is a silently dropped tab row.

### 5.2 `state/tabs.ts` — a store factory over the workspace key

`packages/workbench/src/state/createTabsStore.ts`:

```ts
export interface TabsHost<K extends string, R> {
  kinds: TabKindRegistry<…>;
  workspaceKeyOf(tab: R): K;
  control: CoreControl;                 // §5.6 — tabsList/tabsSave/onFlushBeforeClose/…
  persistable?(tab: R): boolean;        // default: kind !== 'terminal'
  onCleanup?(tabId: string): void;      // cleanupTabRuntime by default
}
export function createTabsStore<K extends string, R>(host: TabsHost<K, R>) {
  return defineStore('tabs', () => { /* the shared skeleton of §1.5 */ });
}
```

Each app keeps `state/tabs.ts`, now three lines of `export const useTabsStore =
createTabsStore({…})` plus its own per-kind sugar (`openDataTab`, `patchRepoFileTabState`, …) as
thin wrappers over the returned store's generic `openTab`/`patchTabState`. Store id stays
`'tabs'` in both, so devtools, `pinia` hydration and every existing `useTabsStore()` call site are
unchanged.

**Studio-only members stay in Kira Studio's file, not in the factory**: the `hydrated` reconnect
gate (`markHydrated`/`unmarkHydrated`/`isHydrated`), the `tabIncognitoStore` filter and its
`registerIncognitoSetListener`, and the `control.onConnectionsChanged`/`onConnectionState`
handlers. `persistable` and `onCleanup` are the two hooks that let them compose without the
factory knowing they exist.

`tabsForWorkspace` moves into the factory's returned surface (Kira Studio calls it from
`state/mode.ts`, Kira Space from `state/tabs.ts` — both become re-exports).

`state/terminalTabs.ts` follows immediately: its only divergence is `workspaceId: AppMode` vs
`workspaceId: WorkspaceKey`, which is the same `K`.

### 5.3 The four other store factories

| Store | Shared | Parameter |
|---|---|---|
| `layout.ts` | `patchLayout`, `hydrateLayout`, `onLayoutChanged` wiring, the panel getters | the app's own per-panel setters (`toggleOperationsPanel`, `setCellEditorHeight`, `setOperationsHeight` are Kira Studio's) stay in the app file, composed over the factory's `patchLayout` |
| `settings.ts` | the store body, `applyAppearance`, `hydrateSettings`, `openSettingsAt` | `sections` (the tuple) and `Section`; Kira Studio's `appearanceVersion` counter stays in Kira Studio |
| `contextMenu.ts` | everything, `runMenuShortcut` included | none — move whole. Kira Space simply does not call `runMenuShortcut` today; one unused package export with one consumer is not a knip finding, confirm on the gate |
| `terminals.ts` | everything | `canonicalPath` as a host function (§4.3) |

Each stays one store, one concern. None grows a second concern by being shared.

### 5.4 The five workbench components

One mechanism for all five: a **provided host object** plus **named slots**. Vue's own
`provide`/`inject` with a typed `InjectionKey` — a core framework feature, not a hand-rolled
equivalent of a library, so `CLAUDE.md`'s library rule is satisfied without a dependency.

`packages/workbench/src/host.ts`:

```ts
export interface WorkbenchHost<K extends string> {
  activeWorkspace: ComputedRef<K>;
  tabs: ReturnType<typeof createTabsStore>;
  kinds: TabKindRegistry<…>;
  views: TabViewMap<…>;
  iconFor(tab): …;  railColorFor(tab): …;
  extraTabMenu?(tab): MenuItem[];
  tabBadge?(tab): { icon; tooltip } | null;
  tabAttention?(tab): boolean;
}
export const workbenchHostKey: InjectionKey<WorkbenchHost<string>>;
export function useWorkbenchHost(): WorkbenchHost<string>;
```

Each app calls `provide(workbenchHostKey, …)` once, in `App.vue`.

| Component | Shape |
|---|---|
| `MainView.vue` | whole; resolves `views[activeTab.kind]` through the host |
| `TabStrip.vue` | whole; the strip, drag-reorder, wheel-scroll, keyboard and the six generic context-menu items come from the package. Per-app extras arrive through the host's optional `extraTabMenu`/`tabBadge`/`tabAttention`/`iconFor` — which is exactly what Kira Studio's incognito + agent-attention and Kira Space's seti icons are |
| `WorkbenchShell.vue` | the grid, the splitters and the `--kira-*` custom-property style binding. `#panel`, `#main` (defaulted to `<MainView/>`), `#status` and an **optional `#dock`** slot. `dock` present ⇒ the `splitops`/`ops` grid rows and their `--ops-h`/`--ops-split-h` properties are emitted; absent ⇒ they are not. Kira Studio passes `<OperationsPanel/>`; Kira Space passes nothing, and its rendered grid is byte-identical to today's |
| `TitleBar.vue` | the bar chrome: height, insets, `background`, the `--wails-draggable: drag` region and the `--wails-draggable: none` action region, plus the `<Teleport to="body">` Settings mount. One default slot for actions, and the `.title-action` class published from the package stylesheet so each app's own `<button class="title-action">` markup keeps working **and stays in the app for P104 to swap** (§2.3) |
| `StatusBar.vue` | the bar chrome (`.p-statusbar`, `.side`, `.p-status`, `.mono`/`.xs`/`.muted`) and the left caret-status readout, which is identical prose in both. `#left-extra` and `#right` slots for the items |

Two hazards, both named in §11: the `WorkbenchShell` grid-template change is the one place a
visual regression can hide, and prop-drilling through a provided host is where a reactivity
regression can hide (pass `ComputedRef`s, never unwrapped values).

### 5.5 `SettingsDialog.vue` → `SettingsShell.vue` + panes

`packages/workbench/src/components/SettingsShell.vue` owns the frame, the nav and the dirty engine:

```
props:   sections: readonly string[]
         initialSection?: string
         defaults: T                      // the app's defaultSettings
         current: T                       // the store's live settings
         save(patch): Promise<void>
slots:   #pane  (scoped: { section, draft, isAtDefault, resetLeaf })
emits:   close
```

It provides `draft` (a `reactive` clone), `baseline` (frozen), `pendingPatch`, `isDirty`,
`isValid`, `isAtDefault`, `resetLeaf`, `onDismiss` with the discard-confirm guard, and `saveError`
— all of §1.6's confirmed-shared list, generic over the settings shape. Field validity comes up
from the panes: the shell exposes a `registerFieldError(id, ref)` the panes call, rather than the
shell knowing any app's leaves.

Each app keeps `workbench/SettingsDialog.vue` as a thin composition:
`<SettingsShell …><template #pane="s"><AppearancePane v-if="s.section === 'Appearance'" v-bind="s"/>…`
with its panes as sibling components under `workbench/settings/`. Kira Studio's eight panes and
Kira Space's four are extracted from their current inline `<template v-if>` blocks **verbatim** —
markup, classes, `data-testid`s and styles unchanged, because ~331 class-based Playwright selectors
read them (P104's own row counts them) and Part 2 must not move that ground under P104.

The shared field-level style vocabulary (`.field`, `.field-head`, `.helper-text`, `.field-error`,
`.sec-label`, `.section-subhead`) moves to `packages/workbench/src/workbench.css` so both apps'
panes keep resolving it.

### 5.6 `bridge/*` — one core surface over each app's own bindings

`packages/workbench/src/bridge/createCoreControl.ts`:

```ts
export interface CoreBindings {
  settings: { GetAll(): Promise<unknown>; Set(a: { patch: unknown }): Promise<unknown> };
  layout:   { GetAll(): Promise<unknown>; Set(a: { patch: unknown }): Promise<unknown> };
  tabs:     { List(a: { windowKey: string }): Promise<unknown>;
              Save(a: { windowKey: string; tabs: unknown[] }): Promise<void> };
  lifecycle:{ Flushed(a: { windowKey: string }): void;
              WindowFlushed(a: { windowKey: string }): void };
  terminal: { Open(a): Promise<unknown>; Write(a): Promise<void>;
              Resize(a): Promise<void>; Close(a): Promise<void>; DefaultCwd(): Promise<unknown> };
  files:    { ChooseFolder(a: { title: string }): Promise<unknown> };
  link:     { OpenExternal(a: { url: string }): Promise<void> };
}
export function createCoreControl<S, L, T>(b: CoreBindings): CoreControl<S, L, T>;
```

This is a **structural** interface, so each app's generated `@bindings/*` module satisfies it by
shape with no adapter and no change to binding generation. Each app's `bridge/index.ts` becomes:

```ts
export const control = {
  ...createCoreControl<Settings, Layout, TabRecord>({
    settings: SettingsService, layout: LayoutService, tabs: TabsService,
    lifecycle: LifecycleService, terminal: TerminalService,
    files: FilesService, link: LinkService,
  }),
  // this app's own 94 / 24 remaining methods, unchanged
};
```

`windowKey` and the `CHANNEL.*` constants the core methods subscribe to already come from
`@shared/protocol/events` and `packages/workbench/src/util/window.ts` (Part 1), so the factory
needs neither injected.

The three generic parameters carry the domain types (`Settings`, `Layout`, `TabRecord`) through
`trust<T>`, so each app's `control` keeps its exact current TypeScript signature — verify with
`bun run typecheck`, not by inspection.

### 5.7 Part 2 commits

`refactor(tabs): give each app its own tab-kind vocabulary`; `refactor(tabs): drop the unreachable
tab-kind stubs from both apps`; `refactor(workbench): extract the tabs store factory`;
`refactor(workbench): extract the layout/settings/contextMenu/terminals store factories`;
`refactor(workbench): share MainView and TabStrip`; `refactor(workbench): share WorkbenchShell,
TitleBar and StatusBar`; `refactor(settings): extract SettingsShell and the per-app panes`;
`refactor(bridge): share the core control surface`.

---

## 6. Part 3 — the Go shell hoist

### 6.1 Repo-root `internal/terminal`

Whole package, `session.go` + `session_test.go` verbatim. `shell.go`'s two differences become
package-level configuration set once at startup:

```go
// internal/terminal/shell.go
var (
    TermProgram        = "Kira"     // set by each app's main.go
    TermProgramVersion = ""
)
```

set from each app's `main.go` (`terminal.TermProgram = "Kira Studio"; terminal.TermProgramVersion
= buildinfo.Version`). A package-level var, not a `Config` struct threaded through `OpenParams`,
because `sessionEnv()` is called per-spawn from deep inside `newSession` and these two values are
process-constant — threading them would touch every `Open` call site for a value that never varies.
Set them before the first `Registry.Open`; the existing startup sequence already has a single such
point.

`session_test.go` moves with the package and keeps its own `TestRegistryRejectsDuplicateID` and
the rest. It is one copy instead of two, and it is exactly the kind of test `CLAUDE.md`'s bar
keeps (concurrency: ordering, duplicate-spawn races, unregister ordering).

Each app's `internal/bridge/terminal.go` (code-diff 47) **stays** — it is a bound Wails service
(§2.3) — and retargets its `terminal.*` import at the repo-root package.

### 6.2 Repo-root `internal/appevent`

```go
package appevent

type Emitter interface {                 // today's appcore.Emitter, identical in both apps
    Emit(channel string, payload any)
    EmitTo(windowKey, channel string, payload any)
    EmitFocused(channel string, payload any)
}

type Events struct{ emit Emitter }
func NewEvents(e Emitter) *Events
func (ev *Events) Signal(channel string)
func (ev *Events) SignalTo(windowKey, channel string)
func (ev *Events) Broadcast(channel string)

const (                                  // byte-identical strings in both apps today
    ChannelFlushBeforeClose       = "kira:app:flush-before-close"
    ChannelWindowFlushBeforeClose = "kira:window:flush-before-close"
    ChannelSettingsChanged        = "kira:settings:changed"
    ChannelLayoutChanged          = "kira:layout:changed"
    ChannelTerminal               = "kira:terminal:data"
    ChannelCodeSearch             = "kira:code:search"
)
```

Each app's `internal/bridge/events.go` keeps its own channel constants (re-exporting the six above
as `const ChannelX = appevent.ChannelX`, so no call site changes) and embeds the core:

```go
type Events struct{ *appevent.Events }
func NewEvents(e appevent.Emitter) *Events { return &Events{appevent.NewEvents(e)} }
func (ev *Events) Attach(s Sources) (detach func()) { /* Kira Studio's, unchanged */ }
```

`appcore.Emitter` becomes `type Emitter = appevent.Emitter` in each app, so `appcore.Deps.Events`
and every `bridge` consumer are untouched. `appcore.Deps` itself stays per-app — genuinely
different fields (§1.3).

### 6.3 Repo-root `internal/shell`, and `apps/*/internal/appshell`

The shared package takes: `registry.go`, `debounce.go`, `security.go`, `quit.go`,
`closeflush.go`, `window.go`, `menu.go`, and `menutemplate.go`'s **type vocabulary**
(`ItemKind`, `Section`, `Item`, and the `ItemRole`/`ItemQuit`/`ItemNewWindow`/`ItemEmit` members —
`ItemEmit` included, since a generic builder can support it and Kira Space simply emits no such
item). Studio's `accel.go` and the four `*_test.go` files move with it.

Four seams replace the four app-local imports (§1.8):

```go
// internal/shell
type Config struct {
    AppName     string   // menu title
    WindowTitle string   // "Kira Studio" / "Kira Space" — window.go's one divergent line
}

type Signaller interface {                 // *appevent.Events satisfies this
    Broadcast(channel string)
    SignalTo(windowKey, channel string)
}

type WindowStore interface {               // *repos.WindowsRepo satisfies this in both apps
    // exactly the methods window.go's Attach/Options actually call — read them, do not guess
}

type WindowRecord struct{ Key string; Bounds *Rect }  // the two fields shell reads today
```

- `NewQuitter(sig Signaller, …)` and `NewCloseFlushCoordinator(sig Signaller, …)` take the
  interface; the channel names come from `appevent`, which the shared package may import.
- `Options(sec SecurityOptions, w WindowRecord, area *application.Rect, cfg Config)` replaces
  `Title: "Kira Studio"` with `cfg.WindowTitle`. Each app converts its own `model.WindowRecord`
  into `shell.WindowRecord` at the one call site — a two-field copy, cheaper than hoisting the
  storage model.
- `MenuDeps{AppName string; IsDev bool; Template []Section; OnEmit func(channel string)}`.
  `ItemEmit` calls `OnEmit`; a template with no `ItemEmit` never needs it. Kira Studio passes
  `d.Events.Signal`; Kira Space passes nil and has no `ItemEmit` entry.

The **residue** goes to `apps/<app>/internal/appshell` (package `appshell`, a distinct name so
both packages can be imported by one `main.go` without an alias):

| App | `appshell` contents |
|---|---|
| Kira Studio | `BuildTemplate()` (its own menu), the `dialogs` adapter (unpacks `bridge.SaveFileRequest`/`OpenFileRequest` and calls the shared helper), `RegisterEngineStream`, `AttachSystemWake` |
| Kira Space | `BuildTemplate()`, the `dialogs` adapter (`OpenDirectory` only), `RegisterGitStream` |

The generic `emitter`, `browserOpener`, `NewDeferredEmitter`, `NewDeferredBrowser`,
`NewDeferredDialogs` and `AttachReopen` are shared — all four are pure Wails, identical in both.

**The dialog helper takes plain parameters, not a request struct**, and this is deliberate:
`bridge.SaveFileRequest`/`OpenFileRequest` are Wails-bound service parameter types, so moving them
would move the generated `@bindings/*` model they produce. Instead the shared package exposes
`SaveFile(win application.Window, directory, filename string) (string, error)` (and siblings), and
each app's tiny `appshell` adapter destructures its own request struct into that call. Binding
generation is untouched; the duplication left behind is two four-field structs.

### 6.4 The three small Go hoists

`storage/model/time.go` → repo-root `internal/kiratime` (byte-identical, 32 lines, no
dependencies). `config/{env,prod,prod_default}.go` → repo-root `internal/kirapaths` (which already
exists and already owns the `Home()` half of this concern), leaving each app's `config` package as
the three-literal wrapper §2.3 declines to remove.

Check `layering_test.go`'s exemption set in **both** apps after each hoist; a package leaving
`apps/*/internal/` must not leave a stale exemption behind. Neither exemption set may grow.

### 6.5 Part 3 commits

`refactor(go): hoist internal/terminal to a shared package`; `refactor(go): hoist the event
emitter and shared channels to internal/appevent`; `refactor(go): hoist the generic shell to a
repo-root package`; `refactor(go): split each app's shell residue into internal/appshell`;
`refactor(go): hoist model/time.go and the config build tags`.

---

## 7. Part 4 — Go settings composition, and the audit

### 7.1 Repo-root `internal/appsettings`

```go
package appsettings

type Appearance struct{ /* the 7 fields, tags verbatim */ }
type Git        struct{ /* the 4 fields, tags verbatim */ }
type AdvancedCore struct{ GitLogLevel string `json:"gitLogLevel"` }

type AppearancePatch struct{ /* 7 pointers */ }
type GitPatch        struct{ /* 4 pointers */ }
type AdvancedCorePatch struct{ GitLogLevel *string `json:"gitLogLevel,omitempty"` }

func DefaultAppearance() Appearance
func DefaultGit() Git
func ValidateAppearance(*AppearancePatch) error
func ValidateGit(*GitPatch) error
func ValidRowDensity(string) bool
func ValidDateFormat(string) bool
func ValidLogLevel(string) bool
func InRange(lo, hi int) func(int) bool

// repos half — the SQL-shaped helpers, identical in both apps today
func UpsertAppearance(tx *sql.Tx, p *AppearancePatch) error
func UpsertGit(tx *sql.Tx, p *GitPatch) error
func UpsertLeaf(tx *sql.Tx, key string, value any) error
func Leaf[T any](stored map[string]json.RawMessage, key string, dst *T)
func LeafValid[T any](stored map[string]json.RawMessage, key string, dst *T, valid func(T) bool)
func ReadAppearance(stored map[string]json.RawMessage) Appearance
func ReadGit(stored map[string]json.RawMessage) Git
```

Each app's `storage/model/settings.go` then declares only its own composition:

```go
type Settings struct {
    Appearance appsettings.Appearance `json:"appearance"`
    Data       DataSettings           `json:"data"`        // Kira Studio only
    …
    Advanced   AdvancedSettings       `json:"advanced"`
    Git        appsettings.Git        `json:"git"`
}
```

and each app's `storage/repos/settings.go` keeps its own `GetAll`/`Set` composing the shared
per-section helpers with its own.

### 7.2 `Advanced.GitLogLevel`: embed, or share only the validator

The row asks for `Advanced.GitLogLevel` in the shared base. Embedding is how Go expresses that:

```go
type AdvancedSettings struct {
    OpLogRetentionDays int `json:"opLogRetentionDays"`
    ExpensiveQueryRows int `json:"expensiveQueryRows"`
    appsettings.AdvancedCore                      // promotes gitLogLevel
}
```

`encoding/json` promotes embedded struct fields on both marshal and unmarshal, so the wire shape is
unchanged and `s.Advanced.GitLogLevel` still reads. Composite literals break at compile time
(`AdvancedSettings{GitLogLevel: …}` → `AdvancedSettings{AdvancedCore: appsettings.AdvancedCore{…}}`)
— a compiler error, not a silent bug.

**The one unknown static reading cannot settle** is how Wails v3's binding generator renders an
embedded struct. Decision procedure, not a guess:

1. Before the change, save each app's `frontend/bindings/**/models.ts`.
2. Make the change, run `sh scripts/setup.sh`'s `wails3 task common:generate:bindings -clean=true`
   for both apps (P100 Part 2's result: a **clean** regeneration is what surfaces stale artifacts;
   do not trust an incremental one).
3. `diff` the regenerated `models.ts` against the saved copy.
4. Unchanged ⇒ keep the embedding. Changed ⇒ **do not** chase it: revert to declaring
   `GitLogLevel string \`json:"gitLogLevel"\`` in each app's own `AdvancedSettings` and share only
   `ValidLogLevel` plus `UpsertLeaf`. Record which branch was taken, and why, in the result
   section.

The same regenerate-and-diff gate covers `Appearance`/`Git` moving to a repo-root package — their
generated models move directory with them. The frontend uses `@shared/domain/settings`'s
zod-derived types rather than the generated ones (`bridge/index.ts` imports `Settings`/
`SettingsPatch` from `@shared/domain/settings` and narrows with `trust<T>`), so a path change there
should be invisible; `bun run typecheck` and `bun run build` for both apps are what prove it.

### 7.3 Splitting `settingsSchema` (the TypeScript mirror)

`packages/shared/domain/settings.ts` keeps `appearanceSettingsSchema`, `gitSettingsSchema`, the
`gitLogLevel` leaf, `FONT_SIZE_RANGE` and the other shared bounds. Each app declares its own
`settingsSchema`/`settingsPatchSchema`/`defaultSettings` composing them — Kira Studio's 8 sections,
Kira Space's 3 — in `apps/*/frontend/src/state/settingsDomain.ts`.

This removes the five dead sections Kira Space's store carries today (§1.9). Verify by reading
`defaultSettings` at runtime in Kira Space's boot: the store's shape must go from 8 keys to 3, and
nothing in that app may reference a removed key (`grep` for `settings.data`, `.cache`, `.api`,
`.dbMcp`, `.claudeCode` under `apps/kira-space/frontend/src` — expect zero before the change, which
is what makes the removal safe).

### 7.4 Part 4 commits

`refactor(go): extract the shared settings sections to internal/appsettings`; `refactor(go):
recompose both apps' model.Settings on the shared base`; `refactor(go): recompose both apps'
settings repo on the shared helpers`; `refactor(settings): give each app its own settings schema`;
`docs(v1.9): record the P103 result`.

---

## 8. Conversion rules, across all parts

1. **A move is a move.** `git mv` (or copy-forward where Go's `internal/` rule forces it — P100
   Part 1's own precedent) plus import-path rewrite, nothing else in that commit. A real change to
   a moved file is a second commit with its own message.
2. **Prose merges, code does not.** Where two copies differ only in comments (§1.3), the surviving
   comment is **Kira Studio's original rationale**, not Kira Space's "ported verbatim" header —
   the latter describes a duplication that no longer exists after this phase. Delete it; do not
   keep both.
3. **No behaviour change rides along.** The three deliberate removals (§2.4) each get their own
   commit and say what becomes unreachable and why it already was.
4. **Every `.vue` file is `<script setup lang="ts">`**, one `<script>` block, Composition API. Every
   moved file already complies; every new one (`SettingsShell.vue`, the panes) must.
5. **Lean on the P98 libraries.** A new composable is VueUse's if VueUse has it (`useEventListener`,
   `useDebounceFn`, `useResizeObserver` are already used in these exact files). Shared client state
   is Pinia, one store per concern. Anything fetched over the bridge with loading/error/cache is
   TanStack Query. A primitive is shadcn-vue's. Declining any of these needs a named requirement at
   the site, not "the existing code works".
6. **Do not introduce a new hand-rolled primitive** (§2.3). P104 deletes primitives; P103 must not
   add one for it to delete.
7. **A class name or `data-testid` a Playwright selector reads is kept**, even where the file
   moves. P99 §9.2's rule. This is load-bearing for §5.5 in particular.
8. **Store ids do not change.** `'tabs'`, `'settings'`, `'layout'`, `'contextMenu'`,
   `'terminals'`, `'confirmDialog'`, `'tooltip'` keep their exact ids through every factory
   extraction.
9. **Go: a shared package never imports `apps/*/internal/…`.** The compiler enforces it; the
   design must not need it. Each app's `layering_test.go` exemption set must not grow.
10. **A failing gate gets fixed in the same pass**, pre-existing or not. Confirm it predates the
    part with `git diff --stat` against the part's start commit, then fix it.
11. **`--no-verify` is not an ending.**

---

## 9. Verification

Baselines, from P100 Part 2's own result section: `test:unit` 1534; `test:ui` 279 (Kira Studio,
both `ui` and `ui-timing` projects); `test:ui:space` 20; `test:webview` 55; `test:visual` 5 failed
of 5, each ~1% pixel ratio, pre-existing; `lint:dead` exit 0 with 6 duplicate-export warnings and
6 configuration hints; `typecheck` clean across 8 projects.

| Command | Expected | From |
|---|---|---|
| `bun run typecheck` | Clean across all 8 projects. The `@workbench` path must resolve in the app, unit and tests projects alike | Part 1 |
| `bun run lint` | Biome clean; `check-tokens.sh` resolves every `--kira-*`/`--kv-*`/`--kui-*` across both frontends, `packages/theme/src`, `packages/git-ui/src`, `packages/kira-ui/src` **and the new `packages/workbench/src`** | Part 1 |
| `bun run lint:dead` | exit 0. The new workspace block may add at most one ".vue extension not registered" configuration hint (the same one `packages/theme` and each frontend already produce); it must add **no** unused-export finding. A package export with exactly one consumer is expected and fine | Part 1 |
| `bun run build`, `bun run build:space` | Clean, both. Only the pre-existing >500 kB chunk advisory. **Check the emitted CSS actually contains the moved components' utility classes** — the Tailwind sibling-package scan is the known trap (§4.4) | Part 1 |
| `bun run test:unit` | 1534, plus the new Kira Space vocabulary-parity spec in Part 2 | Parts 1-2 |
| `bun run test:ui` | 279 | Parts 1-2 |
| `bun run test:ui:space` | 20 | Parts 1-2 |
| `bun run test:webview` | 55 — untouched, re-run to prove it | Part 1 |
| `bun run test:visual` | The same 5 failures, no sixth. A new diff in the workbench, title-bar or settings surfaces is a **Part 2 regression**, not a baseline to re-record — §5.4 and §5.5 are explicitly pixel-preserving. Only P104 re-records baselines | Part 2 |
| `go build ./...`, `go vet ./...` | Clean, both apps, after **every** hoist commit | Parts 3-4 |
| `bun run lint:go` | `0 issues` | Parts 3-4 |
| `bun run test:go` | Every package `ok`, including both `layering_test.go` copies run with `-v`, and `internal/terminal`'s moved `session_test.go` | Parts 3-4 |
| `gofmt -l` on every file touched | Empty. Kira Studio's ~23 pre-existing drifted files are untouched by this phase — prove with `git status`, same precedent as P100 Part 1 | Parts 3-4 |
| Clean bindings regeneration | `wails3 task common:generate:bindings -clean=true` for **both** apps, then `bun run build`/`build:space`. P100 Part 2 found a real break that only a clean regeneration surfaced | Part 4 |
| `bun run verify:packaging` | `all checks passed` (artifact checks skip without a built bundle, the documented sandbox precedent) | Part 4 |

**Both binaries must actually boot.** No display in this container, so use the documented
`-tags server` substitute (`docs/DEV_ENVIRONMENT.md`): `go build -tags server` for both, `/health`
answers, and a real DOM boot — Kira Studio via `?window=main`, Kira Space via the Startup-created
window UUID read from its fresh SQLite DB (it has no `WindowsService`; P100 Part 2's result records
this exact technique and why the plain URL 400s). Console errors must match that result's
documented first-run set, with no new ones.

---

## 10. Closing audit (Part 4)

Run each over the whole repo. Account for every hit — shared, parameterized, or declined with the
requirement named. A check that finds nothing says so.

| Check | Command | Pass condition |
|---|---|---|
| No byte-identical file left across the two apps | the §1.1 sweep 3 hash-grouping, re-run | Every remaining cross-app group is named in §2.3 with its reason |
| No code-identical file left | the §1.1 sweep 2 comment-blind diff over remaining common paths | Same |
| No tab-kind stub survives | `grep -rn "unreachableTabKind\|NeverRenderedTabView\|as SpaceTabKind" apps/` | Zero |
| Go and TS vocabularies agree, per app | `bun test` the two parity specs | Both pass; Kira Studio 12 kinds, Kira Space 5 |
| No cross-app `internal/` import | `grep -rn "apps/kira-studio/internal" apps/kira-space/` and the reverse | Zero; also enforced by `go build` |
| No shared package imports an app | `grep -rn "apps/kira-" internal/ packages/workbench/src` | Zero |
| `layering_test` still bites | `go test ./apps/kira-studio/internal/ ./apps/kira-space/internal/ -run TestDomainPackagesDoNotImportBridge -v` | Both pass; neither exemption set has grown |
| The workbench package imports nothing app-local | `grep -rn "\.\./\.\./\.\./apps\|@/" packages/workbench/src` | Zero. Add a `noRestrictedImports` block for `packages/workbench/**` to `biome.json` — today's layering rules are all scoped to `apps/kira-studio/frontend/src/**` paths and would not otherwise cover the new package |
| Every component exactly one `<script>` block | `grep -c "<script" ` per `.vue` across both frontends, `packages/workbench`, `packages/theme`, `packages/git-ui`, `packages/kira-ui` | Exactly 1 each |
| Store ids unchanged | `grep -rn "defineStore(" apps packages` | The pre-phase id set, unchanged |
| Kira Space carries no dead settings section | `grep -rn "settings\.\(data\|cache\|api\|dbMcp\|claudeCode\)" apps/kira-space` | Zero |
| No new hand-rolled primitive | `git diff --stat` over `packages/workbench/src/components` | No new button/tooltip/menu/dialog primitive; `ContextMenu.vue`/`AppTooltip.vue` internals byte-identical to their pre-phase content |
| Line count actually fell | `cloc` or `wc -l` over both apps' `frontend/src` + `internal/` against the phase's start commit | A net reduction of roughly 3,800+ lines; a growth anywhere is explained |

---

## 11. Risks

| Risk | Handling |
|---|---|
| A per-app difference the comment-blind diff hid — a string, a `data-testid`, a class | Sweep 2 strips comments only; it cannot hide a code token. But it **can** hide a difference inside a comment that a tool reads (a biome-ignore, a `@ts-expect-error`, an `eslint`-style pragma). Before moving any Tier-B file, `grep` it for `biome-ignore`, `@ts-`, `v8 ignore`, `c8` and `istanbul` in both copies and compare those lines explicitly |
| `WorkbenchShell`'s grid-template change regresses layout silently | §5.4 makes the dock rows conditional rather than always-present-but-zero. `test:visual` is the gate, and its 5 known failures are the exact baseline — a **sixth** is a regression, never a baseline to re-record (§9). If the conditional grid proves fiddly, the fallback is to keep both row definitions and drive them to `0px` as Kira Studio already does, which is what Kira Space renders today anyway |
| Prop-drilling through the provided host regresses reactivity | Provide `ComputedRef`s and store instances, never unwrapped values; never spread a store into the host object. The symptom is a stale tab strip after a workspace switch, which `test:ui`'s existing tab specs catch — run them after §5.4's commit specifically, not only at the part's end |
| The tab union split typechecks but drops a real kind at runtime | `RENDERABLE_TAB_KINDS` is the vocabulary TypeScript exhaustiveness cannot catch a miss on — the file says so itself. The two parity specs (§5.1) are the guard, and they are written **before** the union is narrowed, not after |
| A Kira Studio user's stored `repo-*` tab row | Documented drop-with-warn, the file's own posture for an unrecognised kind (§5.1). Stated in the commit message; no migration |
| Wails binding generation changes shape under the settings composition | §7.2's regenerate-and-diff procedure with a named fallback. Use a **clean** regeneration (`-clean=true`); P100 Part 2 found a real break that an incremental one hid |
| Moving a bound service moves its `@bindings/*` module | Which is why §2.3 declines moving any bound service. Only their dependencies move |
| Tailwind does not scan the new package | §4.4's `@source "./";`, plus the §9 gate that inspects emitted CSS rather than trusting a green build. P100 Part 2 hit exactly this |
| Two Go packages named `shell` collide in one `main.go` | §6.3 names the residue `appshell`, a distinct package name, so no import alias is ever needed |
| Go's `internal/` rule breaks a mid-hoist build | P100 Part 1's copy-forward/delete-backward strategy, and its finding that a literal "one `git mv` per commit, green at every step" order can be impossible. `go build ./...` must be green at **every** commit; that, not the literal move order, is the requirement |
| `knip` flags a package export used by only one app | Expected, and not a finding — but confirm on Part 1's gate rather than assuming. If knip does flag one, prefer keeping the export and adding a scoped `ignore`, with the reason, over deleting a function one app genuinely wants (`formatBytes`, `runMenuShortcut`) |
| A part runs long and lands half a hoist | Commit per file group / per package. A part that cannot finish stops at a group or package boundary, leaves both apps building and all gates green, and says exactly where it stopped; the next part starts there rather than at this plan's boundary |
| This plan's own measurements of `tests/ui/support/{ipcChannels,mockRuntime}.ts` were taken against a dirty tree | §1.1 and §4.5 both say so. Re-measure against P100 Part 4's landed commit before acting; they are deferred out of Part 1 for exactly this reason |
