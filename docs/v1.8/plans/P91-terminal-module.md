# P91 — Terminal module: a quick-command panel and tabbed terminal sessions

`docs/v1.8/SPEC.md`'s P91 row (`:165`), turned into concrete steps. Everything below was read in the
current tree (`claude/v1-8-p82-p83-implementation-ocpvj1` at `bc292c0e`, P71-P86 and P89/P90
landed); line numbers are from that tree.

This phase builds **no mechanism**. P83 shipped the PTY, the `terminal` tab kind, the xterm
renderer and the frontend session registry; P85 shipped the command field and the `custom_scripts`
store; P67b shipped the mode registry a third module already plugs into. P91 is a fourth module
plugged into that registry, one new opener function, one new bound read-only call, and two new Vue
components. The verification this plan owes SPEC — "confirms that mechanism's shape is generic
enough to host outside the git panel as-is, or states precisely what widening it needs" — is §4,
§6 and §7: **three small widenings, all named below, none of them a second implementation.**

No new dependency. No SQLite migration. No `@kira/git-ipc` contract change, no `CONTRACT_VERSION`
bump, no `packages/git-ui/` or `apps/kira-studio-vscode/` file.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| The nav entry point | **`workbench/modes.ts`'s `MODES` registry plus `TitleBar.vue:13`'s `MODE_ORDER`** — the same two edits `git` itself took in P67b. `AppMode` (`packages/shared/domain/mode.ts:9`) gains `'terminal'`, which makes `MODES: Record<AppMode, ModeDef>` a type error until the entry exists. No new switcher, no new shell surface | §2 |
| Does a new module need a DB migration | **No.** `windows.mode` is unconstrained `TEXT` (`model/window.go:27`-`28`). One map entry in `validWindowModes` (`window.go:30`) is the whole Go diff, and without it a window closed in Terminal reopens in Studio | §3 |
| Does the `terminal` tab kind need widening | **No `TAB_KIND_MODE` change.** `terminal: 'repo'` (`domain/tabs.ts:99`) is the sentinel "workspace comes from the record's own `workspaceId`" — a Terminal-module tab carries `workspaceId: 'terminal'`, which `workspaceKeyOf` (`state/mode.ts:77`) returns as-is. `'terminal'` is a valid `WorkspaceKey` the moment it is a valid `AppMode` | §4 |
| Does `state/terminals.ts` need widening | **No.** `codeRepoId` is client-side bookkeeping only — it is never sent to Go (`terminals.ts:107`-`146`; `control.terminalOpen` takes id/cwd/cols/rows/command/launchKind). `''` is a correct value for an unscoped session | §6 |
| Does `internal/terminal` / `bridge/terminal.go` need widening | **No.** `OpenParams` is `{ID, WindowKey, Cwd, Cols, Rows, Command, Env, Agent, …}` — it has never known what a repository is. `TerminalService.Open`'s contract is untouched by this phase | §6, §7.1 |
| What widening *is* needed | Three: (a) `AppMode` + the two registry edits; (b) a new `openTerminalTab` that does **not** call `openRepoWorkspace` — `openRepoTerminalTab` (`state/repoTabs.ts:228`-`248`) opens the repo's Git workspace as its first line, which is exactly wrong here; (c) the tab strip's "+" and its menu builder, today repo-workspace-only (`TabStrip.vue:399`, `:227`-`:233`) | §6, §8 |
| Where an unscoped terminal starts | **The user's home directory**, resolved in Go by a new read-only `TerminalService.DefaultCwd`, hydrated once at boot. Not "empty cwd means home" inside `Open` — that would change a validated contract and leave the renderer's own session record lying about where the shell is | §7 |
| Left-panel script list: reuse P85's store, or a second one | **Reuse `custom_scripts` verbatim.** One table, one service, one broadcast channel, one Settings editor; the Terminal panel is a second *view* of that list, not a second list. Read, not inferred from P85's prose: `internal/storage/model/customscript.go`, `state/customScripts.ts`, `packages/shared/domain/scripts.ts` — the row is already `{name, command, workingDir, color}`, app-wide and repo-agnostic, which is P91's "a name plus a shell command" exactly | §10 |
| Is editing duplicated in the panel | **No.** The panel adds (two fields, the two SPEC names) and removes inline; "Edit…" deep-links to Settings > Scripts through the existing `openSettingsAt('Scripts')` (`state/settings.ts`, P85 §10.1) — one full editor, not two | §11.3 |
| How a user picks a repo/worktree for a scoped tab | The tab strip's "+" dropdown, the same affordance P83/P85 already use for launching — one entry per known repository row (`codeReposState.records`), labelled by name with its root path as the menu hint | §8 |
| What counts as a "known repository/worktree" | A `code_repos` row. Every worktree the user has opened is already its own row (`openRepoAtPath`, `state/coderepos.ts:73`-`90`) — that is the same path source P83's own row menus pass to `openRepoTerminalTab` | §8.1 |
| Flat list or nested-per-parent | **Flat.** Nesting needs `repo/state/repoLinks.ts`, whose only refresh trigger is a `codeReposState.records` change (`repoLinks.ts:33`) that has already fired before this module's own code ever loads — so nesting would need its own hydration call for a menu whose entries are *directories*, where a worktree is a peer of its parent, not a child | §8.2 |
| A per-script argument prompt | **Excluded by SPEC**, restated in §16 so a later phase does not read its absence as a bug | §16 |
| Any earned unit test | **None.** Module wiring, a registry entry, a CRUD-free panel and a one-line `os.UserHomeDir` wrapper are all below `CLAUDE.md`'s bar. Playwright covers the wiring | §18.1 |

---

# Part A — the module

## 1. What exists today

### 1.1 The module registry

`workbench/modes.ts` is a three-entry `Record<AppMode, ModeDef>` (`:28`-`:36`). `ModeDef` is
`{label, icon, panel, start}` (`:8`-`:16`): `panel` mounts in `WorkbenchShell.vue`'s left-panel
slot (`:18`, `MODES[moduleOfWorkspace(workspaceState.active)].panel`), `start` is `MainView.vue`'s
fallback when the active workspace has no active tab (`:15`). Git's two are
`defineAsyncComponent(() => import(...))` — P67b §4.6's own launch-chunk reasoning, which applies
identically here (nothing in a Studio-only session should pay for a terminal panel).

`TitleBar.vue` renders the rail: `MODE_ORDER: AppMode[] = ['studio', 'api', 'git']` (`:13`), a
`v-for` over it emitting `[data-testid="mode-tab"][data-mode="<mode>"]` buttons (`:26`-`:44`), and
`onClick` (`:19`-`:21`) calling `activateWorkspace`, with one special case for Git (return to
`lastRepoKey`).

That is the entire nav mechanism. There is no router, no second registry, no per-module shell.

### 1.2 The workspace seam

`WorkspaceKey = AppMode | 'repo:${string}'` (`domain/workspace.ts:7`);
`moduleOfWorkspace` folds a repo key onto `'git'` and returns everything else unchanged (`:26`-`:28`).
`activateWorkspace` (`state/workspace.ts:33`-`38`) sets `modeState.active` through `setModule`
(persisted, debounced) and `workspaceState.active`.

`workspaceKeyOf(tab)` is `tab.workspaceId ?? TAB_KIND_MODE[tab.kind]` (`state/mode.ts:77`), and
`tabsForWorkspace(key)` (`:88`-`:97`) is what the strip renders. Both are already total over any
`WorkspaceKey`; neither needs a change.

### 1.3 What the `terminal` tab kind assumes

Read directly, because this is the question SPEC asks this plan to settle:

- `domain/tabs.ts:332`-`346` — `terminalTabStateSchema` is `{cwd, codeRepoId, command, label,
  color, launchKind}`. `codeRepoId` is a plain string with no referential check anywhere.
- `state/tabKinds.ts:471`-`497` — `title` reads `label || basename(cwd) || 'Terminal'`; `icon` is
  fixed; `railColor` reads `state.color`; `dropResources` calls `closeTerminalSession`. Nothing
  reads `codeRepoId`.
- `state/terminals.ts:107`-`146` — `openTerminalSession(tabId, codeRepoId, cwd, cols, rows,
  command, launchKind)` stores `codeRepoId` in its own session record and forwards **only**
  `tabId, cwd, cols, rows, command, launchKind` to `control.terminalOpen` (`:130`-`:137`).
- `bridge/terminal.go:143`-`215` — `Open` validates `TerminalID`, `WindowKey`, dims, an absolute
  existing `Cwd`, command length and `LaunchKind`. No repository concept exists in this file, in
  `TerminalOpenArgs`, or in `internal/terminal.OpenParams`.
- `state/tabs.ts:134`-`135` — `persistableTabs()` drops every `kind === 'terminal'` row, so nothing
  in this phase touches persistence.

**Conclusion: the mechanism is generic as-is.** The only repo-shaped thing in the whole chain is
`openRepoTerminalTab`'s first line (`repoTabs.ts:233`, `openRepoWorkspace(codeRepoId)`) and the
`codeRepoId` field it fills, and §6 handles both without changing either.

## 2. The nav entry point — exact wiring

Four edits, in this order:

1. `packages/shared/domain/mode.ts:9` — `export type AppMode = 'studio' | 'api' | 'git' |
   'terminal';` plus one comment line in that file's own running history style.
2. `apps/kira-studio/frontend/src/workbench/modes.ts` — a fourth `MODES` entry:
   ```ts
   terminal: {
     label: 'Terminal',
     icon: 'terminal-bash',
     panel: defineAsyncComponent(() => import('../terminal/TerminalPanel.vue')),
     start: defineAsyncComponent(() => import('../terminal/TerminalStart.vue')),
   },
   ```
   Lazy for git's own reason (§1.1). `Record<AppMode, ModeDef>` makes this entry mandatory, so the
   type checker — not a reviewer — is what guarantees the registry stays total.
3. `TitleBar.vue:13` — `MODE_ORDER` gains `'terminal'` last. `onClick` (`:19`) needs **no** change:
   its `mode === 'git'` branch is untouched and every other mode already falls through to
   `activateWorkspace(mode)`.
4. Nothing else. `WorkbenchShell.vue:18` and `MainView.vue:15` are registry lookups and pick the
   new module up for free.

**Icon.** `'terminal-bash'`, the same glyph `tabKinds.ts:479` gives a terminal tab. Sharing a glyph
across the rail and the tab strip is the established pattern, not a collision: the Git mode tab and
the `repo-graph` tab kind are both `'source-control'` (`TitleBar` via `modes.ts:32`,
`tabKinds.ts:423`). Plain `'terminal'` is deliberately *not* used — the Studio `console` kind owns
it (`tabKinds.ts:249`), and P83 §7.2 already declined it for exactly that reason.

## 3. The one Go-side consequence

`model/window.go:30`'s `validWindowModes` gates `NormalizeMode`, which is what `WindowsService`
stores and returns (`bridge/windows.go:38`-`58`) and what `main.ts:296`'s
`hydrateMode(await control.windowsEnsure())` reads at boot. Without `"terminal": true` there, a
window last used in the Terminal module silently reopens in Studio — a real bug, not a cosmetic
one, and the only reason this frontend-shaped phase touches Go's storage layer at all.

`windows.mode` is unconstrained `TEXT` (`migrations/0014_p22_window_mode.sql`, and `window.go:27`-`28`
records the reasoning P67b already relied on), so there is **no migration**. Update the two stale
comments in that file while there (`:16` still says "studio or api", `:26` says "the only three
values").

## 4. The workspace key — no `TAB_KIND_MODE` change

`TAB_KIND_MODE.terminal` stays `'repo'`. That value is a sentinel meaning "read `workspaceId`", not
a claim about repositories (`domain/tabs.ts:69`-`74`), and `workspaceKeyOf`'s `??` already routes
every terminal tab through its own record. A Terminal-module tab therefore just carries
`workspaceId: 'terminal'`; a Git-module terminal tab keeps `workspaceId: 'repo:<id>'`. One tab
kind, two workspaces, zero branching.

Rejected: a second tab kind (`shell-terminal`) for the new module. It would duplicate four
vocabularies (`tabKindSchema`, `RENDERABLE_TAB_KINDS`, `TAB_KIND_MODE`, Go's
`model.RenderableTabKinds`), a `TabKindDef`, a `TAB_VIEWS` entry and a state schema, to produce a
tab that renders with the identical component and dies with the identical `dropResources` — the
second implementation SPEC explicitly rules out.

## 5. One latent line hardened

`state/tabs.ts:275`-`278` (`hydrateTabs`):

```ts
const key = workspaceKeyOf(t);
if (key === 'studio' || key === 'api') continue;
const repoId = key.slice('repo:'.length);
```

Any non-repo key that is not one of those two literals is treated as a repo key — `'terminal'`
would yield `repoId === 'nal'` and push garbage into `workspaceState.openRepos`. **Unreachable
today** (terminal tabs are never persisted, `:134`-`:135`), so this is hardening, not a bug fix:
replace the literal comparison with `if (!isRepoWorkspace(key)) continue;`
(`domain/workspace.ts:21`, already imported in this file's neighbourhood). One line, stated here so
the implementing pass does not skip it as unrelated.

---

# Part B — the tab area

## 6. Opening a terminal outside a repo

New file `state/terminalTabs.ts`, small on purpose:

```ts
export interface TerminalLaunch { command: string; label: string; color: PaletteColor; kind: TerminalLaunchKind; }

export function openTerminalTab(opts: {
  workspaceId: WorkspaceKey;
  cwd: string;
  codeRepoId?: string;
  launch?: TerminalLaunch;
}): OpenTabResult;
```

Its body is `repoTabs.ts:234`-`247` verbatim — `openTab('terminal', null, cwd, () => ({cwd:
canonicalPath(cwd), codeRepoId: opts.codeRepoId ?? '', command/label/color/launchKind from
launch}), {reuse: false, workspaceId: opts.workspaceId})` — **minus** the `openRepoWorkspace` call.

`repoTabs.ts`'s `openRepoTerminalTab` keeps its own signature and its `openRepoWorkspace(codeRepoId)`
first line, then delegates to `openTerminalTab({workspaceId: repoWorkspaceKey(codeRepoId), cwd,
codeRepoId, launch})`. Its three existing callers (`GitPanel.vue:185`, `:233`,
`TabStrip.vue:232`) are untouched.

`TerminalLaunch` moves from `repoTabs.ts:214`-`219` to the new file; `repoTabs.ts` re-exports the
type so no importer breaks, and `TabStrip.vue:12`'s import is repointed in the same commit.

Why a new function rather than an optional `skipWorkspace` flag on `openRepoTerminalTab`: the two
differ in *what workspace the tab belongs to*, which is that function's whole remaining job. A
boolean that inverts a function's primary effect reads worse at both call sites than two named
functions sharing one body.

`state/terminals.ts` is unchanged. `openTerminalSession(tabId, '', cwd, …)` is already valid —
`codeRepoId` is only read back by callers that put it there (§1.3).

## 7. The default working directory

New bound method, `internal/bridge/terminal.go`:

```go
type TerminalDefaultCwdResult struct{ Path string `json:"path"` }

func (s *TerminalService) DefaultCwd() TerminalDefaultCwdResult
```

`os.UserHomeDir()`; on error return `Path: ""` rather than an `ipcerr` — a missing `$HOME` must not
fail boot, and the empty string is what §7.2 handles. Read-only, no arguments, nothing
renderer-controlled reaches the OS.

Frontend: `state/terminals.ts` gains
`export const terminalDefaults = reactive({ cwd: '' })` and
`export async function hydrateTerminalDefaults(): Promise<void>`, joined to `main.ts:297`-`315`'s
boot `Promise.all` beside `hydrateCustomScripts()`. `bridge/index.ts` gains `terminalDefaultCwd`
next to the other four terminal calls (`:559`-`:585`).

Every unscoped launch then passes a **real absolute path** — as `cwd`, as the tab's own `path`
argument to `openTab`, and to `TerminalService.Open`. Nothing downstream learns a new special case:
`terminalCountAtPath` keeps comparing like with like, and the tab's `path` is never `''` (worth
noting given P92 item 8 is an unrelated "path is required" persistence error — this phase
deliberately does not introduce another empty-path tab, even though terminal tabs never persist).

### 7.1 Rejected: "empty `Cwd` means home", inside `Open`

It looks smaller (no new method, no hydrate) and is worse on three counts. It rewrites a validated
contract (`terminal.go:161`-`167`: absolute, exists, is a directory) into a conditional one. It
leaves `state/terminals.ts`'s session record holding `cwd: ''` while the shell actually runs in
`$HOME`, so `terminalCountAtPath` (`:180`-`:190`) and anything later reading a session's directory
are quietly wrong — repairable only by echoing the resolved path back through
`TerminalOpenResult`, at which point it is no smaller than §7. And it puts a policy ("where does an
unscoped terminal start") inside a validator. A named `DefaultCwd` also leaves room for a later
phase to make that a setting without renaming anything.

### 7.2 When `DefaultCwd` comes back empty

The "+"'s Terminal entry and `TerminalStart.vue`'s button render `disabled` with the hint
`Home directory unavailable`. No silent fallback to `/`, no launch that fails deep in Go with an
opaque message. Two bindings, no new error surface.

## 8. The "+" dropdown in the Terminal module

`TabStrip.vue` is the one file that changes.

**The button's gate.** `:399`'s `v-if="isRepoWorkspace(workspaceState.active)"` becomes a computed
`showNewTab` = `isRepoWorkspace(active) || active === 'terminal'`.

**The button must also exist with zero tabs.** Today the entire `.tab-strip-actions` block lives
inside `<div v-if="tabs.length > 0">` (`:292`), with a separate empty branch at `:420`. A repo
workspace always has its pinned graph tab, so that gap never showed; the Terminal module's *normal
initial state* is zero tabs, which would leave the module with no "+" at all. Fix without
duplicating markup and without breaking the three specs that assert `tab-strip-empty`
(`mode-switch.spec.ts:121`, `repo-workspace.spec.ts:224`, `tabs.spec.ts:193`): render one wrapper
always, binding the class and the testid —

```html
<div class="tab-strip-wrapper" :class="{ 'is-empty': tabs.length === 0 }"
     :data-testid="tabs.length > 0 ? 'tab-strip-wrapper' : 'tab-strip-empty'">
```

— and delete the `v-else` branch. `.tab-strip-pinned` already carries its own `v-if`; the scroller
with no children is an inert flex child; `.tab-strip-wrapper.is-empty`'s own padding rule (`:434`)
is unchanged.

**The menu.** `onNewTab` (`:219`-`:224`) keeps its anchoring and calls a second builder when the
active workspace is the Terminal module:

- `Terminal` (id `new-terminal`, icon `terminal-bash`) — `openTerminalTab({workspaceId:
  'terminal', cwd: terminalDefaults.cwd})`, disabled per §7.2.
- separator, emitted **only** when at least one repository row exists (P85 §6.1's own
  no-adjacent-rules rule).
- one item per `codeReposState.records` row: `id: 'repo-' + repo.id`, `label: repo.name`,
  `hint: repo.root`, `icon: 'repo'`, running `openTerminalTab({workspaceId: 'terminal', cwd:
  repo.root, codeRepoId: repo.id})`.

`launchInActiveWorkspace` (`:227`-`:233`) and `newTabMenuItems` (`:236`-`:289`) are untouched — the
Git module's dropdown keeps its exact current content.

### 8.1 What "known repositories/worktrees" resolves to

A `code_repos` row. `openRepoAtPath` (`state/coderepos.ts:73`-`90`) imports a worktree as its own
row the first time it is opened (P82's architecture, kept by P84), so `codeReposState.records`
already contains every repository *and* every worktree this app knows by path — the same rows
`GitPanel.vue:185`/`:233` hand to `openRepoTerminalTab` today. A worktree never opened in Git is
not offered; open it once there and it appears here. Stated plainly rather than papered over.

### 8.2 Rejected: nesting worktrees under their parent, and a live `worktree.list`

**Nesting** needs `worktreeParentId` (`repo/state/repoLinks.ts:11`-`13`), whose store is populated
by `refreshRepoWorktreeLinks()` — triggered by a `watch` on `codeReposState.records` with no
`immediate` (`:33`-`:39`) and by `GitPanel.vue:336`'s own `onMounted`. Boot assigns `records`
(`coderepos.ts:20`) long before this module's lazily-imported code exists, so the watcher has
nothing to fire on and the map would be empty exactly when the picker first opens — it would need
its own hydration call for cosmetics. And the nesting is wrong for this menu anyway: every entry
here is *a directory to start a shell in*, where a worktree is a peer of its parent, not a child of
it. P84's own fix was about the same worktree rendering **twice**; nothing here renders twice.

**A live `worktree.list`** (the `internal/gitsession` path, `gitsession/worktree.go:80`-`107`) is
rejected on mechanism, not on data quality: `repo/state/worktrees.ts` reaches it through a
per-repo gitsock transport plus a `repo.changed` subscription, held under a strict invariant — "a
lease exists exactly while a row is expanded" (`:94`-`:105`). A context menu is built
synchronously and cannot await; prefetching for every known repository would open one paired git
client per repository just to label a dropdown. Out of proportion to the gain.

### 8.3 What the Terminal module's dropdown deliberately does not carry

No `Claude Code` entry (P85/P86's surface, not asked for here), and no per-script entries — the
scripts are the left panel's entire job, one click away and always visible while the module is
open. Two identical launchers side by side is the outcome to avoid, not a feature.

## 9. The main area

Nothing new. `MainView.vue` renders `TAB_VIEWS[activeTab.kind]`, which for `terminal` is already
`RepoTerminalTabView` (`workbench/tabViews.ts:44`). `RepoTerminalView.vue` reads only
`tab.state.*` and passes `state.codeRepoId` straight through (`:56`-`:67`) — `''` is fine, and its
Claude Code hooks banner (`:100`-`:110`) is gated on `launchKind === 'claude-code'`, which no
launch in this module produces.

One free, correct consequence worth recording: a terminal opened here at a repository's root still
lights that repo's row indicator in the Git panel, because `terminalCountAtPath`
(`terminals.ts:180`-`:190`) keys on cwd, not on workspace. No code makes that happen and none
should.

---

# Part C — the left panel

## 10. The quick-command list reuses P85's `custom_scripts` — decided

This is the phase's one genuine data-model question. Resolved against the shipped source, not
P85's plan prose.

### 10.1 What P85 actually shipped

- `internal/storage/model/customscript.go` — `CustomScript{ID, Name, Command, WorkingDir, Color,
  SortOrder, CreatedAt, UpdatedAt}`, `CustomScriptFields{Name, Command, WorkingDir, Color}`, and
  `Validate()` (`:36`-`:52`) as the sole authority: name and command required and trimmed in place,
  `WorkingDir` empty or absolute, colour from the palette.
- `custom_scripts`, migration 0024 — a real table, **not** a settings leaf and **not**
  frontend-only. Nothing in the row is repository-scoped or module-scoped.
- `internal/bridge/customscripts.go` + `ChannelCustomScriptsChanged` — every mutation broadcasts
  the full list with `Emit` (not `EmitTo`), so a second window stays live.
- `state/customScripts.ts` — `customScriptsState.records`, hydrated in `main.ts`'s boot
  `Promise.all` (`:306`), re-subscribed on every hydrate; `createCustomScript` /
  `updateCustomScript` / `removeCustomScript` are three thin wrappers.
- `SettingsDialog.vue:639`-`751` + `:1417`+ — the editing surface: per-row name/command/workingDir
  committed on blur, an instant colour swatch, a confirmed remove, and a staged add row.

### 10.2 Why reuse

1. **Same shape, exactly.** SPEC's "a name plus a shell command, added/edited/removed by the user,
   starting empty, no predefined entries" describes `custom_scripts` field for field. `workingDir`
   and `color` are optional extras a quick command simply may leave unset.
2. **Nothing about the existing store is git-scoped.** It is app-wide storage that P85 happened to
   surface first in the git module's tab strip. P85 §11.3 already rejected a per-repository list
   for the same reason.
3. **One definition, two launch points, is what a user expects.** A script defined once appearing
   in both the Terminal panel and the Git "+" dropdown is the useful behaviour; two lists with
   identical fields would force a "which list is this?" decision on every add, and a "which list
   does the dropdown show?" decision on this phase.
4. **Cost of the alternative is real:** a second table and migration, a second model plus
   `Validate`, a second repo/service pair, a second broadcast channel, a second frontend store and
   hydrate, a second Settings surface — all to store `{name, command}` beside a table that already
   stores `{name, command, workingDir, color}`. That is the "hand-rolled second implementation"
   `CLAUDE.md` rules out, applied to a store rather than a library.

### 10.3 Rejected: a second, module-scoped list

The only honest argument for it is that a user might want quick commands that appear *only* in the
Terminal module. That is a per-surface **filter** on one list, not a second list — and nothing
asked for it. Recorded here so a later phase that does want it knows this was considered and knows
the cheaper shape (a flag on the row) rather than re-opening the storage question.

### 10.4 Two copy strings go stale

Both in `SettingsDialog.vue`, both must change in the same commit that adds the panel:

- `:713` — `Remove "<name>"? It will no longer launch from the tab strip.` → `… from the tab strip
  or the Terminal panel.`
- `:1419` — `Each script becomes an entry in the tab strip's "+" button, opening a new terminal
  …` → wording that names both surfaces.

Small, and exactly the kind of thing a reuse decision silently breaks if nobody writes it down.

## 11. `terminal/TerminalPanel.vue`

New top-level frontend folder `apps/kira-studio/frontend/src/terminal/`, peer to `repo/`, `api/`,
`project/`. `biome.json` gains an `includes` override for
`apps/kira-studio/frontend/src/terminal/**` mirroring `repo/**`'s (`:134`-`:152`): no `**/views/**`
import (dispatch through `state/`), no `**/http/**` or `**/api/**`. Same rule, same reason — the
dependency graph stays a tree.

### 11.1 Shape

One `PanelShell` (`theme/primitives/PanelShell.vue`), the shape `GitPanel.vue:345`-`531` already
establishes:

- `#title` — `Quick commands`.
- `#actions` — an `add` `IconButton` (reveals the inline add row) and a `settings-gear`
  `IconButton` running `openSettingsAt('Scripts')`, tooltipped `Manage scripts…`.
- `#body` — the list, plus the add row while open.
- `#empty` — `empty` is bound to `records.length === 0 && !adding`; an `EmptyState` (icon
  `terminal-bash`, label `No quick commands`) with one primary button that opens the add row.
- Panel search stays on (`PanelShell`'s default), filtering rows by name and command.

### 11.2 Rows

`customScriptsState.records` in store order (creation order — `sort_order`; a reorder UI stays out
of scope, P85 §13). Each row: the script's colour swatch, or a `play` icon when `color === 'none'`
(the same rule `TabStrip.vue:268` already uses), the name, and the command in a muted second line,
`text-overflow: ellipsis` at panel width.

- **Click** runs it: `openTerminalTab({workspaceId: 'terminal', cwd: script.workingDir ||
  terminalDefaults.cwd, launch: {command: script.command, label: script.name, color: script.color,
  kind: 'script'}})`. The tab therefore titles itself with the script's name and paints its rail
  with the script's colour, through `tabKinds.ts:473`-`481` — no new title or colour logic.
- **Context menu** (`openContextMenu`): `Run`, `Edit…` (`openSettingsAt('Scripts')`), separator,
  `Remove` (`danger`), reusing `confirmDialog` with the §10.4 copy.

`data-testid`s: `terminal-panel`, `quick-command-list`, `quick-command-<id>`,
`quick-command-add`, `quick-command-add-name`, `quick-command-add-command`,
`quick-command-add-confirm`, `quick-commands-manage`.

### 11.3 Add, edit, remove — and why editing is a deep link

Add and remove are inline because SPEC names them and because both are one field-pair and one
confirm. Full editing (rename, re-command, working directory, colour) deep-links to the Settings
section P85 already built and already tests, for three reasons: a 180-480px panel
(`WorkbenchShell.vue`'s splitter bounds) cannot hold four labelled fields legibly; a second full
editor is a second place for the same rules to drift; and P85 already established that section as
*the* script editor, reached from the "+" dropdown by the identical `openSettingsAt('Scripts')`
call. This is a route to the one editor, not a stub.

The add row is two fields (name, command) plus Add/Cancel, staged locally and committed with
`createCustomScript` — `SettingsDialog.vue:721`-`750`'s own posture, including trimming both fields
before building `CustomScriptFields` (P85's own late fix, `f0b49b04`) and surfacing the backend
error inline. `workingDir` and `color` are left at `''`/`'none'`; a quick command added here runs in
the module's default cwd until the user sets one in Settings.

### 11.4 Mount

`onMounted` does nothing. The panel reads `customScriptsState`, hydrated at boot and kept live by
P85's broadcast subscription — so a script added in another window appears here with no work from
this phase. Worth stating: §8.2's rejected nesting is the only thing that would have needed a
mount-time fetch, and it is gone.

## 12. `terminal/TerminalStart.vue`

`MainView.vue`'s fallback when the module has no tab — the state a fresh install always opens in.
`GitStart.vue` verbatim in shape: an `EmptyState` (icon `terminal-bash`, label `No terminal open`)
with one primary button, `New terminal`, running the same unscoped launch as the "+"'s first entry,
disabled per §7.2. `data-testid="terminal-start"`.

## 13. Styling

No new tokens. Rows reuse the panel row rhythm `GitPanel.vue`'s own repo rows already use
(`--kira-s-*`, `--kira-hover`, `--kira-fg-muted`); the colour swatch reuses the swatch markup
`ContextMenu.vue` renders for `MenuItem.swatch`. `scripts/check-tokens.sh` must stay clean — no
literal colours, no hard-coded pixel values outside the existing token set.

---

## 14. What this phase does not touch

Confirmed by reading the current tree, not assumed:

- `internal/terminal/` — no file. The PTY, the shell resolution, the reader goroutine, `Close`'s
  signal sequence: unchanged.
- `bridge/terminal.go`'s `Open`/`Write`/`Resize`/`Close`, the coalescer, `ChannelTerminal` — one
  new method is added to the service (§7); no existing method's args, validation or result change.
- `internal/agenthooks`, `AgentHooksService`, `ChannelAgentSessions`, `StatusBar.vue` — nothing in
  this module launches a `claude-code` kind, so P86's count and hooks are untouched and correct
  by construction.
- `repo/GitPanel.vue`, `repo/state/*` — no edit. The terminal indicator keeps working across the
  module boundary for free (§9).
- `views/repo/RepoTerminalView.vue`, `views/repo/terminalRenderer.ts` — no edit.
- `custom_scripts`' Go side (model, repo, service, channel) — no edit; the panel writes through the
  existing `state/customScripts.ts` wrappers.
- `packages/git-ui/`, `packages/git-ipc/`, `apps/kira-studio-vscode/` — no file, no
  `CONTRACT_VERSION` bump.

## 15. Deliberately out of scope

Per SPEC's own "deliberately simple" carve-out — **each of these is excluded by instruction, so a
later phase must not read its absence as a bug:**

- **Split panes.** One terminal per tab, full stop.
- **Saved or restorable session state** beyond what the tab kind already gives. `persistableTabs()`
  (`state/tabs.ts:134`-`135`) keeps dropping every terminal row; a restart opens the Terminal
  module empty, on `TerminalStart.vue`. No scrollback persistence, no session restore, no
  reattach.
- **Per-script argument prompts.** A quick command runs its exact configured command, with no
  parameterization, no `$1`, no substitution.

Also out of scope, by this plan's own scoping rather than SPEC's:

- Reordering quick commands (P85 §13 already excluded it for the same list).
- A per-surface filter deciding which scripts show where (§10.3).
- A `Claude Code` entry in this module's dropdown (§8.3).
- Worktree enumeration beyond known `code_repos` rows (§8.1/§8.2).
- A command palette entry or keybinding per script, and a keybinding for "new terminal".
- Terminal-module settings of any kind (default shell, default cwd override, font). Appearance
  already drives the renderer live (`RepoTerminalView.vue:88`-`97`).
- `docs/ARCHITECTURE.md` / `README.md` — chapter docs are their own phase's job.

## 16. Files

Added:

- `apps/kira-studio/frontend/src/terminal/TerminalPanel.vue`
- `apps/kira-studio/frontend/src/terminal/TerminalStart.vue`
- `apps/kira-studio/frontend/src/state/terminalTabs.ts`
- `apps/kira-studio/tests/ui/terminal-module.spec.ts`

Changed:

- `packages/shared/domain/mode.ts` — `AppMode` gains `'terminal'`.
- `apps/kira-studio/internal/storage/model/window.go` — `validWindowModes` entry, two stale
  comments.
- `apps/kira-studio/internal/bridge/terminal.go` — `DefaultCwd`.
- `apps/kira-studio/frontend/bindings/**` — regenerated (`wails3 task common:generate:bindings`).
- `apps/kira-studio/frontend/src/bridge/index.ts` — `terminalDefaultCwd`.
- `apps/kira-studio/frontend/src/state/terminals.ts` — `terminalDefaults`,
  `hydrateTerminalDefaults`.
- `apps/kira-studio/frontend/src/main.ts` — one hydrate in the boot `Promise.all`.
- `apps/kira-studio/frontend/src/workbench/modes.ts` — the fourth `MODES` entry.
- `apps/kira-studio/frontend/src/workbench/TitleBar.vue` — `MODE_ORDER`.
- `apps/kira-studio/frontend/src/workbench/panels/TabStrip.vue` — `showNewTab`, the always-rendered
  wrapper, the Terminal-module menu builder, the `TerminalLaunch` import.
- `apps/kira-studio/frontend/src/state/repoTabs.ts` — `openRepoTerminalTab` delegates;
  `TerminalLaunch` moves out and is re-exported.
- `apps/kira-studio/frontend/src/state/tabs.ts` — §5's one-line hardening.
- `apps/kira-studio/frontend/src/workbench/SettingsDialog.vue` — §10.4's two strings.
- `biome.json` — the `terminal/**` override.
- `apps/kira-studio/tests/ui/support/ipcChannels.ts`,
  `apps/kira-studio/tests/ui/support/mockRuntime.ts` — one channel, one FQN, one default response.
- `apps/kira-studio/tests/ui/mode-switch.spec.ts`,
  `apps/kira-studio/tests/ui/repo-workspace.spec.ts` — the mode-tab count migration (§18.3).

## 17. Tests

### 17.1 No earned unit test

`CLAUDE.md`'s bar excludes every piece of this phase. `DefaultCwd` is a one-line `os.UserHomeDir`
wrapper. `openTerminalTab` is a thin `openTab` call. The panel is a list plus create/remove
round-trips — CRUD, explicitly named as not earning a test. There is no parser, no boundary
arithmetic, no cache invalidation, no concurrency. `internal/terminal/session_test.go` already
covers the PTY properties P83/P85 needed and gains nothing from a fourth caller.

### 17.2 Playwright — `apps/kira-studio/tests/ui/terminal-module.spec.ts`

New file, modelled on `repo-workspace.spec.ts`'s terminal cases (its `TERMINAL_OPEN_OK` snapshot
shape, `:1039`-`:1043`, and its `control.log()` polling rather than call-count assertions) and on
`settings-scripts.spec.ts` for the script fixtures:

1. **The module exists and opens.** Four mode tabs; clicking `[data-mode="terminal"]` makes it
   active, mounts `terminal-panel` with its empty state, and shows `terminal-start` in the main
   area.
2. **An unscoped terminal.** The strip's "+" (present with zero tabs — §8's own fix) → `Terminal`
   opens one `terminal` tab titled `Terminal`... (title falls out of `basename(cwd)`, so assert on
   the mocked `DefaultCwd` basename), `terminalOpen` called with that cwd and `command: ''`, and
   `.xterm-rows` present — the same renderer proof P83's case makes.
3. **A repo-scoped terminal.** With one repository in `codeWorkspaceListRepos`, the "+" menu
   carries `menu-item-repo-<id>`; clicking it opens a terminal whose `terminalOpen` cwd is that
   repo's root, **and** the active module is still Terminal (the regression this phase's §6 split
   exists to prevent — `openRepoWorkspace` must not run).
4. **One store, two surfaces.** A script seeded into `customScriptsList` renders both as a
   `quick-command-<id>` row in the Terminal panel and as `menu-item-script-<id>` in a repo
   workspace's own "+" dropdown. This is the test that pins §10's decision.
5. **Running a quick command.** Clicking a panel row opens a terminal tab titled with the script's
   name, with `terminalOpen` carrying the script's `command`, and its `workingDir` as cwd when set
   (asserted by differing from the default cwd — P85's own proof shape).
6. **Adding a quick command.** The add row calls `customScriptsCreate` with trimmed name/command;
   Add stays disabled while either is empty.

**Locator warning for the implementing pass**, from P85's own late fix (`f0b49b04`): a menu row's
testid is `menu-item-${item.id}`, so a script fixture whose id is already `script-1` renders
`menu-item-script-script-1`. Compute the testid from the real id, never hand-write it.

### 17.3 Two existing assertions migrate

- `mode-switch.spec.ts:85` — `toHaveCount(3)` → `4`, and the test's own name/comment ("three mode
  tabs") updated.
- `repo-workspace.spec.ts:191` — same count, no other change.

`mode-switch.spec.ts:305`-`336`'s icon-ink guard currently measures studio/api/git; extend it to
the Terminal tab for consistency with how P67b extended it to Git (`:312`'s own comment). Cheap,
and it is the one place a new rail entry's glyph sizing is actually checked.

### 17.4 Known gap, stated

No manual GUI pass. Same constraint every phase in this chapter has recorded (P83 §17.4, restated
in P85 and P90): no display, and `apps/kira-studio`'s Taskfile defines only `darwin:*` tasks, so
there is nothing to launch here even in principle. Specifically unverified by any tier: a real
shell actually starting in `$HOME` from this module, and the cross-window broadcast keeping a
second window's panel live (P85 §15.3 already records the latter as a deliberate Playwright gap).

## 18. Checks

Per commit: `bun run typecheck`, `biome check .`, `scripts/check-tokens.sh`, `bun run build`. Go
commits also `go build ./...` and `go vet ./...`. Bindings regenerated with
`wails3 task common:generate:bindings` in the same commit as the Go change plus the
`ipcChannels.ts`/`mockRuntime.ts` entries, per `mockRuntime.spec.ts`'s FQN guard.

Once, near the end: `go test ./...`, `bun run test:unit`, `bun run test:ui` (`ui` + `ui-timing`),
`bun run build:vscode`, `bun run test:webview`. Fixes land as follow-up commits — `CLAUDE.md`'s
"implement the whole plan first, then test once" rule.

## 19. Order and commits

**There is little internal sequencing risk here, and this plan says so rather than inventing
structure.** Both mechanisms this phase stands on are already landed and already tested; the only
hard dependency is that the module must exist before anything can render inside it.

1. `feat(shell): add the Terminal module's nav entry point` — §2, §3, §5. `AppMode`, `validWindowModes`,
   `MODES` (pointing at two placeholder-free components added in this same commit as minimal
   shells), `MODE_ORDER`, the `tabs.ts` hardening, the `biome.json` override.
2. `feat(terminal): resolve the default working directory` — §7. Go method, bindings, bridge,
   store, boot hydrate, harness channel entries.
3. `refactor(tabs): split terminal-tab creation from repo-workspace activation` — §6.
   `state/terminalTabs.ts`, `openRepoTerminalTab` delegating, the `TerminalLaunch` move. No
   user-visible change.
4. `feat(terminal): open shell and repo-scoped terminals from the tab strip` — §8. `TabStrip.vue`'s
   wrapper restructure, `showNewTab`, the new menu builder. `TerminalStart.vue` filled in (§12).
5. `feat(terminal): the quick-command panel` — §11 plus §10.4's two strings.
6. `test(ui): cover the Terminal module, quick commands and repo-scoped terminals` — §17.2, §17.3.

Commits 2 and 3 are independent of each other; 4 needs both; 5 needs 4 only for the shared launch
helper. Sequential in one subagent regardless (§20).

## 20. Passes and subagents

One Sonnet subagent, sequential, for the whole phase. Nothing here is genuinely parallelizable:
every commit after the first edits either `TabStrip.vue` or the same new `state/terminalTabs.ts`,
and the test commit depends on all of them. Per `CLAUDE.md`, a continuous, order-dependent piece of
work is never split across concurrent subagents to run it faster.

## 21. Open questions

- **OQ-1.** The Terminal mode tab sits last in `MODE_ORDER`. If the rail should instead read
  Studio · Api · Terminal · Git, that is a one-line change and a cosmetic call — shipped last
  unless the implementing pass is told otherwise.
- **OQ-2.** Clicking the Terminal rail entry returns to the module's own last active tab through
  `tabsState.activeIdByWorkspace['terminal']`, with no Git-style "return to where you were" special
  case (`TitleBar.vue:19`-`21`), because there is no per-instance workspace here to return to. If
  the module should instead always land on `TerminalStart`, say so — this plan assumes it should
  not.
- **OQ-3.** Quick commands launched from the panel always use `workspaceId: 'terminal'`, even when
  their `workingDir` is a known repository's root. A future phase might prefer such a launch to
  land in that repository's Git workspace; this phase deliberately does not guess, because the
  panel is the Terminal module's own surface.

## 22. Dogfooding note

The repo-map MCP server was started for this planning pass (`bun run mcp:repo-map`, fresh token
after deleting the stale `mcp-repo-map-fc694cca06c3-token.json` per `CLAUDE.md`) and queried over
plain HTTP/JSON-RPC — `find_references` on `openRepoTerminalTab`, `moduleOfWorkspace`,
`workspaceKeyOf` and `setMode`. All four answered correctly and usefully; the `setMode` query
correctly reported two same-named symbols and asked for a narrowing argument rather than guessing.
Nothing to log in `docs/v1.8/mcp-repo-map-issues.md`.
