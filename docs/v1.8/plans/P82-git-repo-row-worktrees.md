# P82 — Git panel repo rows: drop the hover ×, expand to a repository's worktrees

`docs/v1.8/SPEC.md`'s P82 row (`:140`), turned into concrete steps. Everything below was read in
the current tree (`claude/v1-8-api-git-modules-e2luom` at `ebc710cd`, P71-P81 landed); line numbers
are from that tree.

Two independent items. The first is deletion plus one Playwright test rewrite. The second is a new
per-repo disclosure in `GitPanel.vue`, a new session-scoped store behind it, and one new action —
**no Go change, no contract change, no new dependency, no git-ui change.**

The second item's central question is not UI. It is what "switch to a worktree" *means* in this
app, given that `WorktreeList.vue` lives in `@kira/git-ui` (the graph mount) and `GitPanel.vue`
lives in the desktop shell. §4 and §5 answer it; everything after them follows.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| Is dropping the × pure deletion | **Almost.** Template, CSS and `onRowClose` all go; one Playwright test (`repo-workspace.spec.ts:643`) drives that button and is rewritten onto the row menu's own "Close" item | §2, §3 |
| Does anything else depend on the button | **No.** One `data-testid="workspace-repo-close"` reference in the whole repo; `closeRepoWorkspace` keeps three other callers | §2.2 |
| Where the disclosure control goes | Leading position inside `.repo-row`, before the source-control icon — the same slot, glyph and `@click.stop` `RepoTreeRow.vue`'s own `.twisty` occupies in the tree directly below it | §8.1, §9 |
| Expanded state: persisted or per-session | **Per-session, module-level** (`repo/state/worktrees.ts`), like `repoSearchView`. Persisting needs a new DB column or settings key — out of scope | §6.1, §10 |
| Reuse `WorktreeList.vue` directly, or a wrapper | **Neither.** It cannot be mounted here at all: not exported from `@kira/git-ui`'s `exports` map, props require two git-ui-internal state classes, its rows are styled by `BranchPicker.vue`'s *unscoped* stylesheet, and its `switch-worktree` emit has exactly one implementor (`App.vue`'s own `repoState`). Five concrete reasons, §4.3 | §4 |
| What *is* reused, then | The same `worktree.list` request over the same native transport, and the same premise its own doc comment states — "each worktree is already its own `RepoEntry`/`RepoSummary`, switch needs no worktree-specific request at all". No second worktree IPC, no second switch mechanism | §4.4, §5 |
| Where each repo row's worktrees come from | Not in state today. Fetched on expand through `gitTransportFor(codeRepoId)` + `ensureRepoOpen` + `worktree.list` — `blameLine.ts:158`'s existing shape, verbatim | §6.2 |
| What "switch" does when clicked | Opens that worktree's own repo workspace, importing it as a `code_repos` row first if this app has none (`gitclient.Identify` gives a worktree its own `RepoID`, so there is no collision). Same `openRepoWorkspace` every other open path uses | §5, §7 |
| Why not git-ui's own graph-level switch | It changes only the mounted graph's repo; the file tree, search, review and index all stay on the parent worktree. From a left-panel control that reads as workspace-level, that is a broken-looking half switch — and it needs a contract change plus a mounted graph tab | §5.3 |
| Transport lifecycle for an expanded-but-not-open repo | Collapsing releases the lease and, when that repo has no workspace open, disposes the shared client too. Invariant: a lease exists exactly while a row is expanded | §6.3 |
| Any unit test | **No.** This is UI wiring and one `find`-or-import branch — nothing near `CLAUDE.md`'s bar | §12.1 |

---

# Part A — drop the hover ×

## 1. What exists today

`apps/kira-studio/frontend/src/repo/GitPanel.vue`:

- **`:56`-`:59`** — `onRowClose(e, id)`: `e.stopPropagation()` then `closeRepoWorkspace(id)`.
- **`:268`-`:277`** — the markup, inside `.repo-row`, after `.repo-name`:

```html
<span
  v-if="isOpen(repo.id)"
  class="repo-row-close"
  role="button"
  aria-label="Close repository"
  data-testid="workspace-repo-close"
  @click="onRowClose($event, repo.id)"
>
  <CodiconIcon name="close" :size="13" />
</span>
```

- **`:396`-`:416`** — `.repo-row-close`'s three rules plus their two-line comment: `opacity: 0` by
  default, `opacity: 1` on `.repo-row:hover` or `.repo-row.active`, `background: var(--kira-hover)`
  on its own hover.
- **`:111`-`:154`** — `onRepoContextMenu` already builds Open / Rename… / Copy path / separator,
  then **Close** (`:136`-`:144`, only when `isOpen(repo.id)`, `run: () => closeRepoWorkspace(repo.id)`)
  and **Remove** (`:145`-`:152`, `danger: true`).

The menu's Close item calls exactly what `onRowClose` calls. Nothing is lost by deleting the button.

## 2. The change

### 2.1 Delete

- The `<span class="repo-row-close">` block (`:268`-`:277`).
- `onRowClose` (`:56`-`:59`).
- `.repo-row-close`'s three CSS rules and their comment (`:396`-`:416`).

`closeRepoWorkspace` stays imported — `onRepoContextMenu` (`:142`) still uses it.

### 2.2 Verify dead, don't assume

Before deleting, confirm each of these greps returns what this section claims (they do at
`ebc710cd`):

- `onRowClose` — 2 hits, both in `GitPanel.vue` (definition, call site).
- `repo-row-close` — 4 hits, all in `GitPanel.vue` (markup + 3 CSS selectors).
- `workspace-repo-close` — 1 hit outside `GitPanel.vue`: `apps/kira-studio/tests/ui/repo-workspace.spec.ts:643`.
- `closeRepoWorkspace` — callers outside `GitPanel.vue`: `state/coderepos.ts:47`,
  `main.ts:324`, plus its own definition. All keep working.

`CodiconIcon` stays imported (`:266`'s `source-control` icon, and §8's new chevron).

## 3. The one test that depends on it

`apps/kira-studio/tests/ui/repo-workspace.spec.ts:634`-`649`, *"closing the active repo workspace
from the panel's × falls back to the Git module's empty state, not Studio"*. Line `:643` is
`await page.locator('[data-testid="workspace-repo-close"]').click();`.

The test's subject is the *fallback*, not the button. Keep the subject, move the trigger onto the
menu — the affordance that now owns closing:

```ts
await repoRow(page).click({ button: 'right' });
await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
await page.locator('[data-testid="menu-item-close"]').click();
```

`ContextMenu.vue:251` emits `data-testid="menu-item-${item.id}"`, and the Close item's id is
`'close'` (`GitPanel.vue:139`). `[data-testid="context-menu"]` is the established wait in this
suite (`console.spec.ts:675`, `autocomplete.spec.ts:470`).

Rename the test and its leading comment: `"closing the active repo workspace from its row menu
falls back to the Git module's empty state, not Studio"`. Everything after the click is unchanged.

**Also assert the button is gone**, in the same test, right after `repoRow(page).dblclick()`:

```ts
// P82: the row's hover × is gone — closing is the row menu's job now.
await expect(page.locator('[data-testid="workspace-repo-close"]')).toHaveCount(0);
```

Without that line, the phase's deletion is unguarded: a future re-add would break nothing.

---

# Part B — expand a repo row to its worktrees

## 4. What "`WorktreeList.vue`'s switch/open machinery" actually is

SPEC says to reuse it. Read literally — the same reading P76 §7 had to make about the *create*
machinery — the switching does not live in that component either.

### 4.1 The component

`packages/git-ui/src/components/WorktreeList.vue` (255 lines):

- **`:27`-`:43`** props: `section: PickerList<WorktreeEntry>`, `worktrees: WorktreeState`,
  `ops: OpsState`, `openWorktreeWindowCapability`, `writeCapability`, `showMore: () => void`,
  `focusedRowId?`.
- **`:45`-`:49`** emits: `switch-worktree(path)`, `open-worktree-window(path)`, `create-worktree`.
- **`:51`-`:54`** `switchTo(entry)`: returns early when `entry.isCurrent`, otherwise
  `emit('switch-worktree', entry.path)`. That is the whole of its "switch".
- **`:119`-`:211`** a `.kv-branch-section` titled "Worktrees" with a Create button, one
  `.kv-branch-row` per entry (badges, label, path, three icon buttons), a "Show N more" button, and
  a `KuiDialog` for the remove-confirmation flow.

### 4.2 The switch

- `BranchPicker.vue:781`-`793` mounts it and re-emits `switchWorktree`.
- `AppToolbar.vue:98`/`:303` re-emits again.
- `App.vue:1527`/`:1565` binds `@switch-worktree="handleSwitchWorktree"`.
- `App.vue:667`-`673` is the implementation, in full:

```ts
async function handleSwitchWorktree(path: string): Promise<void> {
  const repo = repoState.value;
  if (!repo) return;
  const outcome = await repo.open(path);
  if (outcome.kind !== 'ok') return;
  await handleRepoOpened(outcome.repo.repoId);
}
```

So the machinery is: **`repo.open(<worktree path>)`, then re-point the app at what came back.**
`WorktreeList.vue`'s own header comment says why there is nothing more to it — "each worktree is
already its own `RepoEntry`/`RepoSummary` — 'switch' needs no worktree-specific request at all".

### 4.3 Why that component cannot be mounted in `GitPanel.vue`

Five reasons, each checked:

1. **Not reachable.** `packages/git-ui/package.json`'s `exports` map has exactly two entries, `"."`
   and `"./icons"`. `"."` is `src/index.ts`, which pulls `App.vue` and the whole ~426 KB gzip chunk
   `repo/git/gitUiModule.ts` exists to keep out of the boot path. A deep import past the exports map
   is not available.
2. **Props are git-ui-internal classes.** `WorktreeState` (`git-ui/src/state/worktrees.ts`) is
   constructed from a `BridgeClient`, not a `Transport`; `OpsState` is the whole operations layer.
   Neither exists in the desktop shell, and building them would mean constructing git-ui's runtime
   inside a left panel.
3. **Its rows are styled from outside itself.** `.kv-branch-row`/`.kv-branch-section` are defined in
   `BranchPicker.vue`'s `<style>` at `:884`-onward, which is **unscoped** (`:825`: `<style>`, not
   `<style scoped>`). `WorktreeList.vue`'s own `<style scoped>` (`:213`) styles only its five extra
   classes. Mounted without `BranchPicker.vue`, its rows have no row styling at all, and the tokens
   it does use are `--kv-*` — a layer `scripts/check-tokens.sh` deliberately keeps separate from
   `--kira-*` and which the desktop panel never loads.
4. **It is built for a dropdown, not a row.** `section: PickerList<WorktreeEntry>` is P77's
   pre-filtered/capped list plus `showMore`/`focusedRowId` roving focus — a picker-tab contract, not
   an inline disclosure. A repo row expanding to three worktrees needs none of it.
5. **Its emit has one implementor.** `switch-worktree` is answered only by `App.vue`'s
   `repoState.open`, which is git-ui's own repo state inside the graph mount. §5.3 is why routing a
   left-panel click into it is the wrong outcome even where it is reachable.

### 4.4 What is reused, concretely

- **`worktree.list`** — the same contract request `WorktreeState.reload()`
  (`git-ui/src/state/worktrees.ts:52`-`58`) makes, over the same native transport, answered by the
  same `gitrpc` handler (`internal/gitrpc/worktree.go:24`-`41`). No new IPC, no Go change.
- **The premise** — a worktree is its own repository root, so switching to one is opening it
  (§4.1's own doc comment; `gitclient/repo.go:201`-`215` is where that is true in code).
- **`ensureRepoOpen`** (`state/repoOpenHold.ts:18`-`31`) — the existing `repo.open` hold, already
  the desktop shell's way to make a git request from outside the graph mount (`blameLine.ts:158`).

What is **not** reused is a Vue component that cannot be imported, and a switch implementation that
is the wrong switch (§5.3).

## 5. What "switch to a worktree" means here

### 5.1 A workspace is a `code_repos` row

`state/workspace.ts:57`-`64`: `openRepoWorkspace(repoId)` takes a `code_repos.id`, adds it to
`workspaceState.openRepos`, ensures its pinned graph tab, starts its index, activates it. Tab rows
carry `workspace_id` and are dropped by `CodeReposRepo.Remove`'s own transaction
(`state/coderepos.ts:39`-`43`). There is no way to root a workspace at a path with no row.

### 5.2 A worktree is its own repository, by `RepoID`

`internal/gitclient/repo.go:212`-`215`: `repoID := gitDir; if !isBare { repoID = root }`. A linked
worktree's `--show-toplevel` is its own directory, so its `RepoID` differs from the main worktree's.
`CodeWorkspaceService.ImportRepo` (`internal/bridge/codeworkspace.go:129`-`166`) rejects a bare repo
(`:142`) and rejects a duplicate **by `RepoID`** (`:146`-`:152`, `E_ALREADY_IMPORTED`) — so
importing a linked worktree of an already-imported repository is accepted and creates a distinct
row, named `filepath.Base(root)`.

### 5.3 The decision, and the rejected alternative

**Decision: clicking a worktree opens that worktree's own repo workspace**, importing it first when
no row exists yet (§7). Everything the user sees then follows — file tree, search, review, index,
graph, status bar — because all of them are scoped to the active workspace.

**Rejected: emitting git-ui's `switch-worktree` into the mounted graph.** Three reasons:

- It switches one tab. `RepoFileTree.vue`, `RepoSearchView.vue`, `RepoReviewView.vue` and the Go
  index all stay pointed at the parent worktree's `code_repos` row, because the desktop workspace
  never moved. A left-panel row-list control that reads as "switch to this worktree" and changes
  only the graph is a half switch.
- It needs a mounted graph tab. `GitPanel.vue` has no handle on git-ui's `repoState`; the only seam
  is the per-workspace local event bus (`repo/git/transport.ts:52`, `LOCAL_EVENT_KEYS`), whose
  `ui.action` payload lives in `@kira/git-ipc`'s contract — a contract change plus a cold-mount
  stash (`hostHandlers.ts:69`-`86`'s pattern) for a tab that may not exist.
- It is not what "switch worktrees easily from there" asks for.

### 5.4 The accepted consequence, stated plainly

A worktree that has been switched to once becomes a listed repository in the panel. It is then
renameable and removable like any other, and one click away next time. Two consequences follow, both
intended:

- The top-level list grows by one row per worktree actually used. Hiding those rows would need a
  parent/common-dir column on `code_repos` — a Go and schema change, out of scope (§10).
- Expanding *that* row lists the same worktree set (git reports every worktree of the repository
  from any of them), so every sibling stays one click away from wherever the user is.

## 6. The store

### 6.1 File and shape

New: `apps/kira-studio/frontend/src/repo/state/worktrees.ts`. Session-scoped, module-level, one
entry per repo the user has expanded — the same shape and reasoning as its two neighbours
(`repo/state/fileTree.ts:144`-`163`, `repo/state/search.ts`).

```ts
import type { Transport, WorktreeEntry } from '@kira/git-ipc';
import { reactive, watch } from 'vue';
import { codeRepoRecord, codeReposState, openRepoAtPath } from '../../state/coderepos';
import { ensureRepoOpen } from '../../state/repoOpenHold';
import { workspaceState } from '../../state/workspace';
import { disposeGitTransport, gitTransportFor } from '../git/transport';

interface RepoWorktreeState {
  expanded: boolean;
  loading: boolean;
  error: string | null;
  entries: readonly WorktreeEntry[];
}
```

`const byRepo = reactive(new Map<string, RepoWorktreeState>())` — **`reactive()` on the Map itself**,
for the reason `fileTree.ts:144`-`152` already documents: the template reads
`byRepo.get(id)` before any entry exists, and a plain Map makes that read untracked.

Leases are **not** reactive state — keep them in a plain module-level
`Map<string, { transport: Transport; off: () => void }>`.

Exports:

| Export | Purpose |
|---|---|
| `isWorktreesExpanded(codeRepoId): boolean` | Template gate + chevron direction |
| `worktreeEntries(codeRepoId): readonly WorktreeEntry[]` | Rows |
| `worktreesLoading(codeRepoId): boolean` | Placeholder row |
| `worktreesError(codeRepoId): string \| null` | Error row |
| `toggleRepoWorktrees(codeRepoId): void` | The disclosure control |
| `switchToWorktree(codeRepoId, path): Promise<void>` | A worktree row's click |
| `collapseRepoWorktrees(codeRepoId): void` | Release path, used by the watches in §6.6 |
| `worktreeLabel(entry): string` | §6.5 |

### 6.2 Fetch

`blameLine.ts:158`'s shape, unchanged:

```ts
const record = codeRepoRecord(codeRepoId);
if (!record) return;
const transport = gitTransportFor(codeRepoId);       // repo/git/transport.ts:291
await ensureRepoOpen(transport, record.repoId);      // state/repoOpenHold.ts:18
const { worktrees } = await transport.request('worktree.list', { repoId: record.repoId });
```

`ensureRepoOpen` is required, not optional: `handleWorktreeList` resolves the repo with
`entryFor(c, p.RepoID)` and fails with the connection's not-held error otherwise
(`internal/gitrpc/worktree.go:32`-`35`). `record.repoId` is the repository root path, which is
exactly what `repo.open` takes as `path` (`repoOpenHold.ts:21`, and `gitclient/repo.go:205`-`211`'s
own note on why `RepoID` is the root).

Rules:

- Expanding **always refetches** — `worktree.list` is one `git worktree list --porcelain -z` spawn
  and is never cached server-side (`internal/gitsession/worktree.go:56`-`62`). Keep the previous
  entries visible while `loading` is true; replace only on success.
- On rejection: `error = <message>`, keep the row expanded, keep the stale entries. Never swallow.
  The store is the only place that catches — `toggleRepoWorktrees` returns `void` and must not leave
  an unhandled rejection.
- A refetch that resolves for a repo whose row has since collapsed, or whose record has gone, must
  not write — re-check `byRepo.get(codeRepoId)?.expanded` before assigning, the same stale-reply
  guard `WorktreeState.reload` makes (`git-ui/src/state/worktrees.ts:54`-`55`).

### 6.3 Lease lifecycle — collapsing must release

`gitTransportFor(codeRepoId)` creates the workspace's shared client on first call
(`transport.ts:291`-`298`) — a real `Stream('git')`, one `gitsession.Conn`, and after
`ensureRepoOpen` a real repo hold (watcher, cat-file processes). For a repo whose workspace is
**open** that client already exists and is owned by the workspace. For a repo the user merely
**expanded**, this phase is what created it, and nothing else would ever end it:
`disposeGitTransport` is called only from `closeRepoWorkspace` (`state/workspace.ts:74`).

Invariant to implement: **a lease exists exactly while a row is expanded.**

```ts
function release(codeRepoId: string): void {
  const held = leases.get(codeRepoId);
  if (!held) return;
  leases.delete(codeRepoId);
  held.off();
  held.transport.dispose();
  // Nothing else holds a client for a repo with no open workspace — no tabs exist for one — so
  // this expansion is what opened the socket and the repo hold, and must be what ends them.
  if (!workspaceState.openRepos.includes(codeRepoId)) disposeGitTransport(codeRepoId);
}
```

`lease.dispose()` releases only that lease's own subscriptions and never closes the socket
(`transport.ts:249`-`280`); `disposeGitTransport` is the one thing that does, and it also clears the
`repo.open` memo (`transport.ts:312`-`313`), which is what makes a later re-expand call `repo.open`
again on the fresh `Conn`.

Calling `release` on a repo whose client was already disposed elsewhere is safe: `lease.dispose()`
is guarded by its own `released` flag (`transport.ts:269`-`270`) and `disposeGitTransport` returns
early on a missing client (`:305`).

### 6.4 Live refresh

While expanded, hold one subscription, the same filter `WorktreeState` uses
(`git-ui/src/state/worktrees.ts:30`-`35`):

```ts
const off = transport.on('repo.changed', (event) => {
  if (event.repoId !== record.repoId || event.kind !== 'refsChanged') return;
  void refresh(codeRepoId);
});
```

This is what makes a worktree created from the graph's own dialog (P76's entry points) appear in an
already-expanded row, instead of only after a collapse/expand. `off` is stored with the lease and
called by `release`.

### 6.5 The label

```ts
/** git-ui's `pickerModel.ts:94`-`98` twin, four lines, replicated rather than imported:
 *  `pickerModel.ts` is not on `@kira/git-ui`'s exports map (only "." and "./icons"), and "."
 *  pulls the whole graph chunk. Keep the two in step by hand if either changes. */
export function worktreeLabel(entry: WorktreeEntry): string {
  if (entry.branch) return entry.branch.replace(/^refs\/heads\//, '');
  if (entry.isDetached && entry.head) return `detached @ ${entry.head.slice(0, 7)}`;
  return entry.isBare ? 'bare' : 'unknown';
}
```

### 6.6 Eviction, without inverting an import

`state/workspace.ts` must not import this module (it already imports `repo/state/fileTree.ts` and
`repo/state/search.ts`, and this module imports *it*). Use the watch pattern
`repo/state/quickOpen.ts:183`-`210` established for exactly this, twice:

```ts
// A closed workspace's lease dies with its shared client (closeRepoWorkspace -> disposeGitTransport),
// so collapse here rather than leave a row expanded over a dead subscription. openRepos is always
// reassigned wholesale, so a plain watch sees the pre-close membership as `previous`.
watch(
  () => workspaceState.openRepos,
  (openRepos, previous) => {
    if (!previous) return;
    for (const id of previous) if (!openRepos.includes(id)) collapseRepoWorktrees(id);
  },
);

// removeCodeRepo reassigns `records` wholesale; a removed repository must not keep an entry (or a
// lease) here. It also calls closeRepoWorkspace, but only the open case is covered by the watch above.
watch(
  () => codeReposState.records,
  (records) => {
    const live = new Set(records.map((r) => r.id));
    for (const id of [...byRepo.keys()]) if (!live.has(id)) collapseRepoWorktrees(id);
  },
);
```

`collapseRepoWorktrees(id)` = `release(id)` + delete the `byRepo` entry.

## 7. The switch action

New export in `apps/kira-studio/frontend/src/state/coderepos.ts` — that file already imports
`./workspace` (`:4`) and owns every `code_repos` mutation, so it is where this belongs. The store
(§6) calls it and owns the error display.

```ts
/** P82: canonicalized the way gitpath.CleanNFC canonicalizes a repository root
 *  (internal/gitpath/gitpath.go:46) — `git worktree list` reports paths verbatim, while
 *  RepoSummary.root/.repoId come back NFC-normalized from gitclient.Identify. */
function canonicalPath(p: string): string {
  return p.normalize('NFC').replace(/[/\\]+$/, '');
}

function recordForRoot(path: string): RepoSummary | undefined {
  const target = canonicalPath(path);
  return codeReposState.records.find(
    (r) => canonicalPath(r.root) === target || canonicalPath(r.repoId) === target,
  );
}

/** P82: "switch to this worktree". A worktree is its own repository root (gitclient.Identify's
 *  RepoID is the worktree root), so switching to one is opening its own workspace — the same
 *  premise WorktreeList.vue's own switch rests on, not a second worktree-switching path. Imports
 *  it first when this app has no row for that root yet. */
export async function openRepoAtPath(path: string): Promise<void> {
  const existing = recordForRoot(path);
  if (existing) {
    openRepoWorkspace(existing.id);
    return;
  }
  try {
    const imported = await control.codeWorkspaceImportRepo(path);
    codeReposState.records = [...codeReposState.records, imported];
    openRepoWorkspace(imported.id);
  } catch (err) {
    // Another window imported this root between the lookup above and this call — re-read the list
    // and use the row that now exists. Anything else propagates to the caller's own error surface.
    if ((err as { code?: string }).code !== 'E_ALREADY_IMPORTED') throw err;
    await hydrateCodeRepos();
    const row = recordForRoot(path);
    if (!row) throw err;
    openRepoWorkspace(row.id);
  }
}
```

`err.code` is populated by `bridge/rpc.ts:25`-`59`'s `unwrap`; branching on it is the established
pattern (`GenerateDataDialog.vue:151`).

In the store:

```ts
export async function switchToWorktree(codeRepoId: string, path: string): Promise<void> {
  const state = stateFor(codeRepoId);
  state.error = null;
  try {
    await openRepoAtPath(path);
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  }
}
```

Clicking the entry that *is* this row's own repository needs no special case: `recordForRoot` finds
that row and `openRepoWorkspace` opens-or-activates it, which is what `onRowClick` does.

## 8. `GitPanel.vue`

### 8.1 The disclosure control

Inside `.repo-row`, as the **first** child (before `<CodiconIcon name="source-control">` at `:266`),
mirroring `RepoTreeRow.vue:62`-`72` in the tree directly below:

```html
<button
  type="button"
  class="repo-twisty"
  tabindex="-1"
  :aria-label="isWorktreesExpanded(repo.id) ? 'Collapse worktrees' : 'Expand worktrees'"
  :aria-expanded="isWorktreesExpanded(repo.id)"
  data-testid="repo-row-expand"
  @click.stop="toggleRepoWorktrees(repo.id)"
>
  <CodiconIcon :name="isWorktreesExpanded(repo.id) ? 'chevron-down' : 'chevron-right'" :size="13" />
</button>
```

`@click.stop` is load-bearing: without it the row's own `@click="onRowClick(repo.id)"` (`:263`)
would open the workspace on every expand.

Always rendered, never `.invisible`: every non-bare repository has at least its own worktree, and
whether there are others is unknown until the fetch. Row height and the row's `gap` are unchanged;
only the left edge gains 14px + one gap.

### 8.2 The expanded list

The repo list (`:255`-`:279`) is a plain `v-for`, not virtualized. Wrap each row and its expansion
so the list stays one flat column:

```html
<div v-for="repo in filteredRepos" :key="repo.id" class="repo-entry">
  <div class="repo-row" …unchanged…>…</div>
  <div v-if="isWorktreesExpanded(repo.id)" class="worktree-list" data-testid="repo-worktrees">
    <div
      v-for="wt in worktreeEntries(repo.id)"
      :key="wt.path"
      class="worktree-row"
      :class="{ current: wt.isCurrent }"
      data-testid="repo-worktree-row"
      :data-worktree-path="wt.path"
      @click.stop="switchToWorktree(repo.id, wt.path)"
    >
      <CodiconIcon name="git-branch" :size="14" class="worktree-icon" />
      <span class="worktree-label" v-tooltip="wt.path">{{ worktreeLabel(wt) }}</span>
      <span v-if="wt.isMain" class="worktree-badge" v-tooltip="'Main worktree'">main</span>
      <CodiconIcon v-if="wt.locked" name="lock" :size="12" class="worktree-badge-icon" v-tooltip="wt.locked.reason" />
    </div>
    <div v-if="worktreesError(repo.id)" class="worktree-note error" data-testid="repo-worktree-error">
      {{ worktreesError(repo.id) }}
    </div>
    <div v-else-if="worktreesLoading(repo.id) && worktreeEntries(repo.id).length === 0" class="worktree-note">
      Loading…
    </div>
    <div v-else-if="worktreeEntries(repo.id).length === 0" class="worktree-note">No worktrees</div>
  </div>
</div>
```

Fixed by this plan: the four states (rows / error / loading / empty), the `current` marking, the
testids and `data-worktree-path`, `@click.stop`, and that the tooltip carries the full path.
**Left to the implementer:** icon choices and sizes, whether `main` renders as a word or a glyph,
and whether `openElsewhere` gets a badge at all (it may; it is not required).

Not rendered here, deliberately: create, remove, and "open in new window". §10.

### 8.3 Keep the invariant on Close

`onRepoContextMenu`'s Close item (`:136`-`:144`) becomes:

```ts
run: () => {
  collapseRepoWorktrees(repo.id);
  closeRepoWorkspace(repo.id);
},
```

The §6.6 watch would collapse it anyway; doing it first keeps the release synchronous with the
close instead of a flush later, which is the same reason `quickOpen.ts:178` exposes `dropQuickOpen`
alongside its own watch.

## 9. Styling and tokens

`scripts/check-tokens.sh` (pre-commit) requires every `var(--kira-…)` in
`apps/kira-studio/frontend/src` to resolve in `theme/tokens.css`/`base.css`/`primitives.css`. Use
only tokens that already exist; the ones this needs are all in `tokens.css` today:

| Need | Token |
|---|---|
| Row height | `--kira-row-height` (`.repo-row:362`) |
| Inline gaps | `--kira-s-2`, `--kira-s-3` (`.repo-row:365`-`366`) |
| Hover / selected | `--kira-hover`, `--kira-select` |
| Text, muted text | `--kira-fg`, `--kira-fg-muted`, `--kira-fg-subtle` |
| Error text | `--kira-error` (already used by `.error-note:424`) |
| Smaller type | `--kira-t-sm` (badges, the note rows) |
| Section divider | `--kira-border`, `--kira-border-width` (`.repo-section:353`) |

Concrete rules:

```css
.repo-twisty { /* RepoTreeRow.vue's .twisty, ported */
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--kira-fg-muted);
  padding: 0;
  cursor: pointer;
}

.worktree-row {
  height: var(--kira-row-height);
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  /* Indent to the repo name's own left edge: the row's padding, plus the twisty and its gap. */
  padding: 0 var(--kira-s-3) 0 calc(var(--kira-s-3) + 14px + var(--kira-s-2));
  cursor: default;
  user-select: none;
  font-size: var(--kira-t-sm);
  color: var(--kira-fg-muted);
}
.worktree-row:hover { background: var(--kira-hover); }
.worktree-row.current { color: var(--kira-fg); }
```

Raw `px` appears only where the neighbouring code already uses it for icon-box geometry
(`RepoTreeRow.vue:102`-`103`'s `14px`, `GitPanel.vue`'s deleted `16px`) — there is no spacing token
at that size, and inventing one for this row is out of scope. Every colour, gap, height and type
size is a token.

**One layout change is required, not optional.** `.repo-section` is `flex-shrink: 0` (`:352`), so an
expanded list of worktrees would push the file tree below the fold. Add a cap, applied only when a
repo workspace is showing below (in the list-only state the section should still use the whole
panel):

```html
<section class="repo-section" :class="{ 'has-workspace': repoId }" …>
```

```css
.repo-section.has-workspace {
  max-height: 50%;
  overflow-y: auto;
}
```

`50%` resolves against `.git-panel-body`'s definite height (`:345`, `height: 100%` inside
`PanelShell`'s `.min-h-0.flex-1` body wrapper). The exact fraction is a judgment call the
implementer may tune; omitting the cap is not.

## 10. Deliberately out of scope

- **Creating, removing, locking or pruning a worktree from this list.** P76 already put creation on
  the graph's row menus, and `WorktreeList.vue` owns removal with its typed-confirmation preflight.
  This phase's list is switch-only; SPEC asks for "each one switchable to directly from the list".
- **"Open in new window".** `hostHandlers.ts:476`-`479` refuses `worktree.openWindow` natively —
  there is no second window.
- **Hiding a linked worktree's own top-level row (§5.4).** Needs a parent or common-dir column on
  `code_repos`, i.e. a Go, storage and schema change.
- **Persisting which rows are expanded.** Session-scoped, like `repoSearchView`. Persisting needs a
  new settings key or column.
- **Any change to `WorktreeList.vue`, `BranchPicker.vue`, `App.vue` or anything else in
  `@kira/git-ui`.** §4.3 is why the desktop panel does not go through it; nothing about the VS Code
  webview's own worktree UI changes.
- **A right-click menu on a worktree row.** Not in the SPEC row; the repo row's own menu is
  unchanged apart from §8.3's one line.
- **Other repo-row affordances.** The row's click/double-click behaviour, the icon-brightness
  open/closed distinction, the panel search filter and the Files/Search/Review segment are all
  untouched.
- **P83's terminal work.** No `TabStrip.vue` change here.
- **The `repo-workspace.spec.ts` git mock's missing `graph.stream`/`commit.detail`.** Recorded by
  P74/P75/P76; §12 extends that mock with two more opt-in literals, nothing else.

## 11. Files

Added:

| File | Contents |
|---|---|
| `apps/kira-studio/frontend/src/repo/state/worktrees.ts` | §6's store: per-repo expansion, entries, fetch, lease, live refresh, eviction watches, `worktreeLabel` |

Modified:

| File | Change |
|---|---|
| `apps/kira-studio/frontend/src/repo/GitPanel.vue` | Part A's three deletions (§2.1); the twisty, the expanded list, the `repo-entry` wrapper, `has-workspace` (§8); new CSS (§9); `collapseRepoWorktrees` in the Close menu item (§8.3) |
| `apps/kira-studio/frontend/src/state/coderepos.ts` | `canonicalPath`, `recordForRoot`, `openRepoAtPath` (§7); `openRepoWorkspace` added to the existing `./workspace` import |
| `apps/kira-studio/tests/ui/repo-workspace.spec.ts` | §3's rewritten close test; §12.3's new test |
| `apps/kira-studio/tests/ui/support/gitStreamMock.ts` | Nothing — `extraResults` (P76) already carries `repo.open`/`worktree.list` |

Deleted: none. **No Go file, no `packages/` file, no contract change, no `CONTRACT_VERSION` bump, no
new dependency** — `worktree.list` is contract as shipped, and the chevron, tooltip, transport and
store primitives are all already here.

## 12. Tests

### 12.1 No unit test

`CLAUDE.md`'s bar: a test earns its keep for a parser, boundary arithmetic, cache
eviction/invalidation with interacting rules, crypto, concurrency, or a decision structure too large
to hold in your head. This phase is a disclosure toggle, a fetch, a list render and one
`find`-or-import branch. `openRepoAtPath`'s fallback is a single `if` on an error code. Nothing
clears the bar; nothing new is added under `tests/unit/`.

The `switchToWorktree` / `openRepoAtPath` path is covered end to end by §12.3 instead, which is the
tier that can actually prove the workspace opened.

### 12.2 The existing close test

§3, in full. It is the only existing test that touches the removed button.

### 12.3 One new Playwright test

In `apps/kira-studio/tests/ui/repo-workspace.spec.ts`, beside the other repo-list tests. Asserts the
two things §8 and §7 actually claim, and nothing that would pass vacuously.

Fixtures: the file's existing `REPO` (`:14`-`:21`, `root`/`repoId` both `/tmp/demo-repo`), plus a
worktree and the row it becomes:

```ts
const WORKTREE_PATH = '/tmp/demo-repo-feature';
const WORKTREE_REPO = {
  id: 'repo-2',
  name: 'demo-repo-feature',
  root: WORKTREE_PATH,
  repoId: WORKTREE_PATH,
  sortOrder: 2,
  createdAt: '2026-01-02T00:00:00.000Z',
};
```

Control snapshots: `CONTROL`, plus
`{ channel: IPC.codeWorkspaceImportRepo, args: { path: WORKTREE_PATH }, response: WORKTREE_REPO }`
and a `codeWorkspaceListFiles` entry for `WORKTREE_REPO.id` (`openRepoWorkspace` loads the new
workspace's tree).

Git stream: `installGitStreamMock(page, REPO.repoId, { 'repo.open': undefined, 'worktree.list': {…} })`
— `'repo.open': undefined` is the shape P76 already uses (`repo-workspace.spec.ts:485`-`488`), and
the mock's own `method in resultByMethod` check (`gitStreamMock.ts:122`) accepts it. Install it
before the click that expands, for the same lazy-`gitTransportFor` reason that file's `:485` comment
gives. Two entries, the row's own (`isMain`/`isCurrent`) and the linked one.

Steps:

1. `openGitModule(page)`; click `[data-testid="repo-row-expand"]` inside `repoRow(page)`.
2. Expanding must **not** open the workspace: `await expect(tab(page, 'repo-graph')).toHaveCount(0)`.
   This is the assertion that guards `@click.stop` (§8.1).
3. `await expect(page.locator('[data-testid="repo-worktree-row"]')).toHaveCount(2)`, and the row for
   `WORKTREE_PATH` shows the linked worktree's branch name (`worktreeLabel`, §6.5).
4. Click `[data-worktree-path="/tmp/demo-repo-feature"]`.
5. Assert the switch actually happened, not just that a call was made:
   - `control.log()` contains `IPC.codeWorkspaceImportRepo` with `{ path: WORKTREE_PATH }`;
   - a second `[data-testid="repo-row"]` exists, `[data-repo-id="repo-2"]`, and carries `active`;
   - `tab(page, 'repo-graph')` is now count 1 (the new workspace's pinned graph tab).
6. Collapse (click the twisty again) and assert `[data-testid="repo-worktrees"]` is gone.

Do not assert on timing, and do not assert the parent row's own worktree entry is unclickable —
clicking it is a legitimate no-op-ish activate (§7).

### 12.4 Checks

Per commit (cheap, and the pre-commit hook runs them): `bun run typecheck`, `biome check .`
(expect only the known pre-existing `UncommittedChangesStrip.vue` info finding),
`scripts/check-tokens.sh`, `bun run build`.

Once, at the end of the phase:

1. `bun run test:ui` — the whole `ui` project. Report counts. `repo-workspace.spec.ts`,
   `repo-graph-lifecycle.spec.ts` and `markdown-reading.spec.ts` all drive `[data-testid="repo-row"]`
   and are the specs most exposed to the row's new first child; all must be green.
2. Manual pass in the real app (`CLAUDE.md`'s "see it working" bar for a UI phase), with a
   repository that has at least one linked worktree:
   - the hover × is gone; right-click still offers Close (only when open) and Remove;
   - the chevron expands without opening the repo, and collapses again;
   - the list shows every worktree, marks the current one, and shows the full path on hover;
   - clicking a linked worktree opens its workspace — file tree, search and the graph all show the
     *worktree's* content, and the worktree now has its own row in the list;
   - clicking it again (now an existing row) activates rather than re-imports;
   - expanding a repository with no linked worktrees shows one row, not an error;
   - with a repo workspace open, expanding a long worktree list scrolls the repo section instead of
     pushing the file tree off-panel.
3. Leak check, matching §6.3's invariant: expand a repository that is **not** open, collapse it, and
   confirm the Go side has no lingering session for it — `advanced.gitLogLevel` at debug shows the
   `Conn` opening on expand and closing on collapse (`docs/DEV_ENVIRONMENT.md`'s own log-level
   section). If a check that direct is not available in the sandbox, say so plainly in the phase
   result rather than claiming it passed.

## 13. Order and commits

Part A and Part B are independent; A first because it is small and touches the same template.

1. **`refactor(repo): close a repository from its row menu, not a hover ×`**
   `GitPanel.vue` (§2.1) plus `repo-workspace.spec.ts` (§3). The test rewrite must land in this
   commit — the deletion breaks it otherwise.
2. **`feat(repo): list a repository's worktrees under its Git panel row`**
   The new store (§6) and `GitPanel.vue`'s twisty, expanded list, `has-workspace` cap and CSS (§8,
   §9), with rows rendering but not yet clickable. A legible increment, not a shipped half-feature:
   commit 3 lands in the same phase and nothing before it is user-visible.
3. **`feat(repo): switch to a worktree from its repo row`**
   `state/coderepos.ts`'s `openRepoAtPath` (§7), the store's `switchToWorktree`, the row's
   `@click.stop`, and §8.3's Close-menu line.
4. **`test(ui): cover the repo row's worktree expansion and switch`**
   §12.3.

2 must precede 3 (3 calls into 2's store). 1 is independent of all of them.

## 14. One pass, one subagent

One sequential Sonnet subagent. Three of the four commits touch `GitPanel.vue`, and commits 2 and 3
share the new store — nothing here is genuinely independent work, so there is nothing to
parallelize. Expensive verification (§12.4's full `test:ui` run and the manual pass) runs once at
the end, per `CLAUDE.md`; typecheck/lint/tokens/build are cheap and run per commit.

Size: 1 new ~150-line store, ~120 changed lines in `GitPanel.vue` (about 25 of them deletions),
~40 new lines in `state/coderepos.ts`, ~70 lines of test. No Go, no contract, no dependency.

## 15. Dogfooding note

The repo-map MCP server was not used for this planning pass — the same constraint P75 §10, P76 §14,
P77 §19, P78 §13 and P81 §12 each recorded, and `CLAUDE.md`'s own step-3 caveat: this is a subagent
session whose tool manifest is fixed at session start, and no server was already running in this
container (`127.0.0.1:8765` refused the connection). Navigation was Grep/Glob/Read.

**Nothing new is logged in `docs/v1.8/mcp-repo-map-issues.md`.** This pass never called the server,
so it produced no evidence about it; inventing an entry would be the manufactured finding
`CLAUDE.md` warns against.
