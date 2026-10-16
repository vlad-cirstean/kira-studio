# C5 — Native code-viewing workspace, shell and viewer: repo import, tabs, project tree, Monaco file viewer

> **What this phase is.** `docs/v1.5/SPEC.md`'s C5 row turned into steps, from research against the
> real tree at cd88c65c: the tab/mode system (`state/tabs.ts`, `state/mode.ts`, `TabStrip.vue`,
> `workbench/modes.ts`), the connections panel (`ProjectPanel.vue`, `state/connections.ts`,
> `packages/shared/domain/connection.ts`), the tree primitives (`ProjectTree.vue`, `TreeHost.vue`,
> `VirtualList.vue`), C1's shipped `internal/codeindex` package, and `internal/gitclient`'s existing
> read primitives (`porcelain`, `catfile`).

## 0. This phase was split during its own planning pass

The original single "C5" row (repo import through Monaco definition/hover navigation) was too much
for one coherent Sonnet implementation pass and one verification pass to hold at once:

- **This half rewrites load-bearing shared state.** `state/tabs.ts` (689 lines, every open/close/
  reorder/activate path in the app) gains a second scoping dimension. `tests/ui/tabs.spec.ts`,
  `mode-switch.spec.ts`, `smoke.spec.ts` plus the visual suite are the regression surface. That
  deserves its own verification pass before anything is stacked on it.
- **The other half's failure modes are unrelated and environmental**: a worker chunk loading under
  the Wails asset server, a bundler entry point that must be verified against the pinned Monaco
  package layout, and provider registrations against `internal/codegraph`. Debugging those against a
  shell that is itself half-built is the expensive ordering.

**This document covers only this half**: import a repository, open it as its own isolated workspace
with the pinned graph slot reserved, browse every file, open any file into a preview or permanent
tab rendered read-only by Monaco with syntax highlighting. Complete and usable on its own.

**Diff tabs and code navigation are deferred to C6**, a separate phase with its own plan, written
fresh once this phase's actual shipped shape exists to plan against — not against this document's
predictions of it. The index lifecycle (`codeindex.Index` per repository) is needed only by
navigation, so nothing in this phase is a placeholder waiting on C6 except the graph tab itself,
which is SPEC's own deliberate C9 hand-off (§6.2).

## 1. What SPEC left open, and how each is resolved

**D1 — A repo entry is a parallel list with its own schema, rendered in the same panel. Never an
extended `ConnectionSummary`.** Read against the real schema, extending it is not a close call:
`connectionFieldsSchema` has sixteen fields, and a repository needs none of them (host, port,
database, username, password, uri, options, mode, readOnly, preconnect, preconnectSidecar,
autoExplain, throttlePerSec, color, kind, name — only `name` survives). `connectionInputSchema`'s
`superRefine` *requires* host+port or a uri; `connectionKindSchema` is a closed ten-value enum that
routes to an adapter, so a `'git'` member would appear in every `connectionsState.states[id].caps`
path, the Go engine router, the secrets store and the connection dialog. `tabs.connection_id`
carries `ON DELETE CASCADE` to `connections`. A repo entry gets `code_repos` (§3.1),
`RepoSummary` (§3.2) and its own section inside `ProjectPanel.vue` (§3.4). §3.

**D2 — Tab isolation is a new orthogonal *workspace* dimension, not a new `AppMode` and not a
per-kind mapping.** `TAB_KIND_MODE` is `kind -> mode`, a total function, which structurally cannot
express "this file tab belongs to repository X" — two repos have the same kinds. So `TabRecord`
gains one nullable field, `workspaceId`, and one derivation replaces the mode filter everywhere:
`workspaceKeyOf(tab) = tab.workspaceId ?? TAB_KIND_MODE[tab.kind]`. `null` is every tab that exists
today, so `studio`/`api` behave byte-identically (SPEC's own out-of-scope line). `modeState` keeps
its exact current meaning; a second, small `workspaceState` selects which tab set is on screen. §4.

**D3 — The preview slot is one entry per workspace, not a boolean per tab.** "At most one preview
tab per workspace" is the whole invariant; a `Record<WorkspaceKey, string | null>` makes it true by
construction, where a per-tab boolean can hold two `true`s. In-memory only, like
`tabsState.hydrated` — no schema change, and a restored session comes back with every tab permanent.
§5.

**D4 — Pinning is a property of the tab *kind*, not a per-tab flag, and pinned-first is enforced by
the selector, not by array order.** `TabKindDef` gains `pinned?: true`; `tabsForWorkspace` returns a
stable partition (pinned first, then the rest, each in array order), so the invariant survives every
`moveTab` splice rather than depending on one. §6.

**D5 — This phase owns the `repo-graph` kind, its pin, and a placeholder view. C9 replaces exactly
one registry line.** §6.2 states the contract precisely.

**D6 — The file list comes from C1's own git enumeration, widened — never a second `.gitignore`
implementation.** `codeindex.Enumerate` already runs
`git ls-files -z --cached --others --exclude-standard` through `gitclient.Spec` (argv only, no
shell, `--no-optional-locks`, `ReadOnly: true`, process-group kill) and applies `gitpath`'s tier-2
byte rule — but it filters to C1's parseable-extension map, which is wrong for a project tree that
must show `README.md` and `Taskfile.yml`. This phase extracts the unfiltered lister
(`codeindex.EnumerateAll`) and has `Enumerate` call it. One argv, one place. §7.1.

**D7 — Monaco is loaded through `edcore.main.js` plus explicit `basic-languages` contributions, and
exactly one worker ships: `editor.worker`.** The package root (`monaco-editor` ->
`esm/vs/editor/editor.main.js`) pulls in all four language *services* — which is what SPEC forbids —
so it is never imported. `edcore.main` is the editor plus its standard contributions (find widget,
hover, folding, bracket matching) with no `vs/language/*` at all. The `editor.worker` is **not** a
language-service worker: it backs `IEditorWorkerService`, which is what C6's diff-editor widget will
compute its diff in. Dropping it would leave that widget unable to compute anything once C6 lands.
This is a stated, deliberate reading of SPEC's parenthetical `editor.worker` mention: typescript/
json/css/html workers never exist in the bundle (their modules are never imported), and the one
remaining worker does no language analysis. §9.2.

**D8 — Monaco is a lazy chunk, reached through one entry module.** `views/repo/monacoEntry.ts`, the
same shape `views/console/sqlFormatterEntry.ts` and `views/httprequest/mergeEntry.ts` already use
(static re-exports inside the entry so the bundler still tree-shakes; one `await import()` at the
call site). Studio/Api users never download it. `docs/ARCHITECTURE.md`'s renderer-build row counts
these chunks by name and gains one. §9.1.

**D9 — Monarch grammars: a named registered set, everything else plain text.** §9.4's table, with
`.vue`/`.svelte` colored by the HTML grammar (the same container choice C1 made, for the same
reason) and `.json` colored by the JavaScript Monarch definition (Monaco ships JSON coloring only
inside the JSON *language service*, which is exactly what is excluded). Both limits stated in
`docs/ARCHITECTURE.md`.

**D11 — This phase gets its own bound Wails service. It never touches `git.sock`.** The native
renderer's own IPC is Wails bindings (`internal/bridge/*`, `frontend/src/bridge/index.ts`);
`git.sock` exists to gate an *external* VS Code process, and SPEC assigns that transport question to
C9. The service calls `internal/gitclient` in-process for the one read primitive it needs here
(status, for the tree's modified/untracked coloring), reusing `porcelain.StatusArgs`/`ParseStatus`
rather than adding argv. §8.

**In scope**: repo storage and import (§3), workspaces and tab isolation (§4), preview tabs (§5),
the pinned slot (§6), the file tree (§7), file content (§8), Monaco (§9), read-only enforcement
(§11), what later phases get from this one (§12), steps (§14), tests (§15), docs (§16),
verification (§17).

**Not attempted** (§13): the graph itself, diff tabs, code navigation (definition/hover/references/
implementations), the `codeindex.Index` lifecycle, search, quick open, the review layer, per-
connection isolation for `studio`/`api`, any write path, tree compaction, and a live-refreshing file
tree.

## 2. Where the code lives

```
apps/kira-studio/internal/codeworkspace/        new Go package, pure Go
  session.go      per-repo session registry: root, repoID, runner, gitPath
  files.go        ListFiles (EnumerateAll + status overlay), ReadFile
  paths.go        repo-relative path validation (no escape above root)     [§11]

apps/kira-studio/internal/codeindex/
  enumerate.go    +EnumerateAll (unfiltered); Enumerate now calls it        [D6]

apps/kira-studio/internal/bridge/codeworkspace.go   the bound service
apps/kira-studio/internal/storage/migrations/0018_c5_code_repos.sql
apps/kira-studio/internal/storage/model/coderepos.go
apps/kira-studio/internal/storage/repos/coderepos.go

packages/shared/domain/repo.ts          RepoSummary, RepoImportResult, FileListing, FileContent
packages/shared/domain/tabs.ts          +2 kinds (repo-graph, repo-file), +workspaceId, TabScope
packages/shared/domain/workspace.ts     WorkspaceKey / workspaceKeyOf helpers

apps/kira-studio/frontend/src/
  state/coderepos.ts      the repo list store (hydrate, import, rename, remove)
  state/workspace.ts      the active workspace, the open-workspace list, open/close
  state/repoTabs.ts       openRepoFileTab / ensureWorkspaceShell
  state/tabs.ts           workspace scoping, preview slot, pin guards
  state/mode.ts           tabsForWorkspace beside tabsForMode
  state/tabKinds.ts       2 entries, +pinned member
  repo/RepoPanel.vue      the repo workspace's left panel (PanelShell + the tree)
  repo/RepoFileTree.vue   the filesystem tree (TreeHost-hosted)
  repo/RepoTreeRow.vue    one row
  repo/state/fileTree.ts  path list -> row model, expand/filter state
  repo/menus.ts           row context menu
  views/repo/RepoFileView.vue      Monaco, read-only
  views/repo/RepoGraphView.vue     the C9 placeholder
  views/repo/monacoEntry.ts        the one dynamic-import boundary
  views/repo/monaco.ts             init, theme, language registry, model cache
  views/repo/language.ts           extension -> language id map
  views/repo/editors.ts            tabId -> editor instance (C6/C10's seam, §12)
  workbench/modes.ts               +REPO_WORKSPACE (a ModeDef-shaped sibling)
  workbench/tabViews.ts            2 entries
  workbench/TitleBar.vue           the workspace switcher
  workbench/WorkbenchShell.vue     panel dispatch by workspace, not by mode
  workbench/panels/TabStrip.vue    preview italics, pin guards, drag guards
  workbench/panels/ProjectPanel.vue  +the Repositories section
```

Layering: `internal/codeworkspace` imports `codeindex`, `gitclient`, never `internal/bridge`
(`internal/layering_test.go` picks it up automatically). `biome.json` gains a `repo/**` block
mirroring `project/**`'s: no `views/**`, no `api/**`, no `http/**` — the repo panel opens tabs
through `state/repoTabs.ts`, exactly as `project/` dispatches through `state/viewCommands.ts`.

## 3. Repo import

### 3.1 Storage — `0018_c5_code_repos.sql`

```sql
CREATE TABLE code_repos (
  id         TEXT PRIMARY KEY,       -- crypto.randomUUID(), this app's own handle
  name       TEXT NOT NULL,          -- editable label; defaults to the root's basename
  root       TEXT NOT NULL,          -- absolute worktree root, NFC-normalized (gitpath tier 1)
  repo_id    TEXT NOT NULL,          -- gitclient.Identify's own identity; what codeindex keys on
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX code_repos_repo ON code_repos (repo_id);

ALTER TABLE tabs ADD COLUMN workspace_id TEXT;   -- NULL = studio/api, 'repo:<code_repos.id>'
```

`ADD COLUMN` with no default rewrites no existing row: every tab already stored parses as
`workspace_id IS NULL`, which is exactly "derive from kind" (D2). `repo_id` is `UNIQUE` so two
spellings of one checkout cannot be imported twice, matching how `codeindex.db` already scopes rows.
No foreign key from `tabs` — the value is a key, not a row reference — but `CodeRepoRepo.Remove`
deletes that workspace's tab rows in the same transaction, so the store stays consistent even if the
renderer never gets to close them.

`model.TabRecord` gains `WorkspaceID *string`; `Validate()` rejects a `repo-*` kind with no
workspace id and accepts the two new kinds through `RenderableTabKinds` (which
`tests/unit/go-ts-vocabulary-parity.spec.ts` already guards against the TS list drifting).

### 3.2 Domain

```ts
// packages/shared/domain/repo.ts
export const repoSummarySchema = z.object({
  id: z.string(), name: z.string().min(1).max(120),
  root: z.string(), repoId: z.string(),
  sortOrder: z.number(), createdAt: z.string(),
});
```

Nothing secret, nothing credential-shaped: a repository is a path this user already has open.

### 3.3 The bound service

`internal/bridge/codeworkspace.go`, `CodeWorkspaceService`, registered in `main.go`'s `Services`
slice beside `RepoMapService`. Methods:

| Method | Returns | Notes |
|---|---|---|
| `ListRepos()` | `[]RepoSummary` | |
| `ImportRepo(path)` | `RepoSummary` | `gitclient.Identify`; refuses a bare repo and a non-repository with a plain `E_INVALID` message |
| `RenameRepo(id, name)` | `RepoSummary` | |
| `RemoveRepo(id)` | — | drops the row, its tab rows, and stops any session |
| `ListFiles(id)` | `FileListing` | §7.1 |
| `ReadFile(id, path)` | `FileContent` | §8.1 |

Import reuses the existing `FilesService.ChooseFolder` dialog (`control.filesChooseFolder`) — no new
dialog, no new native picker.

### 3.4 The panel

`ProjectPanel.vue` keeps its title, its search box and its `PanelShell`. Its `#actions` slot gains a
second `IconButton` (`repo`, "Import repository…"), and its `#body` renders a `RepoListSection`
above the existing `<ProjectTree />`: a small header row ("Repositories"), one row per imported
repo (icon + name + a right-click menu: Open, Rename…, Remove, Copy path), collapsible, hidden
entirely when the list is empty. The panel's `:empty` condition widens to
`connections.length === 0 && repos.length === 0`. The panel search filters repo names by substring
alongside the tree's own filtering.

Title left as "Connections": renaming it is a one-line change with a visual-snapshot cost and no
functional gain, and the panel's own empty-state copy ("Everything you connect to shows up here")
already reads correctly for both. Noted here so a later phase can revisit it deliberately rather
than by accident.

Single click selects; **double click, or the Open menu item, opens the workspace** — the tree's own
select/open split, unchanged.

## 4. Workspaces and tab isolation

### 4.1 The key

```ts
// packages/shared/domain/workspace.ts
export type WorkspaceKey = AppMode | `repo:${string}`;
export function repoWorkspaceKey(repoId: string): WorkspaceKey { return `repo:${repoId}`; }
export function repoIdOfWorkspace(key: WorkspaceKey): string | null { … }
```

`TAB_KIND_MODE`'s value type widens from `AppMode` to `TabScope = AppMode | 'repo'`. The two new
kinds map to `'repo'` — a sentinel meaning "this kind's workspace comes from the record, never from
the kind". `tabsForMode(mode: AppMode)` compares for equality against an `AppMode`, so a repo tab
can never match a mode's strip: the isolation SPEC asks for is enforced by the value, not only by a
filter someone has to remember to write.

```ts
// state/mode.ts
export function workspaceKeyOf(tab: TabRecord): WorkspaceKey {
  return (tab.workspaceId as WorkspaceKey | null) ?? (TAB_KIND_MODE[tab.kind] as AppMode);
}
export function tabsForWorkspace(key: WorkspaceKey): TabRecord[] { … }  // §6.1's partition
```

### 4.2 State

- `TabRecord` base gains `workspaceId: z.string().nullable().default(null)`. One line in
  `tabRecordBase`, so all union members carry it; `.default(null)` is what keeps every stored
  row parsing (`storage/repos/tabs.ts` drops a row outright on a failed parse).
- `tabsState.activeIdByMode: Record<AppMode, string | null>` becomes
  `tabsState.activeIdByWorkspace: Record<WorkspaceKey, string | null>`, a lazily-keyed record. Every
  read site (`setActiveTabId`, `closeTab`, `closeOthers`, `closeToTheRight`, `closeAll`, `stepTab`,
  `hydrateTabs`, `activeTab`, `TabStrip.vue`) swaps `mode` for `workspaceKeyOf(tab)` — a mechanical
  edit that makes each of those operations correct for repo workspaces at no extra cost.
- `openTab`'s dedupe key becomes `(workspaceId, kind, connectionId, path)`. Load-bearing: two
  repositories routinely hold the same relative path, and today's key would collapse them.
- `state/workspace.ts`:
  ```ts
  export const workspaceState = reactive({
    active: 'studio' as WorkspaceKey,
    openRepos: [] as string[],     // code_repos.id, in switcher order
  });
  export function openRepoWorkspace(repoId: string): void  // ensures shell (§6.1), activates
  export function closeRepoWorkspace(repoId: string): void // closes its tabs, drops from openRepos
  export function activateWorkspace(key: WorkspaceKey): void
  ```
  `setMode(m)` also sets `workspaceState.active = m`; switching to a repo workspace leaves
  `modeState.active` untouched, so leaving the repo returns to the module you were in and the Go
  side's `windows.mode` (a two-value column) needs no new member and no migration.

**Nothing new is persisted beyond `tabs.workspace_id`.** On boot, `hydrateTabs` derives `openRepos`
from the distinct `workspace_id`s among restored tabs, dropping any whose repo no longer exists
(`closeTab`, so pages and runtime free through the one existing path). `workspaceState.active`
starts at the window's already-persisted mode.

### 4.3 Shell dispatch

- `TitleBar.vue`: the mode tabs become a workspace switcher — `Studio`, `Api`, then one entry per
  `openRepos` member (icon `source-control`, label = repo name, a hover close ×). Overflow with many
  repos open is left to the existing horizontal scroll; noted, not solved.
- `WorkbenchShell.vue`: `activeModePanel` becomes `activeWorkspacePanel` — `RepoPanel` for a repo
  key, `MODES[modeState.active].panel` otherwise.
- `MainView.vue`: same dispatch for the no-active-tab fallback (`REPO_WORKSPACE.start`).
- `TabStrip.vue`: `tabsForWorkspace(workspaceState.active)`.

## 5. Preview tabs

### 5.1 State

```ts
// state/tabs.ts
tabsState.previewIdByWorkspace: Record<WorkspaceKey, string | null>   // in-memory, like `hydrated`
```

`isPreview(id)` is what `TabStrip.vue` renders in italics (`.is-preview { font-style: italic }`),
matching VS Code's own affordance.

### 5.2 The rules

`openRepoFileTab(repoId, path, opts: { preview: boolean; reveal?: { line: number } })`:

1. **An existing tab for `(workspace, kind, path)` wins.** Activate it. If `preview === false` and
   that tab *is* the workspace's preview tab, promote it (clear the slot). Apply `reveal` either way.
2. **`preview === false` and no existing tab**: create a permanent tab at the end. The slot is
   untouched — a permanent open never evicts a preview tab (VS Code's own behaviour).
3. **`preview === true` and the workspace has a preview tab**: create the new record, splice it into
   the evicted tab's array index, then `closeTab` the old one. Close-then-insert, not mutate-in-place:
   `closeTab` is the one path that frees page stores (`dropResources`), runtime
   (`cleanupTabRuntime`), and a discriminated-union record should not have its `kind` rewritten
   under it.
4. **`preview === true` and no preview tab**: create at the end, set the slot.
5. Closing the preview tab clears the slot. Closing a workspace clears its entry.

**Promotion triggers**: double-click a tree row (the tree passes `preview: false`); double-click the
tab itself; the tab context menu's "Keep open"; starting a drag of the preview tab (`moveTab`
promotes before it splices — a tab you deliberately positioned must not vanish on the next single
click). No edit trigger exists here, by construction: nothing in this workspace is editable.

The insert index in rule 3 is clamped to be at or after the workspace's pinned count, so a preview
can never land left of the graph tab.

## 6. The pinned first tab

### 6.1 Mechanism

- `TabKindDef` gains `pinned?: true`. Only `repo-graph` sets it.
- `tabsForWorkspace(key)` returns a **stable partition**: every pinned tab of that workspace in array
  order, then every other tab in array order. The invariant therefore survives any `moveTab` splice,
  any restore ordering, and any future insert path, rather than depending on one.
- `closeTab` returns early for a pinned tab. `closeOthers`/`closeToTheRight`/`closeAll` skip pinned
  tabs. `duplicateTab` refuses one.
- `moveTab` returns early when the dragged tab is pinned, and when the drop target is pinned.
- `TabStrip.vue`: `draggable="false"`, no close ×, no middle-click close, and a context menu reduced
  to `Copy name` for a pinned tab.
- `ensureWorkspaceShell(repoId)` (called by `openRepoWorkspace` and once after `hydrateTabs`)
  creates the `repo-graph` tab if the workspace has none, and activates it when the workspace has no
  active tab.

### 6.2 The C5/C9 boundary, stated plainly

This phase owns: the `repo-graph` tab kind, its schema (`z.object({})`), its `TAB_KINDS` entry
(title = repo name, icon `source-control`, `pinned: true`, no badge, `dropResources` a no-op), its
`TAB_VIEWS` entry, the pin invariant above, and `views/repo/RepoGraphView.vue` — an `EmptyState`
reading *"The commit graph for this repository is not available yet."* with no action.

C9 owns: replacing that one `TAB_VIEWS['repo-graph']` line with the real `packages/git-ui` mount,
and deleting `RepoGraphView.vue`. Nothing else in this phase's tab machinery changes for it.

This is a placeholder, not a half-implemented feature: no stubbed handler, no `TODO`, no disabled
control — an honest empty state in a slot whose *reservation* is the deliverable, per SPEC's own
wording for this row.

## 7. The project tree

### 7.1 The file list

`codeindex.EnumerateAll(ctx, runner, gitPath, root) ([]string, error)` — the existing argv, the
existing `gitclient.Spec`, the existing tier-2 path-byte rule, minus the extension filter.
`Enumerate` becomes a filter over it, so there is exactly one `ls-files` invocation shape in the
tree (D6).

`ListFiles(id)` returns `{ paths: string[], status: Record<string, 'M'|'A'|'D'|'?'>, truncated: bool }`:

- Paths as git reported them, repository-relative.
- `status` from one `git status --porcelain=v2 -z` run through the **existing**
  `porcelain.StatusArgs`/`porcelain.ParseStatus` — no new parsing. It drives the tree's
  modified/untracked row color; C6 uses the same map to gate its "Open changes" menu item so the
  diff tab it adds is discoverable rather than an action that errors on an unchanged file.
- `truncated` at 200,000 paths, an honest cap on a single IPC payload.

**Refresh: on workspace open and on an explicit Refresh action in the panel header. Nothing live.**
The tree does not follow the filesystem in this phase. `codeindex`'s own watcher covers only
directories holding parseable files (C1 §7.1), so it is not the signal a complete file tree needs,
and building a second worktree watcher for a tree refresh is this phase spending a watcher's worth
of complexity on a button. Recorded in `docs/ARCHITECTURE.md`'s Known open items.

### 7.2 The component

`RepoFileTree.vue` reuses **`TreeHost.vue`**, not just `VirtualList.vue`: `TreeHost` is already
generic over `StickyRowLike & { key: string }` and knows nothing about connections or engines, so
virtualization, the pinned-ancestor band and reveal-scroll all come for free — a strictly better
reuse answer than SPEC's own "may reuse `VirtualList`". `ProjectTree.vue` is untouched.

`repo/state/fileTree.ts` folds the flat path list into rows:

- Directories before files, each `localeCompare`-sorted, case-insensitive.
- `key` is the repo-relative path; `depth`, `hasChildren`, `expanded` satisfy `StickyRowLike`.
- Expanded set per workspace, in memory; the repo root's own children expanded on first open.
- The panel search box filters by path substring and force-expands matching ancestors, the same
  shape `treeState.search` already has.
- **No single-child directory compaction** (VS Code's `a/b/c` collapsing). Deliberate: it complicates
  the fold, the expand set and reveal, for a cosmetic gain. Stated so a later phase adds it on
  purpose.

Icons come from `CodiconIcon` with a small extension map (`file-code`, `json`, `markdown`,
`file-media`, `file`), not a new icon dependency. `packages/git-ui`'s own `setiFileIcon.ts` was
considered and declined here: pulling `@kira/git-ui` into the native frontend's dependency graph is
C9's decision to make, not a file-icon's to force.

Single click opens a **preview** tab; double click, or Enter, opens a **permanent** one — the exact
`onSelect`/`onOpen` split `ProjectTree.vue` already implements with `TreeRow.vue`.

## 8. File content

### 8.1 `ReadFile`

Mirrors the git contract's own `file.read` result shape rather than inventing one:
`{ kind: 'found' | 'binary' | 'tooLarge' | 'missing', text, bytes, limitBytes, language }`.

- `binary`: a NUL byte in the first 8 KiB (C1 §5.4's own rule).
- `tooLarge`: above 8 MiB — a viewer cap, deliberately larger than C1's 2 MiB parse cap, since
  showing a big file costs one allocation while parsing it costs symbols.
- `language` is this app's own id (§9.4), resolved from the extension only. Never sniffed.

Blob-at-a-revision reads (`ReadBlob`, for C6's diff tabs) are explicitly out of scope here — see §13.

## 9. Monaco

### 9.1 The dependency and the chunk

`monaco-editor`, MIT, no dual license, no gated feature tier — it clears `CLAUDE.md`'s
open-source bar at the package level and for every feature used here. Added to the **root
`package.json`'s `dependencies`**, beside `slickgrid` (the precedent for a bundled runtime UI
library). `NOTICES.md` gains an entry for it and for the `codicon.ttf` it bundles, the same
treatment `seti-icons` already gets. Pin whatever version is current at S10 and record the pin plus
the measured gzip chunk size in that commit message (C1 §1.2's posture).

`views/repo/monacoEntry.ts` is the sole contact point, reached only through
`await import('./monacoEntry')` inside `views/repo/monaco.ts`'s lazy initializer. Static re-exports
inside the entry file, per `sqlFormatterEntry.ts`'s own recorded measurement that an inline dynamic
namespace import bundles worse.

### 9.2 What is imported, and the one worker

```ts
// views/repo/monacoEntry.ts
export * from 'monaco-editor/esm/vs/editor/edcore.main.js';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js';
…                                                     // §9.4's list
export { default as EditorWorker } from 'monaco-editor/esm/vs/editor/editor.worker?worker';
```

- **`edcore.main.js`, never the package root.** The root is `editor.main.js` = api + all
  contributions + all basic languages + the four language *services*. `edcore.main` stops before the
  services and before the bulk language set. Verify this path exists in the pinned version at S10;
  if the package layout has moved, the fallback is `editor.api.js` plus explicit
  `vs/editor/contrib/{find,hover,folding,bracketMatching,links,wordHighlighter}` imports, which
  costs more lines and nothing else.
- **`vs/language/typescript|json|css|html` is never imported anywhere.** That is the mechanism that
  disables those workers: absent modules register no service and request no worker.
- **One worker ships.** `self.MonacoEnvironment = { getWorker(_id, label) { … } }` returns the
  editor worker for label `'editorWorkerService'` and **throws** for any other label — so if a future
  import ever pulls a language service back in, it fails loudly at first use instead of silently
  shipping a second worker.
- Vite's `?worker` suffix emits the worker as its own chunk; `base: './'` makes its URL relative and
  the Wails asset handler serves it from `frontend/dist` like any other asset. The renderer has no
  worker today (`packages/git-ui`'s `layout.worker.ts` runs only inside the VS Code webview), so S10
  verifies worker load in a real `build:test` + Playwright run, not by assertion. The known fallback
  if a scheme/origin quirk bites is the standard blob-shim `getWorker`, recorded here so an
  implementer does not have to rediscover it.

### 9.3 Instance options

Every editor: `readOnly: true`, `domReadOnly: true`, `automaticLayout: true`,
`minimap: { enabled: false }`, `quickSuggestions: false`, `wordBasedSuggestions: 'off'`,
`parameterHints: { enabled: false }`, `codeLens: false`, `renderValidationDecorations: 'off'`,
`scrollBeyondLastLine: false`, `fontFamily`/`fontSize` from the app's own tokens.

Theme: two themes defined once via `monaco.editor.defineTheme`, their colors read from
`getComputedStyle(document.documentElement)` against `tokens.css`, re-applied when the app's
appearance setting changes. One model per open file tab, keyed by a stable
`kira-repo://<repoId>/<path>` URI, disposed through the tab kind's existing `dropResources` hook —
which `closeTab` already blind-calls for every registered kind, so model disposal needs no new
lifecycle.

### 9.4 Languages

Registered Monarch contributions (one import line each): `typescript`, `javascript`, `java`,
`python`, `go`, `rust`, `html`, `css`, `scss`, `less`, `markdown`, `yaml`, `xml`, `shell`, `sql`,
`dockerfile`, `ini`, `graphql`, `protobuf`. Everything else is `plaintext`.

Two named exceptions:

- **JSON**: Monaco ships no `basic-languages/json` — its JSON coloring lives inside the excluded
  language service. `.json`/`.jsonc` register a language whose Monarch definition is the JavaScript
  one, imported directly (`basic-languages/javascript/javascript.js` exports `language`). JSON is a
  JavaScript subset, so strings, numbers, `true`/`false`/`null` and punctuation all color correctly.
  If the pinned version does ship a JSON basic-language, use that instead.
- **`.vue` / `.svelte`**: no Monaco grammar exists. Both color with the HTML grammar — the same
  container choice C1 made for the same reason. A `<script>` block's contents therefore color as
  HTML text rather than as TypeScript. Honest limitation, recorded in `docs/ARCHITECTURE.md`; the
  alternative is a hand-written SFC Monarch, which `CLAUDE.md`'s library-first rule declines.

The extension-to-language map lives in one file (`views/repo/language.ts`) shared by the tree icon
and the viewer. It deliberately does not import C1's Go-side table: they cover different sets for
different purposes (parse coverage vs. coloring coverage), and pretending otherwise would drag one
to the other's shape.

## 10. Not attempted here

The `codeindex.Index` lifecycle, `ReadBlob`, diff tabs, and Monaco's definition/hover providers over
`codegraph` are C6's own scope — see §0 and §13. This phase reserves what C6 needs structurally
(`views/repo/editors.ts`'s tabId -> editor registry, §12) but implements none of it.

## 11. Read-only, enforced in three places

Stated as prose, because each of these is a place a later phase could quietly reintroduce a write.

1. **The bound service has no write method at all.** Every git invocation is built with
   `gitclient.Spec{ReadOnly: true}`, and nothing in `internal/codeworkspace` opens a file for
   writing or spawns a mutating git subcommand. There is no code path from this workspace to the
   working tree.
2. **Every Monaco instance is `readOnly: true` and `domReadOnly: true`**, so neither the keyboard
   nor a paste can mutate a model.
3. **No tab kind here defines `badge`, a dirty flag, a save action or a commit action** — the exact
   shape `definition` already has (`tabKinds.ts` leaves its `badge` unset), which is the precedent
   SPEC names rather than a new convention.

Path safety, also prose because it is a security boundary: every `path` parameter crossing the
service is repository-relative and is validated in `internal/codeworkspace/paths.go` before use. The
rule is: reject an absolute path, reject any `..` segment, then resolve the joined path with
`filepath.EvalSymlinks` and require the result to remain under the session's own root. A repository
can contain a symlink pointing anywhere on the machine, so resolving before the containment check —
not after joining alone — is what actually prevents this read-only viewer from being used to read
`~/.ssh/id_rsa`.

## 12. What later phases get from this one

- **C6 (diff tabs and navigation)**: `internal/codeworkspace`'s session registry to extend with a
  `codeindex.Index` and `catfile.Session`; `views/repo/editors.ts`'s tabId -> editor registry,
  populated on mount and cleared on dispose, for providers and (C10) gutter decorations to attach
  to; `openRepoFileTab`'s preview-tab mechanism for a cross-file jump's target to open into; the
  tree's status map (§7.1) for its "Open changes" menu item.
- **C7 (search)**: `openRepoFileTab(repoId, path, { preview: true, reveal: { line } })` for a match
  click, Monaco's own find widget already active inside `RepoFileView` (it ships with
  `edcore.main`), and the repo panel's section layout to mount a results pane beside the tree.
- **C8 (quick open)**: `control.codeWorkspaceListFiles(repoId)` is the single file-listing surface —
  C8's own SPEC row asks which source to read from, and this is the answer: one enumeration
  mechanism, already cached per workspace in `repo/state/fileTree.ts`.
- **C9 (graph)**: one `TAB_VIEWS['repo-graph']` line (§6.2).
- **C10 (review)**: `views/repo/editors.ts` again, for gutter decorations.

## 13. Explicitly out of scope

- The `codeindex.Index` lifecycle, `ReadBlob`, diff tabs, and Monaco definition/hover/references/
  implementations providers — all C6.
- The git graph itself (C9), repository-wide search (C7), quick open (C8), the review layer (C10).
- **Any change to how `studio`/`api` share tabs today.** `workspaceId` is `null` for every one of
  their tabs and `TAB_KIND_MODE` still answers for them; the only thing that changes under them is
  that the record they are filtered by is now computed by a function with a `??` in it.
- Any write of any kind (§11), including `git-ui`'s own stage/commit/discard affordances, which this
  phase never mounts.
- A live-refreshing file tree (§7.1), directory compaction (§7.2), and per-file git status beyond the
  one `status --porcelain=v2` snapshot taken with the listing.
- A settings key: every bound here (200,000 paths, 8 MiB, the model cache) is a constant.
- Multi-window coordination beyond what exists: tabs are already per `window_key`, so two windows
  open the same repository independently, each with its own session.

## 14. Implementation steps

Each step builds, passes `bun run typecheck` and `bun run lint` (plus `go vet` where Go changed),
and carries its own tests where §15 calls for them. The expensive suites run once, at S13, per
`CLAUDE.md`.

**S1 — Storage and domain.** `0018_c5_code_repos.sql`; `model/coderepos.go`;
`repos/coderepos.go` (List, Create, Rename, Remove-with-tab-rows); `model.TabRecord.WorkspaceID`
plus `Validate`; `RenderableTabKinds` gains `repo-graph`, `repo-file`.
`storage/repos/tabs.go` carries `workspace_id` through `List`/`Save`.
`packages/shared/domain/repo.ts`, `workspace.ts`, and `tabs.ts`'s two kinds + `workspaceId` +
`TabScope` (so `go-ts-vocabulary-parity.spec.ts` stays green in the same commit).

**S2 — `codeindex.EnumerateAll`.** Widen `enumerate.go` (D6). No behaviour change to the package;
existing tests are the guard.

**S3 — `internal/codeworkspace`: sessions, files, paths.** `session.go`, `paths.go` (§11),
`files.go` (`ListFiles` with the status overlay and the 200k cap, `ReadFile` with the
binary/tooLarge/missing shape).

**S4 — The bound service.** `bridge/codeworkspace.go` with `ListRepos`/`ImportRepo`/
`RenameRepo`/`RemoveRepo`/`ListFiles`/`ReadFile`; registration in `main.go`; regenerate bindings;
`frontend/src/bridge/index.ts` method surface; `state/coderepos.ts`.

**S5 — The Repositories section.** `ProjectPanel.vue`'s second action and section, the repo rows,
their context menu, the import flow through `filesChooseFolder`, and the widened empty state.
Working increment: a repo can be imported, renamed and removed, and clicking it does nothing yet.

**S6 — Workspace scoping in tab state.** `state/workspace.ts`; `workspaceKeyOf`/`tabsForWorkspace`
in `state/mode.ts`; `activeIdByWorkspace`; `openTab`'s widened dedupe key; every close/step/activate
path rescoped. `studio`/`api` behaviour must be unchanged — `tests/ui/tabs.spec.ts` and
`mode-switch.spec.ts` are the check, run at S13.

**S7 — Pin and preview.** `TabKindDef.pinned`; `tabsForWorkspace`'s partition; the guards in
`closeTab`/`closeOthers`/`closeToTheRight`/`closeAll`/`duplicateTab`/`moveTab`;
`previewIdByWorkspace` and §5.2's five rules; `TabStrip.vue`'s italics, drag guards, close-button
and context-menu handling. **Carries the unit test §15.1.**

**S8 — The two tab kinds and the workspace shell.** `state/tabKinds.ts` and `workbench/tabViews.ts`
entries; `RepoGraphView.vue`; `state/repoTabs.ts`'s `openRepoFileTab`/`ensureWorkspaceShell`;
`RepoPanel.vue` and `REPO_WORKSPACE`; `TitleBar.vue`'s switcher; `WorkbenchShell.vue`/`MainView.vue`
dispatch; `hydrateTabs`' derivation of `openRepos` and its drop of orphaned repo tabs. Working
increment: clicking a repo opens an isolated workspace with a pinned, unclosable graph placeholder.

**S9 — The file tree.** `repo/state/fileTree.ts`, `RepoFileTree.vue`, `RepoTreeRow.vue`,
`repo/menus.ts`, the `biome.json` `repo/**` block, the panel's Refresh action and status colors.
Rows open preview/permanent tabs that render nothing yet.

**S10 — Monaco bootstrap.** The dependency, `NOTICES.md`, `monacoEntry.ts`, `monaco.ts`'s lazy init,
the worker wiring and the `getWorker` label guard, the two themes, the model cache and its disposal
through `dropResources`. Record the measured chunk size in the commit message. (Note: no separate
`<pre>` stand-in file view is ever shipped — the file view lands together with its renderer in S12.)

**S11 — The language registry.** `views/repo/language.ts`, §9.4's contributions, the JSON and
SFC exceptions.

**S12 — `RepoFileView.vue`.** Mount, `revealLine` restore and its debounced patch, the
binary/tooLarge/missing states as `EmptyState`s, `editors.ts` registration.

**S13 — Verification and docs.** §16's doc updates, then §17's full pass.

## 15. Testing

Against `CLAUDE.md`'s bar: most of this is UI wiring and CRUD-shaped state, and gets **no dedicated
test**. One piece earns one.

1. **Preview and pin interaction in `state/tabs.ts`** (`tests/unit/repo-tab-slots.spec.ts`, Bun —
   the same home `tabs-save-retries-after-failure.spec.ts` already uses). Several interacting rules
   over one mutable structure, which is the bar's own wording: a preview open replaces the slot's
   tab *in its own position*; a permanent open never evicts a preview; reopening the same path
   activates rather than duplicating; a double-click on the current preview promotes it; closing the
   preview clears the slot; the pinned tab is first in `tabsForWorkspace` after a `moveTab` that
   tried to drag another tab in front of it; `moveTab` on the pinned tab is a no-op; `closeOthers`
   and `closeAll` leave it alive; and two workspaces' slots are independent.

**What gets nothing**, explicitly: the `code_repos` repo (CRUD), migration 0018 (one forward step
over a column add), the bound service methods (thin pass-throughs), the path-list fold (a sort and
a group-by), `ListFiles`/`ReadFile` (enumeration already covered by C1's own suite, plus one
`if` per skip rule), the language map (a lookup table), the Monaco option objects, and the
workspace store (assignment plus an array push).

**Existing suites are the regression surface for S6-S8**, and matter more here than any new test:
`tests/ui/tabs.spec.ts`, `mode-switch.spec.ts`, `smoke.spec.ts`, `interaction.spec.ts`, the visual
project, and `tests/unit/go-ts-vocabulary-parity.spec.ts`. Run `bun run test:ui` once at S13, not
per commit.

**One new UI spec, not a unit test**: `tests/ui/repo-workspace.spec.ts` — import a fixture
repository, open it, assert the pinned tab is present and has no close button, open a file by single
click and then another (the strip still shows two tabs, not three), double-click to promote, and
assert the Studio strip never shows a repo tab. That is the cheapest proof of the one claim this
phase is really making, and it is a UI flow no unit test can reach.

## 16. Documentation to update

- **`docs/ARCHITECTURE.md` Stack table**: a `monaco-editor` row — MIT, viewer-only, `edcore.main`
  not the package root, which workers exist and which never do, and why CodeMirror keeps its
  existing role (the Text editing/viewing row gains the split).
- **`docs/ARCHITECTURE.md` renderer-build row**: the dynamic-chunk list gains Monaco's, with its
  measured gzip size and its trigger (the first repo file tab).
- **`docs/ARCHITECTURE.md`, a new "Native code workspace (C5)" section**: the workspace dimension and
  why it is not a mode; the preview slot and the pin; the file-listing source and its refresh limit;
  the read-only enforcement points; the Monaco language set and the `.vue`/`.svelte` and JSON
  exceptions; a forward note that C6 adds diff/navigation on top of this shell.
- **`docs/ARCHITECTURE.md` Storage**: `code_repos`, `tabs.workspace_id`, `kira.db` schema version 18.
- **`docs/ARCHITECTURE.md` Known open items**: the file tree does not follow the filesystem (refresh
  is on open or on demand); `.vue`/`.svelte` color as HTML, so a script block is not
  TypeScript-colored.
- **`NOTICES.md`**: `monaco-editor` and its bundled `codicon.ttf`.
- **`docs/DEV_ENVIRONMENT.md`**: nothing — no new tool, no new build requirement.
- **`CLAUDE.md`**: nothing. This is app fact, not process.

## 17. Verification

Per commit: `bun run lint`, `bun run typecheck`, `go build ./apps/kira-studio/...`, `go vet` on the
touched Go packages.

Once at S13: `bun run test:unit`, `go test ./apps/kira-studio/internal/...` (including the layering
test, which the new package must pass), `bun run test:ui`, `bun run test:visual` (the panel gains a
section and the strip gains two states — snapshots update deliberately, reviewed, not blanket-
accepted).

Then one real manual pass against this repository itself, recorded in the commit message rather than
asserted as a threshold (C1 §13's posture): import `kira-studio`, open its workspace, confirm the
file count matches `git ls-files --cached --others --exclude-standard | wc -l`, open a `.go`, a
`.ts`, a `.vue` and a `README.md`, confirm the preview slot behaves as §5.2 states, and confirm the
Studio strip is untouched.
