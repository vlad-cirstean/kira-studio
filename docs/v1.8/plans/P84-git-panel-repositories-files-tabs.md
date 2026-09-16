# P84 — Git panel: dedupe the worktree listing, split Repositories and Files into two tabs

`docs/v1.8/SPEC.md`'s P84 row (`:158`) and its Sequencing paragraph (`:125`-`:136`), turned into
concrete steps. Everything below was read in the current tree
(`claude/v1-8-p82-p83-implementation-ocpvj1` at `a2849b7e`, P71-P83 landed); line numbers are from
that tree.

Three items, one panel. Item 1 (the duplicate listing) is the only one with a real design fork, and
the fork is *where the answer comes from*, not what the UI does — §2 shows the frontend cannot
answer it from anything it holds today, so this phase adds **one new batched bound call and one
small `gitclient` helper**. Items 2 and 3 (the tab split, the title) are `GitPanel.vue` and its CSS.

No `@kira/git-ipc` contract change, no `packages/git-ui` change, no VS Code-extension change
(`GitPanel.vue` is desktop-only), no new dependency, no DB migration.

P82 §5.4 already named this exact defect as its own accepted consequence and deferred the fix:
"Hiding those rows would need a parent/common-dir column on `code_repos` — a Go and schema change,
out of scope". P84 does the Go half and **rejects the schema half** — §5.3 says why a stored column
is worse than a live read.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| Filter the flat list, or track provenance on import | **Neither as SPEC framed them.** Filter by *git topology* — a row nests when it shares a `--git-common-dir` with another imported row. Provenance is the wrong key: a worktree imported by folder picker still renders twice | §3, §5.1 |
| Can the frontend already tell a worktree from its parent | **No.** `RepoSummary` (`shared/domain/repo.ts:6`-`13`) is six fields, none of them topology; `worktreeEntries` exists only while a row is expanded (`collapseRepoWorktrees` deletes the entry, `worktrees.ts:121`-`124`) | §2 |
| Does `WorktreeEntry` carry enough | It carries every worktree's `path` — but only for a repo whose row is currently expanded, which is exactly the state the filter must not depend on | §2.2 |
| New backend surface, then | **One bound call**, `CodeWorkspaceService.RepoWorktreeLinks`, answering one `parentId` per `code_repos` row; plus `gitclient.WorktreeIdentity`, two `rev-parse` lines `Identify` already runs | §4.1, §4.2 |
| Store the answer on `code_repos` instead | **Rejected.** A SQL migration cannot run `git`, so every already-imported worktree would stay duplicated forever | §5.3 |
| Fold it into `RepoHeads` or `ListRepos` | **Rejected**, different reasons each: `RepoHeads` re-fires per `refsChanged` and topology does not change on a checkout; `ListRepos` runs on every boot in every window, Git module opened or not | §5.4 |
| What the nested row must gain | open/active marking, and Rename/Close/Remove in its context menu — otherwise hiding the flat row makes those actions unreachable | §6.1, §6.2 |
| Two `PanelShell`s or one | **One.** A two-option `SegmentedControl` in the `#title` slot the repo-name title vacates | §8.1 |
| Where Files/Search/Review goes | Into the Files tab's own body, as a strip above the tree. Two segmented controls plus three icon buttons do not fit a 260px panel (`layout.ts` default) and `.p-seg` is `flex-shrink: 0` | §8.2, §5.6 |
| Where the tab state lives | A local `ref` in `GitPanel.vue`, driven by an `immediate` watcher on `repoId` — opening a workspace shows Files, closing the last one returns to Repositories. No new store, no persistence (`repoSearchView` is not persisted either) | §8.3 |
| The `.repo-section.has-workspace` 50% cap | Deleted, with `.repo-section`'s bottom border — nothing stacks below the list any more | §8.6 |
| Files tab with no workspace | `EmptyState icon="source-control" label="No repository open"` inline, the same label `GitStart.vue:26` already uses. Not `GitStart.vue` itself: that is a 420px centred front door for the main area | §8.5 |
| Anything else reading the repo-name title | **No.** `repoName` has one reader, the title span itself (`GitPanel.vue:279`); no test asserts the panel title | §9 |
| Any unit test | **No.** The one decision is a group-and-pick over a list, and it lives in Go where the Playwright tier can drive it end to end | §13.1 |

---

# Part A — the duplicate listing

## 1. What happens today, exactly

1. `GitPanel.vue:360` renders `worktreeEntries(repo.id)` as nested `.worktree-row`s under an
   expanded repo row.
2. Clicking one calls `switchToWorktree(repo.id, wt.path)` (`worktrees.ts:129`), which calls
   `openRepoAtPath(path)` (`coderepos.ts:70`).
3. `openRepoAtPath` finds no record (`recordForRoot`, `:59`-`:64`, matches on
   `canonicalPath(r.root)`/`canonicalPath(r.repoId)` only), so it calls
   `control.codeWorkspaceImportRepo(path)` and appends the new record to
   `codeReposState.records` (`:77`-`:78`).
4. `GitPanel.vue:74`-`78`'s `filteredRepos` reads that same array and renders every record as a
   flat top-level `.repo-row`.

So the worktree is now rendered twice at once: nested under its parent's twisty, and flat at the
top level. That is the user's report — "I see main repos and worktrees too. It makes no sense".

**The workspace machinery is not implicated.** Each repo workspace gets its own tab id, its own
git-ui `App.vue` mount, its own transport (`gitTransportFor`), under
`MainView.vue`'s `KeepAlive :include="['RepoGraphView']" :max="20"`. Read and found correctly
isolated; this plan changes nothing there. P82 §5.3's separate-workspace-per-worktree architecture
stays exactly as shipped — **this is a list-rendering fix, not a workspace-opening fix.**

## 2. Why the frontend cannot answer this on its own

### 2.1 The record shape carries no topology

`shared/domain/repo.ts:6`-`13`: `id`, `name`, `root`, `repoId`, `sortOrder`, `createdAt`. For a
linked worktree, `repoId` *is* its own root (`gitclient/repo.go:212`-`215`, quoted in P82 §5.2), so
a parent and its worktree are structurally indistinguishable here.

Path nesting is not a substitute: `git worktree add ../repo-feature` is the common spelling, and the
worktree's root is then a *sibling* of the parent's, not a descendant.

### 2.2 The worktree list exists only while expanded

`worktrees.ts` fetches `worktree.list` on expand (`toggleRepoWorktrees`, `:101`-`:119`) and
`collapseRepoWorktrees` (`:121`-`:124`) deletes the whole entry. A filter built on
`worktreeEntries` would therefore hide a row only while its parent happens to be expanded, and
show it again on collapse — a list that changes membership when you close a twisty.

Fetching every repo's worktrees eagerly instead is worse: each fetch needs
`gitTransportFor(codeRepoId)` plus `ensureRepoOpen` (`:73`-`:74`), i.e. a `Stream('git')` client and
a server-side repo session **per imported repository**, opened at panel mount. P82 built the lease
to exist exactly while a row is expanded (§6.3's invariant) precisely to avoid that.

### 2.3 What git already knows, and the app already fetches once

`gitclient.Identify` (`gitclient/repo.go:166`-`230`) already computes both facts at import time:
`CommonDir` and `IsLinkedWorktree` (`!isBare && gitDir != commonDir`). They are on
`gitclient.RepoSummary` (`:23`-`:31`) and thrown away — `CodeWorkspaceService.ImportRepo`
(`bridge/codeworkspace.go:201`-`240`) stores only `ID`/`Name`/`Root`/`RepoID`/`CreatedAt`.

## 3. The rule

Group every `code_repos` row by its `--git-common-dir`. Within a group, pick one **anchor**:

1. the row that is not a linked worktree (`gitDir == commonDir`), if the group has one;
2. otherwise the smallest `(sortOrder, createdAt, id)` — deterministic, and it is the row the user
   imported first.

Every non-anchor row gets `parentId = anchor.id`. The anchor gets `parentId = ""`.

Then, in the panel: **a row with a non-empty `parentId` never renders at the top level.** It renders
only in its nested position under the anchor's twisty.

Two properties make this safe:

- **Nothing becomes unreachable.** `git worktree list` from any member of a group lists every member
  of that group, so expanding the anchor lists every non-anchor row. The anchor itself always stays
  top-level.
- **Exactly one flat row per repository.** Rule 2 covers the case the obvious rule misses — a user
  who imported two linked worktrees and never the main one. With rule 1 alone both would stay flat
  and the duplicate would persist in a different shape.

The rule lives in Go (§4.2), because Go is where `commonDir` is read. The wire carries `parentId`
only; the frontend does no path arithmetic.

## 4. The data

### 4.1 `gitclient.WorktreeIdentity`

`internal/gitclient/repo.go`. New exported helper:

```go
// WorktreeIdentity answers dir's absolute git dir and common dir — the two rev-parse lines a
// linked worktree is told apart by (gitDir != commonDir), NFC-canonicalized the same way
// Identify canonicalizes them (G27 D5a).
func WorktreeIdentity(ctx context.Context, runner Runner, gitPath, dir string) (gitDir, commonDir string, err error)
```

Two `revParseLine` calls (`--path-format=absolute --absolute-git-dir`, then
`--path-format=absolute --git-common-dir`), each `gitpath.CleanNFC`'d — **lifted verbatim out of
`Identify` (`:172`-`:185`), which is then refactored to call this helper.** One definition of the
normalization discipline, two callers.

Deliberately not one `rev-parse` invocation carrying both flags: that would add a new assumption
about multi-flag output ordering this package has never made. Two cheap `rev-parse` runs match what
`Identify` already does.

### 4.2 `CodeWorkspaceService.RepoWorktreeLinks`

`internal/bridge/codeworkspace.go`, beside `RepoHeads` (`:150`) and shaped like it — same
`CodeRepos.List()` read, same `Discovery.Status` gate, same `errgroup` with
`repoHeadsConcurrency`, same never-fail-the-batch-for-one-row error handling.

```go
// CodeRepoWorktreeLink is one repository row's place in the panel's own list: ParentID names the
// row it nests under (P84 §3's anchor), empty when it is a top-level repository. Error names why
// a row could not be read — a row whose worktree is gone from disk keeps ParentID empty and stays
// top-level, the safe default.
type CodeRepoWorktreeLink struct {
	ID       string `json:"id"`
	ParentID string `json:"parentId"`
	Error    string `json:"error,omitempty"`
}

func (s *CodeWorkspaceService) RepoWorktreeLinks(ctx context.Context) ([]CodeRepoWorktreeLink, error)
```

No args struct: both callers (§4.4) refresh the whole list, and §5.4 explains why this is not scoped
per row the way `RepoHeads` is. `ListRepos()` is the existing no-arg precedent on this service.

Body:

1. `CodeRepos.List()`; `Discovery.Status` — `E_GIT_UNAVAILABLE` on a bad status, matching
   `RepoHeads:170`-`:173`.
2. Per row, concurrently: skip `Root == ""` (`RepoHeads:180`'s own guard; `ImportRepo` rejects a
   bare repo, so this is belt-and-braces), else `WorktreeIdentity(ctx, …, repo.Root)`. Record
   `commonDir` and `isLinked := gitDir != commonDir`, or the error string.
3. Group by `commonDir` (skipping errored rows), pick each group's anchor per §3, write `ParentID`.

`CodeRepos.List()`'s own ordering supplies `sortOrder` — read the repository's existing ordering
rather than re-sorting; §3's tiebreak only needs a stable total order.

### 4.3 Bindings and `bridge/index.ts`

Regenerate the checked-in Wails bindings
(`apps/kira-studio/frontend/bindings/github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/*`),
then add one entry to `control` (`frontend/src/bridge/index.ts`, beside
`codeWorkspaceRepoHeads:463`):

```ts
codeWorkspaceRepoWorktreeLinks: (): Promise<Array<{ id: string; parentId: string; error?: string }>> =>
  unwrap(CodeWorkspaceService.RepoWorktreeLinks()).then((r) => trust<…>(r ?? [])),
```

### 4.4 `repo/state/repoLinks.ts` — the store

New file, `apps/kira-studio/frontend/src/repo/state/repoLinks.ts`. Session-scoped, module-level —
the same shape and reasoning as `repoHeads.ts` (which is the closest analogue: one batched call, one
reactive `Map`, a records watcher that evicts and refetches).

```ts
const byRepoId = reactive(new Map<string, string>());   // code_repos.id -> parent id ('' = top level)

export function worktreeParentId(codeRepoId: string): string
export async function refreshRepoWorktreeLinks(): Promise<void>
export function noteWorktreeLink(childId: string, parentId: string): void   // §4.5
```

Refresh triggers — **two, not three**:

1. `GitPanel.vue`'s `onMounted`, beside the existing `refreshRepoHeads()` call (`:263`).
2. A `watch` on `codeReposState.records` that drops ids no longer present and refetches, copied
   from `repoHeads.ts:43`-`:50`.

No `repo.changed`/`refsChanged` lease. A checkout does not move a worktree between common dirs, and
`git worktree add` reaches this store as a records change when the new worktree is actually
imported. This is the whole reason it is a separate call from `RepoHeads` (§5.4).

### 4.5 The click-time hint

Between the import resolving and the next `RepoWorktreeLinks` answering, the new record has no
`parentId` yet — so the duplicate row would flash into the list and then vanish, on the exact
interaction the user complained about. The click already knows the answer, so it writes it:

`worktrees.ts`'s `switchToWorktree` takes the entry instead of the bare path
(`switchToWorktree(codeRepoId, wt: WorktreeEntry)`; `GitPanel.vue:366` passes `wt`), and after
`openRepoAtPath(wt.path)` resolves:

```ts
if (wt.isMain) return;                                  // clicking the main worktree imports the
                                                        // *anchor*, which has no parent
const record = codeRepoRecordForPath(wt.path);
if (record) noteWorktreeLink(record.id, worktreeParentId(codeRepoId) || codeRepoId);
```

`worktreeParentId(codeRepoId) || codeRepoId` resolves to the same anchor §3 picks, including when
the expanded row is itself a nested worktree. The batched call overwrites the hint on its next run
either way — the hint only removes the flash, it is never the sole source of truth.

`codeRepoRecordForPath` is `coderepos.ts`'s existing `recordForRoot` (`:59`), exported under a name
that says what it matches on; `openRepoAtPath` keeps using it.

## 5. Rejected alternatives

### 5.1 Provenance on import (SPEC's option b)

Track whether a record was imported by folder picker or by a worktree-row click, and list only the
former at the top level.

Rejected on three counts:

- **It answers the wrong question.** A user who imports a worktree directly with the folder picker,
  then imports its main repo, still sees that worktree twice — provenance says "top-level", the
  twisty says "nested". What the panel renders must follow what git says, not how the row got there.
- **It needs persistence.** Provenance is durable metadata, so it needs a `code_repos` column, which
  drags in §5.3's migration problem with none of §5.3's accuracy.
- **It goes stale in the one direction that matters.** Remove a worktree on disk, re-create it,
  re-import it by picker: the row is "explicitly imported" and duplicated again.

### 5.2 Filter against the expanded row's worktree entries (SPEC's option a)

Rejected: §2.2. Membership of the top-level list would depend on which twisties are open, and on a
cold boot no twisty is open, so the list would be wrong exactly when the user first looks at it.

### 5.3 Persist `common_dir` on `code_repos`

Rejected: **a SQL migration cannot run `git`.** Existing rows would backfill to empty and every
already-imported worktree — the ones the user is complaining about right now — would stay duplicated
forever unless a lazy backfill were bolted on, which is a live read with extra steps and worse
failure modes.

Second reason: worktree topology is a live filesystem fact, not durable identity.
`worktrees.ts:8`-`10` and `contract.ts:527`'s own doc comment both already state the house position
on this ("Never cached (D1): the watcher's own `commonDir/worktrees` blind spot is exactly the kind
of staleness a cache would make the first thing a user notices").

### 5.4 Fold it into `RepoHeads`, or into `ListRepos`

**`RepoHeads`:** its third trigger is a per-repo `refsChanged` lease (`repoHeads.ts:59`-`:84`),
i.e. every checkout in every open workspace. Topology cannot change on a checkout, so folding it in
means re-running `rev-parse --git-common-dir` for a row every time its HEAD moves. It would also
leave a method named `RepoHeads` returning topology — this repo's naming discipline would flag that
at review, and renaming it to something honest touches `ipcChannels.ts`, `mockRuntime.ts`,
`bridge/index.ts`, the store, `GitPanel.vue` and one existing spec for no behavioural gain.

**`ListRepos`:** it runs in `main.ts`'s boot `Promise.all` in **every window, whether or not the Git
module is ever opened**, and it returns `model.CodeRepo`, a DB row type. Widening it would put two
`git rev-parse` runs per imported repository into cold start and put live git facts on a storage
model. Rejected on both.

### 5.5 Detect a linked worktree on the frontend by sniffing `.git`

A linked worktree's `.git` is a file containing `gitdir: …/worktrees/<name>`, so the whole answer is
derivable by reading it. Rejected: that is parsing git's internal layout by hand when
`git rev-parse` is the supported query for exactly this, against `CLAUDE.md`'s own
reach-for-the-tool rule — and the frontend has no filesystem read primitive that would even reach
those paths.

### 5.6 One flat four-way segment instead of two nested tabs

"Repositories | Files | Search | Review" in one control removes the nesting entirely and fits the
header. Rejected: SPEC asks for two top-level tabs with Files owning the Files/Search/Review body,
and the flat version loses that structure — Search and Review are *views of the open workspace*, a
peer of neither Repositories nor each other at the top level. Recorded because it is genuinely
tempting on width grounds.

## 6. What the nested row must now carry

### 6.1 Open/active marking

A hidden row's open/active state has to show somewhere. In `GitPanel.vue`:

```ts
function worktreeRecordId(path: string): string { return codeRepoRecordForPath(path)?.id ?? ''; }
```

`.worktree-row` gains `:class="{ current: wt.isCurrent, open: …, active: … }"` computed from that id
against `workspaceState.openRepos` / `workspaceState.active` — reusing `isOpen`/`isActive`
unchanged. `current` (this git session's own worktree) stays and keeps its existing meaning; the new
classes are about *this app's* workspaces, which is a different fact.

### 6.2 The worktree row's context menu gains three items

`onWorktreeContextMenu` (`:190`-`:207`) today offers "Open terminal" and "Copy path". Once the flat
row is gone, Rename/Close/Remove for that record are reachable from nowhere. When
`worktreeRecordId(wt.path)` is non-empty, append the same three items `onRepoContextMenu` builds —
"Rename…", "Close" (only when open, with the same `collapseRepoWorktrees`-then-close ordering P82
§8.3 established), "Remove" (danger). Same handlers, no second code path.

"Remove" removes the `code_repos` record, never the worktree on disk — and the nested row survives
it, because that row comes from `git worktree list`, not from `codeReposState`. That is the correct
behaviour and worth the one-line comment.

### 6.3 The anchor row's own state

An anchor row whose *worktree* is the open workspace must not read as closed. `isOpen` for a repo
row becomes "this row is open, or some row parented to it is open":

```ts
function isOpen(id: string): boolean {
  return workspaceState.openRepos.includes(id)
    || workspaceState.openRepos.some((o) => worktreeParentId(o) === id);
}
```

`isActive` stays an exact match — exactly one row is the active workspace, and overloading `.active`
onto a parent would say something false.

### 6.4 Accepted consequences, stated plainly

- **A collapsed anchor row does not show which of its worktrees is active.** It shows `.open`
  (full-brightness icon) and its own HEAD label. No auto-expand: expanding a collapsed row opens a
  `Stream('git')` lease for a repository that may have no workspace at all (P82 §6.3), and doing
  that on a workspace *activation* would be a surprising cost. §16 OQ-1 puts this to the user.
- **The panel search box filters top-level rows only.** Nested worktree rows are unfiltered today
  and stay unfiltered; a hidden worktree is found by its anchor, not by its own name.
- **A brief flash on cold boot.** Between `hydrateCodeRepos` resolving and the first
  `RepoWorktreeLinks` answering, a previously-imported worktree renders flat for one round trip
  (two local `rev-parse` runs per row, concurrency 4). Bounded, and the interactive path — the one
  the bug report is about — never flashes at all (§4.5). Gating the list on the call resolving would
  trade a flash for a blank panel; not worth it.

---

# Part B — the two tabs

## 7. What exists today

`GitPanel.vue:272`-`447` is one `PanelShell` whose `#body` stacks, in one flex column:

- `.repo-section` — the repo/worktree list, `flex-shrink: 0`, `max-height: 50%` whenever a workspace
  is open (`.has-workspace`, `:485`-`:488`, P82 §9's own fix for an expanded list pushing the tree
  below the fold), with a bottom border;
- the active workspace's Files/Search/Review body, gated `v-if="repoId"` (`:408`).

The header carries the repo name as its title (`:279`), the import button, the
Files/Search/Review `SegmentedControl` and the tree-refresh button (`:281`-`:303`).

## 8. The structure

### 8.1 One `PanelShell`, one outer `SegmentedControl` in `#title`

Still one `PanelShell` — a second one would duplicate the header, the search reveal and the
type-ahead redirect for no gain. The `#title` slot, vacated by §9, takes:

```
<SegmentedControl v-model="tab" :options="[
  { value: 'repos', label: 'Repositories', testid: 'git-panel-tab-repos' },
  { value: 'files', label: 'Files',        testid: 'git-panel-tab-files' },
]" />
```

`#body` becomes `v-if="tab === 'repos'"` (the list, §7's `.repo-section` un-capped) /
`v-else` (the workspace body). `PanelShell`'s `:empty` binding is unchanged: with no repositories
imported it still swaps the whole body for the `#empty` slot, tab control and all still rendered
above it.

`#actions` keeps the import button on the Repositories tab only (`v-if="tab === 'repos'"`) and the
tree-refresh button on the Files tab only (`v-if="tab === 'files' && view === 'files'"`), so the
header never carries more than the tab control plus one icon plus the search toggle.

### 8.2 Files/Search/Review moves into the Files tab's body

It cannot stay in the header. `.p-seg` is `flex-shrink: 0` with `white-space: nowrap`
(`theme/primitives.css:504`-`:522`) and the panel's default width is 260px
(`shared/domain/layout.ts:42`) — "Repositories | Files" plus "Files | Search | Review" plus three
icon buttons overflows it outright.

So it renders as a strip at the top of the Files tab's body, above the tree/search/review content.
`v-model`, `:options` and all three `data-testid`s (`repo-view-files`/`-search`/`-review`) are
unchanged, so every existing spec that clicks them keeps working (§13.2).

### 8.3 Tab state, and the auto-switch rule

A local `ref<'repos' | 'files'>('repos')` in `GitPanel.vue`, driven by one watcher:

```ts
watch(repoId, (id) => { tab.value = id ? 'files' : 'repos'; }, { immediate: true });
```

Opening or activating a repo workspace — from a repo row, a worktree row, Quick Open, or the tab
strip — shows Files. Closing the last workspace returns to Repositories. The user can still switch
by hand at any time; the watcher only fires when `repoId` actually changes.

Not a persisted store, and not module-level: `{ immediate: true }` means a remount (leaving Git for
Studio and back) recomputes the right tab from `repoId` anyway, so module-level state would only
preserve a *manual* override across a module switch — not worth a new file. Nothing in this panel is
persisted today either; `repoSearchView` is a session-scoped module map (`repo/state/search.ts`),
and P82 §6.1 made the same call for worktree expansion.

This also makes the Files tab's empty state (§8.5) the rare case rather than the common one, and it
is why almost every existing spec needs no migration (§13.2).

### 8.4 Two search queries, not one

`local.search` currently feeds both the repo-list filter (`:74`-`:78`) and `RepoFileTree`'s own
filter (`:429`). With two tabs, one string means a filter typed on one tab silently hides rows on
the other. Split it: `local.repoSearch` and `local.fileSearch`, with `PanelShell`'s `:search` and
`@update:search` bound to whichever the active tab owns. Each keeps its own text across tab
switches.

### 8.5 The Files tab with no workspace

`<EmptyState icon="source-control" label="No repository open" />` inline in the Files tab body,
reusing the primitive `GitPanel.vue:25` already imports and the exact label `GitStart.vue:26` uses.

Not `GitStart.vue` itself: it is the Git module's *main-area* front door — a 420px centred block
with a primary import button — and mounting it in a 260px side panel would give the panel a second
import affordance next to the header's own.

### 8.6 CSS

- **Delete** `.repo-section.has-workspace` (`:485`-`:488`) — P82 §9 capped the list because a file
  tree sat below it; nothing sits below it now.
- **Delete** `.repo-section`'s `flex-shrink: 0` and `border-bottom` (`:478`-`:481`); the section
  becomes `flex: 1; min-height: 0; overflow-y: auto` so a long list scrolls within the tab.
- **Add** one `.view-strip` rule for §8.2's segmented-control row: the panel's own horizontal
  padding, a bottom border in `--kira-border`, `flex-shrink: 0`. No new tokens.
- Everything else in the `<style>` block (`.repo-row`, `.repo-head`, `.repo-twisty`,
  `.worktree-*`, `.repo-tree`, the prompt styles) is untouched, plus §6.1's `.worktree-row.open`
  / `.worktree-row.active` which reuse `--kira-fg` / `--kira-select` exactly as `.repo-row` does.

## 9. Remove the repo-name title

Delete the `repoName` computed (`:209`-`:211`) and the title span (`:278`-`:280`). One reader, no
other dependency: `repoName` appears nowhere else in the repo, and no spec asserts on the panel
title. The `#title` slot is then §8.1's tab control.

## 10. P82/P83 surfaces that must keep working, unchanged

All of these move with the list into the Repositories tab and are otherwise untouched — the plan
calls them out so the implementation does not quietly regress one while restructuring the template:

- the twisty (`repo-row-expand`) and its `@click.stop`, and `toggleRepoWorktrees`;
- `worktreeEntries`'s main-worktree-first sort (`worktrees.ts:44`-`:52`);
- `.repo-head` (P83 §12.4) and `refreshRepoHeads()` on mount;
- the terminal indicator (`repo-terminal-indicator`) on both row kinds, and `terminalTooltip`;
- `wt.isMain`'s "main" badge and `wt.locked`'s lock icon;
- both context menus' "Open terminal" and "Copy path" items, and `openRepoTerminalTab`.

## 11. Deliberately out of scope

- Persisting the active tab, or worktree-expansion state, across restarts. Both need a new settings
  key or DB column; P82 §10 already deferred the second.
- Auto-expanding an anchor row when one of its worktrees becomes active (§6.4, §16 OQ-1).
- Any change to how a worktree workspace *opens* — P82 §5.3's architecture is untouched.
- Nesting deeper than one level, or nesting by anything other than common dir.
- Filtering nested rows with the panel search box (§6.4).
- Removing the worktree on disk from the panel. "Remove" stays a `code_repos` action.

## 12. Files

| File | Change |
|---|---|
| `apps/kira-studio/internal/gitclient/repo.go` | new `WorktreeIdentity`; `Identify` refactored onto it (§4.1) |
| `apps/kira-studio/internal/bridge/codeworkspace.go` | `RepoWorktreeLinks` + `CodeRepoWorktreeLink` (§4.2) |
| `apps/kira-studio/frontend/bindings/…/internal/bridge/{codeworkspaceservice,models,index}.ts` | regenerated (§4.3) |
| `apps/kira-studio/frontend/src/bridge/index.ts` | `codeWorkspaceRepoWorktreeLinks` (§4.3) |
| `apps/kira-studio/frontend/src/state/coderepos.ts` | `recordForRoot` exported as `codeRepoRecordForPath` (§4.5) |
| `apps/kira-studio/frontend/src/repo/state/repoLinks.ts` | **new** — the store (§4.4) |
| `apps/kira-studio/frontend/src/repo/state/worktrees.ts` | `switchToWorktree` takes the entry, writes the hint (§4.5) |
| `apps/kira-studio/frontend/src/repo/GitPanel.vue` | the dedup filter, §6's row state and menu, Part B's whole restructure, §9 |
| `apps/kira-studio/tests/ui/support/ipcChannels.ts` | one channel constant |
| `apps/kira-studio/tests/ui/support/mockRuntime.ts` | IPC-map entry + a `'[]'` default (§13.4) |
| `apps/kira-studio/tests/ui/repo-workspace.spec.ts` | P82's test rewritten, one new test, two migrations (§13.2, §13.3, §13.4) |

No `packages/` change. No contract version bump — `@kira/git-ipc` is untouched, and P83 §18's
reasoning applies unchanged.

## 13. Tests

### 13.1 No unit test

`CLAUDE.md`'s bar: §3's rule is a group-by plus a two-clause pick over a list — a decision structure
that fits in one screen, not a parser, not boundary arithmetic, not cache invalidation. It also sits
behind a bound call the Playwright tier drives end to end (§13.4), so a unit test would restate a
short function body that already has coverage. The tab split is UI wiring.

### 13.2 Existing specs: two migrations, and why only two

§8.3's auto-switch is what keeps this number at two. Every spec that opens a repository and then
touches the *file tree*, *search* or *review* (`repo-workspace.spec.ts:180`, `:238`, `:278`, `:381`,
`:434`, `:483`, `:530`, `:598`, `:785`, `:856`, `:943`; `markdown-reading.spec.ts`;
`repo-graph-lifecycle.spec.ts`) lands on the Files tab automatically and needs **no change**.

The two that touch the *repo list after* a workspace is open need one `git-panel-tab-repos` click
inserted:

- `repo-workspace.spec.ts:652` — "leaving Git for Api and returning lands back on the same
  repository", which asserts `repoRow` has class `active`;
- `repo-workspace.spec.ts:673` — "closing the active repo workspace from its row menu…", which
  right-clicks `repoRow`.

`repo-workspace.spec.ts:1024` and `:1073` (P83's worktree-menu and branch-label tests) never open a
workspace, so they stay on the Repositories tab and need no change. `:976` (the tab strip's "+")
opens one but only touches the tab strip afterwards.

### 13.3 P82's own test, rewritten

`repo-workspace.spec.ts:699` ("expanding a row lists its worktrees, and switching to one opens its
own workspace") currently asserts the defect: after the switch it expects a **top-level**
`[data-testid="repo-row"][data-repo-id="repo-2"]` with class `active` (`:751`-`:753`). Rewrite that
tail to P84's behaviour, keeping everything above it:

- the `codeWorkspaceImportRepo` call still happened (unchanged);
- **no** top-level `repo-row` for `WORKTREE_REPO.id` — `toHaveCount(0)`;
- click `git-panel-tab-repos` (the switch flipped the panel to Files, §8.3), then the nested
  `repo-worktree-row[data-worktree-path="/tmp/demo-repo-feature"]` carries class `active`;
- the graph tab opened (unchanged);
- collapsing drops the list (unchanged).

This is the regression guard for §4.5's hint: without it, the top-level row appears for one round
trip and `toHaveCount(0)` is racy-then-green rather than green.

### 13.4 One new Playwright test — the hydration path

§4.5's hint would make §13.3 pass even if `RepoWorktreeLinks` were never wired, so one test must
prove the batched path with no click at all:

`test('a worktree imported in an earlier session lists only under its parent')` — seed
`codeWorkspaceListRepos` with **both** `REPO` and `WORKTREE_REPO` (the restart state), answer
`IPC.codeWorkspaceRepoWorktreeLinks` with
`[{ id: REPO.id, parentId: '' }, { id: WORKTREE_REPO.id, parentId: REPO.id }]`, open the Git module,
and assert:

- exactly one `repo-row`, and it is `REPO.id`;
- expanding it (with the existing `installGitStreamMock` + `WORKTREE_LIST_RESULT`) lists both
  worktrees, main first;
- the nested row for `WORKTREE_PATH` right-clicks to a menu containing `menu-item-remove` — §6.2's
  reachability guarantee, the thing that makes hiding the flat row safe.

Harness: `ipcChannels.ts` gains `codeWorkspaceRepoWorktreeLinks:
'kira:codeWorkspace:repoWorktreeLinks'`, `mockRuntime.ts` gains the FQN map entry
(`'CodeWorkspaceService.RepoWorktreeLinks'`) and a `'[]'` wildcard default with the same comment
`codeWorkspaceRepoHeads` carries (`mockRuntime.ts:376`-`:381`) — `GitPanel.vue`'s `onMounted` calls
it on every Git-module open, so every repo-workspace spec hits it and almost none care.
`mockRuntime.spec.ts` guards that the FQN appears in the regenerated bindings, so §4.3's regen must
land in the same commit as the channel entry.

### 13.5 Known gap, stated

**No Playwright coverage of the flash window** (§6.4's third bullet) or of a row whose
`RepoWorktreeLinks` entry carries `Error`. The mock answers the bound call synchronously from a
snapshot, so there is no honest way to hold it open for a deterministic interval — the same limit
P74/P75/P82 already recorded for `installGitStreamMock`'s own missing methods. The error path's only
behaviour is "keep `parentId` empty, stay top-level", which is the default the `'[]'` wildcard
already exercises in every other spec.

### 13.6 Checks

- `bun run typecheck`, `bun run lint`, `bun run build`.
- `go build ./...` and `go vet ./...` in `apps/kira-studio`.
- `bun run test:ui` once, near the end (`CLAUDE.md`'s implement-then-test rule), with fixes as
  follow-up commits. `repo-workspace.spec.ts`, `repo-graph-lifecycle.spec.ts` and
  `markdown-reading.spec.ts` are the three specs most likely to surface a missed migration.
- Manual, on a real repository with at least one linked worktree: expand, click the worktree, see it
  open **once** in the nested position with the panel on Files; switch to Repositories and confirm
  one flat row; right-click the nested row and confirm Rename/Close/Remove; restart and confirm the
  list still shows one flat row.

## 14. Order and commits

1. **`feat(repo): answer each imported repository's worktree parent`**
   `gitclient/repo.go`'s `WorktreeIdentity` + `Identify` refactor (§4.1),
   `bridge/codeworkspace.go`'s `RepoWorktreeLinks` (§4.2), regenerated bindings,
   `bridge/index.ts`'s one entry, `ipcChannels.ts`/`mockRuntime.ts`'s harness entries (§13.4).
   Go and wiring only; nothing user-visible.
2. **`fix(repo): list an opened worktree only under its parent repository`**
   `repo/state/repoLinks.ts` (§4.4), `state/coderepos.ts`'s one export,
   `repo/state/worktrees.ts`'s hint (§4.5), `GitPanel.vue`'s top-level filter and §6's row state,
   menu and parent-open rule. This is the bug fix, complete on its own.
3. **`refactor(repo): split the Git panel into Repositories and Files tabs`**
   `GitPanel.vue`'s Part B restructure and CSS (§8), including §9's title removal.
4. **`test(ui): cover the deduped worktree listing and the panel's two tabs`**
   §13.2's two migrations, §13.3's rewrite, §13.4's new test.

Dependencies: **1 → 2** is real (2 reads 1's call). **3 depends on 2** only by file overlap —
both rewrite large parts of `GitPanel.vue`'s template, and doing them in one tree in this order
avoids a hand merge. **4 last**, because §13.3 asserts against 2 and 3 at once.

## 15. Passes and subagents

**One Sonnet subagent, sequential, commits 1-4.** Not a defaulted choice: commits 2 and 3 rewrite
overlapping regions of the same 642-line component (2 changes the list's `v-for` source, row
classes and both menus; 3 moves that same markup into a tab branch and moves the segmented control
out of the header), and `CLAUDE.md` names splitting one continuous, order-dependent piece of work
across concurrent subagents as exactly the thing not to do. Commit 1 is genuinely separable but is
~120 Go lines — not enough to earn a second agent and a merge.

Size: ~90 new Go lines; ~60 lines in a new store; ~180 changed lines in `GitPanel.vue`; ~120 lines
of Playwright. No new dependency, no migration, no contract change.

## 16. Open questions

- **OQ-1 (for the user, not blocking).** When a worktree workspace is the active one and its anchor
  row is collapsed, the Repositories tab shows only the anchor, marked open (§6.3) — the active
  worktree itself is one twisty click away. The alternative is auto-expanding the anchor, which
  costs a `Stream('git')` lease for a repository that may have no workspace open (P82 §6.3).
  This plan takes the cheap option; say so if the expanded behaviour is wanted and it is a
  three-line follow-up.
- **OQ-2 (for the user, not blocking).** §8.3 flips the panel to Files whenever a workspace opens.
  If the intent is instead "open several repositories in a row without the panel moving", the
  watcher comes out and the two specs in §13.2 grow to roughly ten. The auto-switch is also what
  makes the Files tab's empty state rare.
- **OQ-3 (for the implementer).** §3's rule-2 tiebreak assumes `CodeRepos.List()` returns a stable
  order (it reads `sort_order`). Confirm that when implementing; if the ordering is not total, sort
  by `(SortOrder, CreatedAt, ID)` explicitly inside `RepoWorktreeLinks` rather than relying on it.

## 17. Dogfooding note

The repo-map MCP server was used for this planning pass. `bun run mcp:repo-map:build` then
`bun run mcp:repo-map` hit `CLAUDE.md`'s step-2 hazard on the first start ("Using this repository's
existing token", no recoverable plaintext); deleting
`$KIRA_HOME/mcp-repo-map-fc694cca06c3-token.json` and restarting minted a fresh one and printed the
`claude mcp add` command, exactly as documented. Native MCP tools are unavailable in this harness per
step 3, so every call went over plain HTTP/JSON-RPC (step 4).

What it answered well, each replacing a whole-file read:
`find_definition {"symbol":"WorktreeEntry"}` correctly reported **two** symbols and asked for
disambiguation, then `read_symbol` on `packages/git-ipc/src/contract.ts` returned the full eleven-
field interface with its doc comment — the single call that settled §0's "does `WorktreeEntry` carry
enough";
`read_symbol {"symbol":"RepoSummary","file":"apps/kira-studio/internal/gitclient/repo.go"}` returned
the struct carrying `CommonDir`/`IsLinkedWorktree`, which is what §2.3 and the whole of §4 rest on;
`search_files {"query":"coderepos"}` located all three `coderepos` files across Go and TS in one
call.

**No new issue found, and nothing re-checked that was already open.** `docs/v1.8/mcp-repo-map-issues.md`
gets no entry from this pass — manufacturing one would be the invented finding `CLAUDE.md` warns
against.
