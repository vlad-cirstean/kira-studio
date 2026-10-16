# P135 — `ade` icon, dependency nodes, inline Jira line, extend-only estimate: plan

Plan for `docs/v2.0/SPEC.md`'s **P135** row. Four user requests, one phase, implemented and
committed in the row's own order (1)-(4). Planned against chapter branch
`claude/unfinished-phases-ru3wo4` at `f4605a67`. Every line number below is at that commit.

**Discovery method, disclosed.** CodeGraph was loaded through `ToolSearch` and used for every
symbol, call-graph and blast-radius question: 9 `codegraph_explore` calls, made before any `Read`
of the files they covered. Queries: `useQueue` item model; `Item`/`buildItems` and the wire types;
Go facts, storage model and `Load`; repo `AddNewWork`/`Archive` and the bridge validators;
`AdeStackRow`/`AdeStackBlock`/`AdeContinuationRow`/`AdeDayBand`; `AdeEstimateField`/
`AdeAddPopover`/`AdeAgentsTab`/`jira.ts`; `buildStacks`/`computeEffDay`/`buildMergeOrder`;
`QueueItem` construction, `buildPanel` and `useTimelineDrag`; `AdeDetailPanel`/`AdeDetailsTab`/
`AdePanelHeader`/`timelineOps`/`AdeTimeline`. `Read`/`rg` then confirmed exact line numbers, the
migration registry, the codicon font mapping and the fixture files. Environment: `bun install`,
`go mod download`, `sh scripts/setup.sh` and both frontend builds ran clean in the planning worktree.

---

## 0. What the row left open, and resolutions

| Open point | Resolution | Where |
|---|---|---|
| (1) Which codicon replaces the hand-drawn plus | `add`. It is the canonical name for codepoint `\ea60`; `plus`, `gist-new` and `repo-create` are aliases of the same glyph (`node_modules/@vscode/codicons/src/template/mapping.json`). `packages/workbench/src/components/TabStripNewButton.vue:39` already uses `<CodiconIcon name="add" :size="13" />` for the same "+" role. No better match exists in the pack. | §3 |
| (1) Glyph typography (`↳ ✓ ↑ ·`, `AdeActivityGlyph`) | Out of scope, per the row. Untouched. | §3 |
| (2) Storage: own table, or a row in `ade_branches`/`ade_new_work` | **Own table `ade_dependencies`, plus link table `ade_blockers`**, migration `0006`. Not `ade_new_work`: `reconcileNewWork` would rebind a dependency onto a branch, it would take an `ade_colors` slot, and it carries `start_from`/sessions. Not `ade_branches`: its primary key is a branch name and the facts pipeline runs git on every live row. Link table, not a JSON column: links are many-to-many, and rebind/archive/resolve each become one statement. | §4.1 |
| (2) Id space | `dep:<uuid>`. Git bans `:` in ref names, so it never collides with a branch id; the `dep:` prefix never collides with `nw:`. | §4.1 |
| (2) Plan day, colour slot | Neither. A dependency has no `ade_plan` row and no `ade_colors` slot. Its day is derived (scheduling rule below); its colour is one fixed kind colour. | §4.1, §4.5 |
| (2) Data model size | `id`, `title` (required), `waiting_on` (free text, may be empty), `expected_by` (ISO date or NULL), `created_at`, `resolved_at`. Links: `(dependency, item)` pairs. Nothing else. | §4.1 |
| (2) What may be blocked | A live `mine` or `parked` branch, or live new work. Not `review` (someone else's branch, read-only here), not archived, not another dependency. Enforced in the repo layer (`ErrNotBlockable`). | §4.2 |
| (2) Scheduling rule | `neededBy` = earliest effective day over the dependency's linked, unmerged blocked items whose day is not Later. `own` = `expected_by` as a day offset. Day = `own ?? Later` with no `neededBy`; `neededBy` with no `own`; `min(own, neededBy)` with both. So a dependency **never sits on a day after the day its earliest blocked item starts**. The row's floor is met by construction. | §4.4 |
| (2) Late dependency: move the blocked item? | No. The plan day is the user's own decision; nothing moves it automatically. A dependency is `late` when `own > neededBy`, or when `own < 0` (expected date passed, still unresolved). Late shows as a red tag on the dependency and a red chip on each blocked item. | §4.4 |
| (2) Colour/kind distinction | Carried by shape first: dotted 1px box border (no other kind uses dotted), a `globe` codicon in place of the colour square, no drag cursor. Accent colour `#4fb8c4` for the box's left bar and icon, title tint `#9fdde4`. The 20-colour palette spans the hue wheel, so hue alone cannot separate it; shape does. | §4.5 |
| (2) Blocker link UI | On the blocked item: a compact chip in its own action-column cell (`globe` icon plus count), tone blue, red when any linked dependency is late, tooltip listing each dependency. Design §2.3 (`design/SPEC.md:112`) puts every label in the 210px action column, never in a box. In the panel: a "Blocked by" row in the Details tab, chips with unlink plus a Popover+Command picker. On the dependency: its own panel lists "Blocks" chips. | §4.6, §4.7 |
| (2) Creation path | A third tab, **Dependency**, in `AdeAddPopover.vue`. One creation path for every timeline entry; a separate affordance would add a second button to the header for the same popover shape. The Blocks field defaults to the currently selected item when that item is blockable. | §4.8 |
| (2) Lifecycle end | **Resolve**, a panel header action. Sets `resolved_at`, deletes the dependency's links, moves it to History with `how = 'resolved'`. No confirmation dialog: resolve loses nothing. No "unresolve" in this phase. | §4.2, §4.7 |
| (2) Drag | Never draggable, never a drop box. The block omits `data-ade-block`/`data-ade-box`; a drop over it falls through to its band. Its day is derived, so a drag would have nothing to write. | §4.5 |
| (2) Hours, merge order, git facts, conflicts, shares, PR/CI | None, and not computed. The Go `DependencyFact` has no git field; `facts.go` never sees a dependency. `useQueue` excludes it from `merging`, `mergeN`, `buildHoursOn`, `atRisk`, drag ids, "Start"/"overdue" ids and the branch-from/queue-after options. | §4.3, §4.4 |
| (2) P136 hand-off | P136 classifies dependencies itself. Facts it needs: `kind === 'dependency'`, zero hours, never in the merge order. | §4.4 |
| (3) SPEC says `item.jiraKey` is on `QueueItem` (`useQueue.ts:105`) | **Wrong at `f4605a67`.** `useQueue.ts:105` is `QueueItem.kind`. Only the internal `Item` carries `jiraKey` (`:530`); `QueueItem` (`:103-124`) has no Jira field, and `Item` has no URL. This phase plumbs `jiraUrl` onto `Item` and `jira: { key, url } \| null` onto `QueueItem`. No SPEC edit: the row's intent is clear. | §5.1 |
| (3) "Title" on the Jira line | The item's own title. P129 has no Jira sync, so the app stores no Jira-side title; the item title is usually the ticket title typed at creation. Line shows `<KEY> <title>`, title omitted when it equals the key (a title-less item already falls back to its key). **Interpretation call.** The user can narrow it to key only. | §5.2 |
| (3) Design's rejected list ("extra details on queue rows", `design/SPEC.md:333`) | The user's request overrides it for this line only. Disclosed. | §5.2 |
| (3) Row height and alignment | Jira rows become `h-14` (56px); others stay `h-10` (40px). One helper `rowHeightClass(item)` in new `ade/rowHeight.ts` sets both the row and its action-column cell, so cells stay aligned. The day band and continuation rows have no fixed height to update (§1). Drag hit-testing is DOM-based (`closest('[data-ade-box]')`), so height is irrelevant to it. | §5.3 |
| (3) The link inside the row | The row's title is a `<button>`; an `<a>` inside it is invalid HTML. The Jira line is a sibling below the button, the key an `<a target="_blank" rel="noopener noreferrer">` with `@click.stop`. A key with no URL renders as plain text. | §5.2 |
| (3) Dependencies and Jira | A dependency carries no Jira key. Its row never grows. | §5.1 |
| (4) Extend-only affordance | Once set: a read-only total plus an **Extend by** number input and an **Extend** button. The total becomes old plus delta, same unit. Not a `+`-only stepper: a 3-day extension would be 6 clicks and 6 writes. | §6.1 |
| (4) Unit toggle once set | **Locked.** The toggle is not rendered once set. Hours and days have no fixed ratio here (`parseEst`, `useQueue.ts:371-394`, uses `workdayHours` and `spanDayShare`), and the toggle keeps the number (`design/SPEC.md:169`), so `3d` would become `3h`. | §6.1 |
| (4) Stale-window and bypass safety | Server guard too. `SetBranchMeta` and `UpdateNewWork` read the old `est` in a transaction when the patch sets `est`, and refuse a clear, a unit change or a smaller number (`ErrEstimateShrink`, `E_INVALID`). The UI alone cannot close two windows racing. | §6.2 |

## 1. Confirmed current state

- **Icon.** `rg -n '<svg|<path d=' apps/kira-space/frontend/src/ade` returns 2 hits, both in
  `AdeAgentsTab.vue` (`:124` and `:134`). The whole inline SVG spans `:124-135`, inside the
  new-session button `:116-136` (`data-testid="ade-agents-new"`). `CodiconIcon` is used by 8 `ade/`
  files, matching the row. `@vscode/codicons` 0.0.46-24 is a root dependency.
- **Item model.** `ItemKind = 'mine' | 'review' | 'parked'` (`useQueue.ts:30`). `QueueItem`
  `:103-124`, `QueueStack` `:126-136`, `QueueCell` `:144-161`, `QueueSegment` `:163-187`,
  `QueuePanelAction` kind union `:254-268`, `QueuePanel` `:284-334`. Internal `Item` `:515-538`,
  `buildItems` `:540-589` (two loops: `snapshot.branches`, `snapshot.newWork`).
- **Pipeline sites that switch on kind** (`useQueue.ts`): `buildStacks` `:711-742`
  (`merging = kind !== 'parked'`); `computeEffDay` `:748-782` (review takes the min of its kids'
  days: the precedent for the dependency rule); `buildMergeOrder` `:895-938`; `computeAfter`
  `:980-989`; `workStatus` `:1004-1032`; `branchStatusOf` `:1034-1053`;
  `tagForMergedParkedConflictRipple` `:1098-1157`; `buildCells` `:1267-1313`; `buildHoursOn`
  `:1319-1343`; `idsOfNonReview` `:1406-1411` (feeds `overdueIds`/`startIds` `:1627-1628`);
  `buildBands` history `how` `:1559-1566`; `buildPanelMono` `:1843-1863`;
  `buildPanelBranchFrom` `:1867-1884`; `buildPanel` `:1912-2005` (`isNewWork = item.branch === ''`
  at `:1917`, which a dependency would wrongly satisfy); `useQueue` `atRisk` `:2084`, `dragIds`
  `:2133`, `parked` `:2146`, `QueueItem` build `:2191-2229`.
- **Kind sites outside `useQueue.ts`** (`rg -n "kind ===|kind !==|'parked'" …/ade`):
  `AdeStackRow.vue:31,36-37,44,56-57,98-100,116`; `AdePanelHeader.vue:25-26,31`;
  `AdeAddPopover.vue:59` (Start-from filter; a dependency is non-draft with `branch: ''`, so it would
  leak in as an empty option); `dialogCompose.ts:115` (`ViewItemLike.kind` union, filled through an
  `as ViewItemLike` cast, so typecheck will not flag it); `timelineOps.ts:84-115` (drop verdicts,
  no change needed since dependencies are never dragged).
- **Layout.** `AdeStackRow.vue` root `:67-80` is `flex h-10`. `AdeStackBlock.vue` action-column
  cells are `flex h-10` at `:92`; the box is `:141-150`. `AdeDayBand.vue`'s blocks column
  (`:137-141`) is `flex flex-col gap-1.5` with no fixed heights. `AdeContinuationRow.vue` is a
  `h-7` pointer row, not aligned to stack rows. Drag: `useTimelineDrag.ts` targets
  `[data-ade-block]` (handle `[data-ade-box]`) and `[data-ade-row-movable]`;
  `AdeTimeline.vue:72-81` resolves drop targets by `closest()`.
- **Estimate.** `AdeEstimateField.vue` (89 lines): raw `<input type="number">` committing on
  `@change`, plus an h/d fieldset toggle whose `pickUnit` commits immediately. `useItemMeta.ts:17`
  `EST_RE = /^\d+(?:\.\d+)?[hd]$/`; `setEstimate` `:111-121`. Bridge `adeEstRe`
  (`bridge/ade.go:550-557`). Repo `UpdateNewWork` `:305-345` and `SetBranchMeta` `:350-390` write
  `est` in one non-transactional `UPDATE` (`:328-331`, `:373-376`).
- **Storage.** `0005_p129_ade_queue.sql` defines four tables; FK style
  `REFERENCES code_repos (id) ON DELETE CASCADE`. Migrations embed through `//go:embed *.sql` but
  apply from an explicit ordered `names` list in `storage/migrations/embed.go`, so a new file must
  be registered there. `internal/sqlitex/sqlitex.go:49` sets `_foreign_keys=1`.
- **Snapshot.** Go `RepoSnapshot` `queue.go:149-165`, built by `snapshotLocked` `:454-558`
  (`RepoSnapshot{…}` literal `:546-557`); `HistoryItem` `:136-140`; `buildHistory` `:891-911`.
  Bridge `toWireAdeSnapshot` `bridge/ade.go:454-513`. Frontend `wire.ts` `AdeRepoSnapshot`
  `:135-151`, `AdeHistoryItem` `:125-132`; `bridge/index.ts:72-89` `normalizeAdeRepoSnapshot`.
  AdeService has 19 bound members today.
- **Fixtures building snapshots** (`newWork:` literal, each needs `dependencies: []`):
  `tests/unit/support/mockupToWire.ts`, `tests/unit/ade-queue-rules.spec.ts`,
  `tests/unit/ade-dialog-flow.spec.ts`, `tests/unit/ade-dialog-rules.spec.ts`,
  `tests/ui/ade-panel.spec.ts`, `tests/ui/ade-timeline.spec.ts`, `tests/ui/ade-dialogs.spec.ts`,
  `tests/ui/ade-module.spec.ts` (all under `apps/kira-space/`).

## 2. Split

No split. One sequential implementer. (2)-(4) share `useQueue.ts`, `AdeStackRow.vue` and
`AdeStackBlock.vue`, and (3) must account for (2)'s kind, so there is no zero-overlap file boundary.

---

## 3. Deliverable (1): new-session icon

`apps/kira-space/frontend/src/ade/AdeAgentsTab.vue`:

- Replace `:124-135` (the whole `<svg …><path d="M12 5v14M5 12h14" /></svg>`) with
  `<CodiconIcon name="add" :size="12" />`.
- Add `import CodiconIcon from '@theme/CodiconIcon.vue';` to the script imports (alphabetical,
  as in `AdePanelHeader.vue`).
- Visual weight: the SVG drew 12px at `stroke-width="2"`; codicon `add` at `:size="12"` is a 1px
  outline glyph at 12px. That is the weight every sibling button uses (`AdePanelHeader.vue`,
  `TabStripNewButton.vue`). Confirm in the live check; keep `12`.

No `package.json` or `bun.lock` change. Commit 1.

## 4. Deliverable (2): external dependency nodes

### 4.1 Migration `0006`

New `apps/kira-space/internal/storage/migrations/0006_p135_ade_dependencies.sql`:

```sql
-- P135: external waits (a vendor reply, another team's release). Never a branch: no git facts, no
-- plan row, no colour slot. Id 'dep:' || uuid (git bans ':' in refs, so no collision with a branch).
CREATE TABLE ade_dependencies (
  id           TEXT PRIMARY KEY,
  code_repo_id TEXT NOT NULL REFERENCES code_repos (id) ON DELETE CASCADE,
  title        TEXT NOT NULL CHECK (title <> ''),
  waiting_on   TEXT NOT NULL DEFAULT '',   -- free text, Markdown not rendered
  expected_by  TEXT,                       -- ISO date, NULL = none
  created_at   INTEGER NOT NULL,
  resolved_at  INTEGER
);
CREATE INDEX ade_dependencies_repo ON ade_dependencies (code_repo_id);
-- item is a branch name or 'nw:' id; no FK (two target tables), checked in the repo layer.
CREATE TABLE ade_blockers (
  code_repo_id TEXT NOT NULL REFERENCES code_repos (id) ON DELETE CASCADE,
  dependency   TEXT NOT NULL REFERENCES ade_dependencies (id) ON DELETE CASCADE,
  item         TEXT NOT NULL,
  PRIMARY KEY (code_repo_id, dependency, item)
);
CREATE INDEX ade_blockers_item ON ade_blockers (code_repo_id, item);
```

`storage/migrations/embed.go`: append
`{Version: 6, Name: "p135_ade_dependencies", File: "0006_p135_ade_dependencies.sql"}` to the
`names` list.

### 4.2 Storage model and repo

`apps/kira-space/internal/storage/model/adequeue.go`:

- `AdeDependency{ID, CodeRepoID, Title, WaitingOn string; ExpectedBy *string; CreatedAt int64;
  ResolvedAt *int64}` with `Validate()` (id prefix `dep:`, title non-empty).
- `AdeBlocker{Dependency, Item string}`.

`apps/kira-space/internal/storage/repos/adequeue.go`:

- Sentinels beside `ErrQueued`/`ErrArchived` (`:13-18`): `ErrNotBlockable`, `ErrDependencyGone`,
  `ErrEstimateShrink` (the last for §6.2).
- Column constant and scanner for `ade_dependencies`, following `:24-27` and `:45-81`.
- `Load` (`:106-153`): read both new tables in the same transaction. `AdeQueueState` gains
  `Dependencies []model.AdeDependency` (resolved ones included, for history) and
  `Blockers []model.AdeBlocker`.
- `checkBlockable(tx, repo, item)`: pass only for an `ade_branches` row with `archived_at IS NULL`
  and `kind <> 'review'`, or an `ade_new_work` row with `archived_at IS NULL`. Otherwise
  `ErrNotBlockable`.
- `checkDependencyLive(tx, repo, id)`: row exists with `resolved_at IS NULL`, else
  `ErrDependencyGone`.
- `AddDependency(d model.AdeDependency, blocks []string) error`: one transaction; insert, then
  `checkBlockable` and insert per item.
- `UpdateDependency(repo, id string, p AdeDependencyPatch) error`: patch `Title`, `WaitingOn`,
  `ExpectedBy` (each `*string`; `ExpectedBy` of `""` writes NULL). `WHERE … AND resolved_at IS
  NULL`; zero rows is `ErrDependencyGone`.
- `ResolveDependency(repo, id string, now int64) error`: transaction; `checkDependencyLive`, set
  `resolved_at`, `DELETE FROM ade_blockers WHERE code_repo_id = ? AND dependency = ?`.
- `SetBlocker(repo, dep, item string, linked bool) error`: transaction; `checkDependencyLive`;
  linked runs `checkBlockable` then `INSERT OR IGNORE`; unlinked runs `DELETE`.
- `Archive` (`:473-519`): add `DELETE FROM ade_blockers WHERE code_repo_id = ? AND item = ?` inside
  its transaction.
- `Rebind` (`:529-577`): add `UPDATE ade_blockers SET item = ? WHERE code_repo_id = ? AND item = ?`
  beside its `ade_plan`/`ade_colors` re-keying, so a link follows new work onto its branch.

### 4.3 Queue service and snapshot (Go)

`apps/kira-space/internal/ade/queue.go`:

- `DependencyFact{ID, Title, WaitingOn string; ExpectedBy *string; CreatedAt int64;
  Blocks []string}`. No git field of any kind.
- `RepoSnapshot` (`:149-165`) gains `Dependencies []DependencyFact`.
- `buildDependencyFacts(state)`: live rows only (`ResolvedAt == nil`), sorted by `CreatedAt`,
  `Blocks` from `state.Blockers` sorted for stable output. Called in `snapshotLocked` and set in
  the literal at `:546-557`. Never passed to `facts.go`.
- `buildHistory` (`:891-911`): append resolved dependencies as
  `HistoryItem{Item: id, Kind: "dependency", Title, ArchivedAt: *ResolvedAt}`.
- Methods `AddDependency`, `UpdateDependency`, `ResolveDependency`, `SetBlocker`: store call plus
  `notifyChanged`, the shape of `AddNewWork` (`:1223-1242`). No `openRepo`, no `gitsession`, no
  worktree. `AddDependency` mints `"dep:" + uuid`.

`apps/kira-space/internal/ade/queue_test.go`: see §7.

### 4.4 Bridge (Go)

`apps/kira-space/internal/bridge/ade.go`:

- `AdeDependencyWire{ID string \`json:"id"\`; Title; WaitingOn; ExpectedBy *string; CreatedAt
  int64; Blocks []string}`; snapshot wire gains `Dependencies []AdeDependencyWire
  \`json:"dependencies"\`` built with `make` (non-nil, per `wire.ts:1-10`'s array policy), and
  `Blocks` likewise non-nil.
- Four new methods, each `Validate()` then `adeQueueError(...)`:
  - `AddDependency(AdeAddDependencyArgs{CodeRepoID, Title, WaitingOn, ExpectedBy string; Blocks
    []string}) (string, error)`
  - `UpdateDependency(AdeUpdateDependencyArgs{CodeRepoID, ID string; Patch
    AdeDependencyPatchArgs{Title, WaitingOn, ExpectedBy *string}}) error`
  - `ResolveDependency(AdeDependencyArgs{CodeRepoID, ID string}) error`
  - `SetBlocker(AdeSetBlockerArgs{CodeRepoID, Dependency, Item string; Linked bool}) error`
- Validation: new `validateAdeDependencyID` (`validateAdeItemID` plus `dep:` prefix); title
  required, then `validateAdeName`; `waitingOn` bounded by `adeMaxNotesBytes`; `expectedBy` empty or
  `validateAdeISODate`; each blocked item through `validateAdeItemID`, and at most 50 in one call.
- New `validateAdeWorkItemID` (`validateAdeItemID` plus refusing a `dep:` prefix). Use it for
  `AdeItemArgs`, `AdeArchiveArgs`, `AdeSetQueuedAfterArgs` (both ids), every key of
  `AdeSetPlanArgs.Days` and every entry of `.Order`. A dependency never gets a plan row, a
  queue-after link or an archive, even from a hand-built call. `AdePrepareLaunchArgs` (`:85-92`)
  takes `Branch`/`NewWorkID`, never an item id, so it needs no edit.
- `adeQueueError` (`:661-668`): map `ErrNotBlockable`, `ErrDependencyGone`, `ErrEstimateShrink` to
  `E_INVALID` with the sentinel's own message.
- AdeService members: 19 before, 23 after.

Bindings regenerate through `sh scripts/setup.sh` (gitignored, `apps/kira-space/.gitignore:4`).

### 4.5 Frontend plumbing

- `ade/wire.ts`: `AdeDependency{id, title, waitingOn, expectedBy: string | null, createdAt,
  blocks: string[]}`; `AdeRepoSnapshot.dependencies: AdeDependency[]`; `AdeHistoryItem.kind` union
  gains `'dependency'`; arg types for the four methods.
- `bridge/index.ts:72-89`: coerce `dependencies ?? []` and each `blocks ?? []`. Four new control
  methods beside `adeAddNewWork` (`:268-269`); `adeAddDependency` resolves the new id as
  `trust<string>`.
- `ade/mutations.ts`: `useAdeAddDependency`, `useAdeUpdateDependency`, `useAdeResolveDependency`,
  `useAdeSetBlocker`, shaped like `useAdeAddNewWork` (`:205-208`), invalidating the repo snapshot.
- `ade/state/adeActions.ts`: `addDependency` (returns the id, then `adeUiStore.select` it, as
  `addNewWork` does at `:250-255`).
- `tests/ui/support/ipcChannels.ts` (`kira:ade:addDependency`, `…updateDependency`,
  `…resolveDependency`, `…setBlocker`) and `tests/ui/support/mockRuntime.ts`
  (`AdeService.AddDependency` etc.), with in-memory handlers that mirror the repo rules
  (blockable check, resolve deletes links).
- `dependencies: []` in the 8 fixture files from §1.

### 4.6 `useQueue.ts`: the dependency kind

Types:

- `ItemKind` (`:30`) gains `'dependency'`.
- `Item` (`:515-538`) gains `jiraUrl: string` (§5), `blockers: string[]` (dependency ids linked to
  this item), and for dependencies `waitingOn: string`, `expectedBy: string | null`,
  `blocks: string[]`.
- `QueueStack`/`Seg`/`QueueSegment` gain `dependency: boolean` beside `parked`.
- `QueueCell` gains `blocked: { count: number; tone: 'blue' | 'red'; tip: string } | null`.
- `QueueItem` gains `jira` (§5), `blockers: { id: string; title: string; late: boolean }[]`, and
  `dependency: { waitingOn: string; expectedBy: string | null; neededBy: number | null;
  late: boolean } | null`.
- `QueuePanelAction` kind union (`:254-268`) gains `'resolve'`.
- `QueuePanel` (`:284-334`) gains `dependency: QueuePanelDependency | null`, `blockers` and
  `blockerOptions: { id: string; title: string }[]` (live dependencies not yet linked).
  `QueuePanelDependency = { title, waitingOn, expectedBy, neededByLabel: string | null,
  late: boolean, lateTip: string, blocks: { id, title }[] }`.
- `const DEPENDENCY_COLOR = '#4fb8c4'` beside `PALETTE`. A kind-encoding literal; P138's allowlist
  keeps it.

`buildItems` (`:540-589`): third loop over `snapshot.dependencies`: `kind: 'dependency'`,
`branch: ''`, `base: ''`, `est: ''`, `draft: false`, `merged: false`, git counts 0, empty
`files`/`commits`/`sessions`, `jiraKey: ''`, `jiraUrl: ''`. Then fill each non-dependency item's
`blockers` from the dependencies' `blocks`, ignoring ids no longer present.

Pipeline edits, in pipeline order:

- `buildParentOf`: no edit. A dependency has `base: ''` and no `queuedAfter` row.
- `buildStacks` (`:711-742`): `merging` excludes `dependency` too. Each dependency gets its own
  single-member stack, `lead: id`, `parked: false`, `dependency: true`.
- **Scheduling.** New `applyDependencyDays(items, eff, planDay)` called right after
  `computeEffDay` (`:2036`), overwriting each dependency's entry in `eff`:

  ```ts
  // P135: a dependency sits no later than the earliest day a linked item starts.
  const needed = dep.blocks
    .map((id) => byId.get(id))
    .filter((b) => b && !b.merged)
    .map((b) => eff.get(b!.id) as number)
    .filter((d) => d !== LATER);
  const neededBy = needed.length ? Math.min(...needed) : undefined;
  const own = planDayOffset(cal, dep.expectedBy);
  const day =
    neededBy === undefined ? (own ?? LATER) : own === undefined ? neededBy : Math.min(own, neededBy);
  const late = own !== undefined && ((neededBy !== undefined && own > neededBy) || own < 0);
  ```

  Acyclic: a blocked item's day never reads a dependency's day. No clamp to today: an overdue
  blocked item puts its dependency in the same overdue place, which keeps the floor.
- `segmentForBucket`/`buildSegments`: carry `dependency` from the stack. `estSpanOf` returns 1 for
  an empty `est`, so a dependency spans one day.
- `buildMergeOrder` (`:895-938`): `mineSegs` excludes `dependency` segments; `mergeN` is already
  `mine`-only.
- `computeAfter` (`:980-989`): guard `!g.dependency` beside `!g.parked`.
- `workStatus`/`branchStatusOf`: dependency first. Status `late` red when late, else `waiting`
  grey; branch status `null`.
- Tags: new `dependencyTag` rung called before `tagForMergedParkedConflictRipple`: unlinked
  `external` grey (tip "external wait, no linked item"); linked on time `needed <dayLabel>` blue
  (`dayLabel`, `:494`); late `late` red (tip "expected <day>, needed <day>" or "expected date
  passed"). Segment action `null`.
- `buildCells` (`:1267-1313`): a dependency member's cell has no tag/action/info. A non-dependency
  member with `blockers.length > 0` gets `blocked`: `count`, tone red when any is late else blue,
  tip one line per dependency (`<title> · needed <day> · expected <day|none>`). The `start`
  action rule is unchanged (`kind === 'mine'`).
- `buildHoursOn` (`:1319-1343`): skip `dependency` explicitly beside `review`.
- `idsOfNonReview` (`:1406-1411`): rename `idsOfPlannable`, exclude `dependency` too; update its
  two callers (`:1627-1628`).
- `buildBands` history `how` (`:1559-1566`): `kind === 'dependency'` gives `'resolved'`.
- `buildPanelMono` (`:1843-1863`): dependency branch `<dayLabel> · external` (its else branch
  would print `· not merging`).
- `buildPanelBranchFrom` (`:1867-1884`): exclude `dependency` beside `parked`.
- `buildPanel` (`:1912-2005`): a dependency returns `buildDependencyPanel(item, ctx)` early
  (header facts, `readOnly: false`, actions `[resolve]`, `dependency` filled, empty
  `changes`/`running`/`stopped`/`candidates`). `isNewWork` (`:1917`) becomes
  `item.branch === '' && item.kind !== 'dependency'`. Other panels fill `blockers` and, unless
  `readOnly` or `kind === 'review'`, `blockerOptions`; otherwise empty.
- `useQueue`: `atRisk` (`:2084`) and `dragIds` (`:2133`) exclude `dependency`; `dependency: g.dependency`
  at `:2146`; `QueueItem` build (`:2191-2229`): dependency `color: DEPENDENCY_COLOR`,
  `branchText: waitingOn`, `acts: []`, `agents: []`, `dependency` facts filled, `blockers` mapped.

Outside `useQueue.ts`:

- `dialogCompose.ts:115`: `ViewItemLike.kind` union gains `'dependency'` (the `as` cast hides it
  from typecheck).
- `AdeAddPopover.vue:59`: Start-from filter excludes `kind === 'dependency'`.
- `timelineOps.ts`: none (never dragged).

### 4.7 Rendering

`AdeStackRow.vue`:

- `movable` (`:31`): `kind !== 'review' && kind !== 'dependency'`.
- `titleClass` (`:35-39`): dependency `text-[#9fdde4]`.
- Colour square (`:94-109`): for a dependency render `<CodiconIcon name="globe" :size="11"
  :style="{ color: item.color }" />` instead.
- Add `:data-ade-kind="item.kind"` on the root (`:67-80`) for tests.
- Subline (`:133-136`) already renders `branchText`, which is `waitingOn` for a dependency.

`AdeStackBlock.vue`:

- `boxStyle` (`:47-64`): a `segment.dependency` branch first: `border: 1px dotted #4fb8c4`,
  `borderLeft: 3px solid #4fb8c4`, `background: rgba(79,184,196,0.07)`.
- Root (`:82-87`): `:data-ade-block="segment.dependency ? null : ''"`; box (`:141-150`):
  `:data-ade-box="segment.dependency ? null : ''"`. Not draggable, not a drop box; drops fall
  through to `[data-ade-band]`. Keep `data-testid`s; add `:data-ade-dependency`.
- Cell (`:88-140`): when `cell.blocked`, render a chip before `cell.info`:
  `<span :title="cell.blocked.tip" :style="tagStyle(cell.blocked.tone)"
  :data-testid="\`ade-blocked-chip-${segment.members[i]?.id}\`" class="…same chip classes…">
  <CodiconIcon name="globe" :size="10" /> {{ cell.blocked.count }}</span>`.

`AdePanelHeader.vue`:

- `dotClass`/`dotStyle` (`:24-41`): dependency renders the `globe` icon in `DEPENDENCY_COLOR`
  (export the constant from `useQueue.ts`).
- `onActionClick` (`:72-105`): handle `'resolve'` before the `dialogCtx` guard, calling
  `useAdeResolveDependency` then clearing selection through `adeUiStore.select(codeRepoId, '')`.
  Button icon `pass`.

`AdeDetailPanel.vue`: after the header (`:48`), render
`<AdeDependencyDetails v-if="panel.dependency" …/>` and wrap the `<Tabs>` block (`:50-94`) in
`v-else`. A dependency has no changes or agents.

New `ade/AdeDependencyDetails.vue` (`<script setup lang="ts">`, Tailwind only):

- Name: shadcn `Input`, blur-commit, empty reverts (same rule as `AdeDetailsTab`'s Name grid).
- Waiting on: shadcn `Textarea`, blur-commit.
- Expected by: shadcn `Input type="date"`, change-commit, empty clears.
- A line `needed by <day>` or, when late, the red `lateTip`.
- Blocks: chips (`Badge`), click selects the item, an `x` `Button size="xs"` unlinks through
  `useAdeSetBlocker`.

New `ade/AdeBlockerRow.vue`, mounted in `AdeDetailsTab.vue` below the link rows (`:205-214`), above the estimate (`:217`), when
`!panel.readOnly && panel.kind !== 'review'`:

- Label "Blocked by"; one chip per `panel.blockers` (title, red when late, click selects the
  dependency, `x` unlinks).
- "Link" `Button size="xs"` opening a `Popover` with a `Command` list of `panel.blockerOptions`;
  picking one calls `useAdeSetBlocker({ linked: true })`. Hidden when there are no options.
- Direct mutation use, following `AdeDetailsTab`'s own `useAdeBindNewWork` precedent.

### 4.8 Creation: Add popover's Dependency tab

`AdeAddPopover.vue` (193 lines):

- `activeTab` (`:40-46`) becomes `'new' | 'existing' | 'dependency'`; reset on open as today.
- Third `TabsTrigger` after `:131-136`, `data-testid="ade-add-tab-dependency"`, label
  "Dependency".
- `TabsContent value="dependency"`: Title `Input` (required), Waiting on `Textarea`, Expected by
  `Input type="date"`, Blocks `NativeSelect` (options: live `mine`/`parked` branches and new work,
  plus "None"), default `adeUiStore.selectedByRepo[codeRepoId]` when that id is an option, else
  "None". Submit `Button` "Add dependency" (`ade-add-dependency-submit`), disabled while the title
  is blank.
- `submitDependency` calls `adeActionsStore.addDependency`, then closes, as `submitNewWork`
  (`:73-92`) does.

## 5. Deliverable (3): Jira line

### 5.1 Data

- `Item` gains `jiraUrl`: `b.jira.url` in the branch loop, the new-work row's own URL in the
  new-work loop, `''` for dependencies.
- `QueueItem.jira: { key: string; url: string } | null`: non-null when `jiraKey !== ''`. Stored
  values are already `parseJira` output (`jira.ts`), so nothing re-parses.

### 5.2 Row

`AdeStackRow.vue`, after the title `<button>` (`:123-138`) and inside a new
`flex min-w-0 flex-1 flex-col justify-center` wrapper (the button loses `flex-1`/`h-full` and keeps
its two spans):

```vue
<span v-if="item.jira" class="flex min-w-0 items-center gap-1.5 text-kira-sm leading-[14px]"
  data-testid="ade-row-jira">
  <a v-if="item.jira.url" :href="item.jira.url" target="_blank" rel="noopener noreferrer"
    class="shrink-0 font-data text-[#7aa7ff] hover:underline" @click.stop>{{ item.jira.key }}</a>
  <span v-else class="shrink-0 font-data text-[#7aa7ff]">{{ item.jira.key }}</span>
  <span v-if="item.title !== item.jira.key" class="truncate text-[#9a9ca5]">{{ item.title }}</span>
</span>
```

The link's own click stops propagation, so it does not select the row. The row's own
`@keydown.enter` still selects when focus is on the row.

### 5.3 Height and alignment

New `apps/kira-space/frontend/src/ade/rowHeight.ts`:

```ts
import type { QueueItem } from './useQueue';

/** Row and its action-column cell share one height, so cells stay aligned. */
export function rowHeightClass(item: Pick<QueueItem, 'jira'> | undefined): 'h-14' | 'h-10' {
  return item?.jira ? 'h-14' : 'h-10';
}
```

- `AdeStackRow.vue:68`: `h-10` becomes `:class="rowHeightClass(item)"`.
- `AdeStackBlock.vue:92`: the cell's `h-10` becomes `rowHeightClass(items[i])`.
- `AdeDayBand.vue`, `AdeContinuationRow.vue`, history rows: no edit (§1). Tailwind emits `h-14`
  because the literal appears in `rowHeight.ts`, which the app's Tailwind source scan covers (the
  implementer confirms the class in the built CSS).

## 6. Deliverable (4): extend-only estimate

### 6.1 `AdeEstimateField.vue`

- `locked = computed(() => props.estimate.num !== '')`.
- Unlocked branch: today's markup, unchanged, except the raw `<input>` becomes shadcn `Input`
  (keeping `id="ade-est-num"`, `@change="commit"`) as the phase touches the file.
- Locked branch, replacing both input and toggle:
  - Read-only total `<span data-testid="ade-estimate-total">{{ estimate.num }}{{ estimate.unit
    }}</span>`.
  - `Input type="number" min="0.5" step="0.5" v-model="extendBy"`
    (`data-testid="ade-estimate-extend"`), no `@change`/`@blur` handler, so typing and blurring
    write nothing.
  - Static unit label (`h` or `d`); no toggle rendered.
  - `Button size="sm"` "Extend" (`ade-estimate-extend-submit`), disabled unless
    `Number(extendBy) > 0`. On click: `total = Math.round((parseFloat(num) + delta) * 100) / 100`,
    emit `save` with `${total}${unit}`, reset `extendBy`.
- `hint` unchanged; it reads `estimate.days`, which the refreshed snapshot recomputes as the value
  grows.

### 6.2 Server guard

`storage/repos/adequeue.go`, `UpdateNewWork` (`:305-345`) and `SetBranchMeta` (`:350-390`): when
`patch.Est != nil`, run in a transaction: select the current `est`, call
`checkEstExtends(old, new)`, then update.

```go
// P135: once set, an estimate only grows; unit is fixed (no h/d ratio).
func checkEstExtends(old, next string) error {
	if old == "" {
		return nil
	}
	if next == "" || next[len(next)-1] != old[len(old)-1] {
		return ErrEstimateShrink
	}
	o, _ := strconv.ParseFloat(old[:len(old)-1], 64)
	n, _ := strconv.ParseFloat(next[:len(next)-1], 64)
	if n < o {
		return ErrEstimateShrink
	}
	return nil
}
```

The bridge already guarantees both match `adeEstRe`, so the parse cannot fail. Equal is allowed:
a retried write is a no-op, never a shrink. `Rebind` copying `est` from new work to its branch is
a server-internal move and stays unguarded.

## 7. Tests

Per `CLAUDE.md`'s unit-test bar: only the scheduling rule earns a unit test (several interacting
inputs: link set, merged items, Later, expected date, past dates). Storage CRUD and the one-line
estimate comparison get none.

- `apps/kira-space/tests/unit/ade-queue-rules.spec.ts`, new `describe('dependency')` block:
  unlinked with no date lands Later; unlinked with a date lands on it; linked with no date lands on
  the blocked item's day; linked with a later date lands on the item's day and is `late`; two
  blocked items take the earliest; a merged blocked item is ignored; a past date with no link is
  `late`; zero day hours; no `mergeN`; absent from `dragIds`, `startIds`, `overdueIds`; blocked
  chip tone red only when late.
- `apps/kira-space/internal/ade/queue_test.go`, one `TestQueue_Dependencies_LinkLifecycle` on
  `newQueueHarness` (`:106`): add a dependency blocking new work; rebind the new work onto a branch
  and see the link follow; archive the branch and see the link gone; linking a review item or an
  archived item returns `ErrNotBlockable`; resolve moves it to history with kind `dependency` and
  leaves no link. Justified as a cross-table invariant over rebind and archive, not CRUD.
- `apps/kira-space/tests/ui/` (new scenarios in the existing ade specs):
  - `ade-timeline.spec.ts`: a dependency box has `data-ade-dependency`, no `data-ade-box`, a dotted
    border, and no drag; a drag of a mine item dropped on it lands in the band.
  - `ade-timeline.spec.ts`: a blocked item shows `ade-blocked-chip-<id>`; the dependency sits on
    the blocked item's day; a later `expectedBy` shows `late` and a red chip.
  - `ade-timeline.spec.ts`: a Jira item's row and its action cell are both 56px
    (`boundingBox().height`); a non-Jira row is 40px; the key link has `target="_blank"`.
  - `ade-dialogs.spec.ts`: the Add popover's Dependency tab creates one, selects it, and the Blocks
    default is the selected item.
  - `ade-panel.spec.ts`: dependency panel edits title, waiting-on and expected-by; Resolve moves it
    to history as `resolved`.
  - `ade-panel.spec.ts`: Blocked-by link and unlink from the item panel; the chip follows.
  - `ade-panel.spec.ts`: estimate: a fresh value is settable in h and d; once set, the toggle is
    gone, typing into Extend by and blurring writes nothing, Extend adds, the hint updates.
  - `ade-panel.spec.ts` (agents tab test): the new-session button contains `.codicon-add` and no
    `svg`.

## 8. Steps and commits

Each commit passes the pre-commit hook without `--no-verify`. Every message ends with the session's
attribution lines.

1. `fix(ade): new-session button uses the add codicon`
2. `feat(ade): dependency storage (migration 0006, repo methods, link cleanup on archive and rebind)`
3. `feat(ade): dependency facts in the snapshot and AdeService methods` (Go queue and bridge,
   `wire.ts`, `bridge/index.ts`, mutations, `adeActions`, mocks, the 8 fixtures)
4. `test(ade): dependency link lifecycle across rebind, archive and resolve`
5. `feat(ade): dependency kind in useQueue: scheduling floor, tags, panel facts` (plus
   `dialogCompose.ts`, `AdeAddPopover.vue:59` filter, the unit block)
6. `feat(ade): dependency boxes and blocked chips on the timeline`
7. `feat(ade): dependency detail panel and blocker linking`
8. `feat(ade): Dependency tab in the Add popover`
9. `feat(ade): Jira line on timeline rows`
10. `feat(ade): estimate is extend-only once set` (UI and server guard)
11. `test(ade): ui coverage for P135`
12. Follow-up `fix(…)` commits for whatever §9 finds, one per finding.
13. `docs: ARCHITECTURE records ade dependency nodes and extend-only estimate (P135)`:
    `docs/ARCHITECTURE.md`'s ade queue section (`:2200-2220`) gains `ade_dependencies`/
    `ade_blockers` (migration 0006), the scheduling rule, and the estimate guard.
14. `docs(v2.0): P135 result`: result section under the SPEC row, with §10's audit.

## 9. Verification

Fast checks per commit; full suites once near the end (`CLAUDE.md`).

- `bun run typecheck`, `bun run lint`, `bun run lint:dead`
- `bun run build:space`
- `go build ./...`
- `go test ./apps/kira-space/internal/ade/... ./apps/kira-space/internal/bridge/... ./apps/kira-space/internal/storage/...`
- `bun run test:unit` (all green, including the new dependency block and the parity specs)
- `bun run test:ui:space`: every existing ade scenario green, plus the §7 additions. Existing
  40px assertions hold for non-Jira rows.
- Live check when the sandbox runs the app: add a dependency blocking a planned item, confirm its
  day and chip, resolve it; add a Jira item and confirm the 56px row; set and extend an estimate.

## 10. Closing audit

Report each row with its command and result in the result section.

| Check | Command | Expect |
|---|---|---|
| No hand-drawn icon | `rg -n '<svg\|<path d=' apps/kira-space/frontend/src/ade` | empty |
| Codicon used | `rg -n 'CodiconIcon name="add"' apps/kira-space/frontend/src/ade/AdeAgentsTab.vue` | 1 hit |
| No new dependency | `git diff --stat f4605a67 -- package.json bun.lock` | empty |
| No git fact on a dependency | `rg -n -A8 'type DependencyFact struct' apps/kira-space/internal/ade/queue.go` | fields `ID Title WaitingOn ExpectedBy CreatedAt Blocks` only |
| Facts pipeline never sees one | `rg -n -i 'dependenc' apps/kira-space/internal/ade/facts.go` | empty |
| No git in dependency methods | `rg -n -A25 'func \(q \*Queue\) (AddDependency\|UpdateDependency\|ResolveDependency\|SetBlocker)' apps/kira-space/internal/ade/queue.go \| rg 'openRepo\|gitsession\|worktree'` | empty |
| Excluded from merge, hours, drag | `rg -n "'dependency'" apps/kira-space/frontend/src/ade/useQueue.ts` | hits in `buildStacks`, `buildMergeOrder`, `buildHoursOn`, `idsOfPlannable`, `atRisk`, `dragIds`, `buildPanelBranchFrom`, `buildPanel` |
| No Merge/ready/CI state added | `rg -n -i "'merge'\|ready\|ciFailing" $(git diff --name-only f4605a67 -- apps/kira-space/frontend/src/ade)` | no hit introduced by this phase (compare against `f4605a67`) |
| New members have callers | `rg -n 'adeAddDependency\|adeUpdateDependency\|adeResolveDependency\|adeSetBlocker' apps/kira-space/frontend/src/ade` | each used by a mutation, each mutation used by a component |
| Service size | `rg -c '^func \(s \*AdeService\) [A-Z]' apps/kira-space/internal/bridge/ade.go` | 23 |
| Migration registered | `rg -n '0006_p135_ade_dependencies' apps/kira-space/internal/storage/migrations/embed.go` | 1 hit |
| Work-item ids refuse `dep:` | `rg -n 'validateAdeWorkItemID' apps/kira-space/internal/bridge/ade.go` | definition plus the 4 `Validate` sites of §4.4 |
| No Jira client | `rg -n -i 'jira' apps/kira-space/internal --glob '*.go' \| rg -i 'http\|client\|fetch'` | empty |
| Row height shared | `rg -n 'rowHeightClass' apps/kira-space/frontend/src/ade` | `rowHeight.ts`, `AdeStackRow.vue`, `AdeStackBlock.vue` |
| Estimate commits only when unlocked | `rg -n '@change' apps/kira-space/frontend/src/ade/AdeEstimateField.vue` | 1 hit, inside the unlocked branch |
| Server guard wired | `rg -n 'ErrEstimateShrink' apps/kira-space/internal` | repo sentinel, `checkEstExtends`, `adeQueueError` |
| Suites | §9 | all green |

## 11. Risks

- **Parity specs.** `ade-queue-parity`/`ade-timeline-parity` compare `useQueue` output against the
  mockup. If either deep-compares `QueueItem` or `QueueCell`, its projection needs the new fields
  (`jira`, `blockers`, `dependency`, `blocked`) excluded or defaulted. Adjust the projection, not
  the mockup expectations.
- **`dialogCompose.ts` cast.** `as ViewItemLike` hides a missing union member from typecheck;
  the §4.6 edit is manual. Grep for other `as` casts over item kinds while there.
- **Lint's cognitive-complexity ceiling.** `buildPanel` and `buildCells` sit near it; split
  `buildDependencyPanel` and the chip builder into their own functions (as `leadAndSpanOf` did).
- **Tailwind `h-14`.** Confirm the class exists in the built CSS; if the source scan misses
  `rowHeight.ts`, move the helper beside the components.
- **Date input.** `Input type="date"` yields ISO `YYYY-MM-DD`, what `validateAdeISODate` expects.
  Confirm WebKitGTK renders its picker; if not, a plain text input with the same validation.

## 12. Acceptance

| SPEC row wording | Where met |
|---|---|
| "`rg -n '<svg\|<path d=' apps/kira-space/frontend/src/ade` returns empty" | §3, §10 row 1 |
| "the new-session button's plus glyph renders at the same visual weight" | §3 (sibling-button weight), §9 live check, §7 `.codicon-add` assertion |
| "no `package.json` change" | §3, §10 row 3 |
| "a dependency node appears as its own graph entry" | §4.6 own stack, §4.7 own box |
| "distinct from every existing kind" | §0, §4.7 dotted border, `globe` icon, kind colour; §7 timeline scenario |
| "linkable from a real item as a blocker" | §4.2 `SetBlocker`, §4.7 `AdeBlockerRow`, §4.8 Blocks default; §7 panel scenario |
| "never computes or shows git facts, merge position, conflicts, shares, or PR/CI state" | §4.3 (no git field), §4.6 exclusions; §10 rows 4-8 |
| "(scheduling) never scheduled ahead of the day its blocked item needs it resolved by" | §0 rule, §4.6 `applyDependencyDays`; §7 unit block |
| "an item with a Jira key shows two lines in the timeline" (an added line) | §5.2, §5.3; §7 56px assertion |
| "an item without one keeps today's single-line height unchanged" | §5.3 `h-10`; §7 40px assertion |
| "without misaligning sibling rows or breaking the drag-and-drop hit-testing" | §5.3 shared helper, §1 DOM-based hit-testing; §7 cell-height assertion, existing drag scenarios |
| "accounts for item (2)'s new kind in the same pass" | §5.1 (dependencies carry no Jira) |
| "with a set estimate no interaction (typing, toggling the unit, blurring) can produce a value lower than the last-committed one" | §6.1 (no handler on the extend input, toggle not rendered), §6.2 server guard; §7 scenario, §10 rows 15-16 |
| "a fresh estimate is still freely settable" | §6.1 unlocked branch; §7 scenario |
| "the `hint` computed (`spans N days`) keeps updating correctly as the value only ever grows" | §6.1 `hint` unchanged, fed by the refreshed `estimate.days`; §7 scenario |
