# P136 — Top 5 "my work" stacks on the main timeline, plus a per-item work-type dropdown: plan

Plan for `docs/v2.0/SPEC.md`'s **P136** row, including the user's second clarification (work kind
is user-chosen in the details panel, not only rule-derived). Planned against chapter branch
`claude/unfinished-phases-ru3wo4` at `96a3d644`. Every line number below is at that commit.

**Discovery method, disclosed.** The shared CodeGraph index pointed at the main checkout (a
different commit), so `sh scripts/codegraph-setup.sh` built a worktree-local index first. Then 10
`codegraph_explore` calls, each before any `Read`/`rg` of the files it covered: `useQueue`
stacks/bands; `buildItems`/`Item`/wire kinds; `AddBranch`/`ValidAdeBranchKind`/`bindNewWorkLocked`;
`resolveKind`/`SetBranchMeta`/`UpdateNewWork`/`AdeAddPopover`; `AdeDetailPanel`/`AdePanelHeader`/
`setBranchMeta` patch rules; `AdeTimeline`/`AdeDayBand`/`spansForDay`; `buildSegments`/
`buildMergeOrder`/`computeEffDay`; `buildPanel`/`QueuePanel`/`AdeDetailsTab`/`useItemMeta`;
`BranchFact`/`NewWorkFact`/`Load`/`normalizeAdeRepoSnapshot`; `AdeAllAgentsView`/`adeUi` select.
`Read`/`rg` then pinned exact lines, migrations, test fixtures and mock runtime semantics.

---

## 0. Open points and resolutions

| Open point | Resolution | Where |
|---|---|---|
| Split into Part 1/Part 2? | **No.** The cap reads the stored work type; both halves touch `useQueue.ts`, `AdeRepoView.vue` and the same fixtures. One sequential implementer. | §2 |
| Extend `kind`, or add a field | **New field `workType`, beside `kind`.** `kind` (`mine`/`review`/`parked`/`dependency`) stays the structural field: merge order, read-only rules, drag, conflicts, blockable. ~30 sites switch on it (`useQueue.ts` alone: `rg -n "'review'"` gives 17). Folding two new values into it means touching every one. `parked` is orthogonal too: a parked item keeps its work type. | §3.1 |
| Work-type values and labels | `work` "Mine: to work", `investigate` "Mine: to investigate", `review` "To review", `test` "To test". One `WORK_TYPE_LABEL` table in new `ade/workType.ts`. | §4.3 |
| How `workType` maps onto `kind` | Invariant, enforced in the repo layer: `work`/`investigate` pair with `kind` `mine` or `parked`; `review`/`test` pair with `kind` `review`. `to-test` is review-shaped: someone else's branch you verify, read-only here, never a merge lead. | §3.3 |
| Default when a branch is pulled in | **Unchanged rule**, `resolveKind` (`queue.go:420-428`): author email matches `user.email` gives `mine`/`work`, else `review`/`review`. The user's "pulling a branch in creates a review item" is exactly this rule's someone-else's-branch case. Design §2.1 (`design/SPEC.md:75`) keeps "Mine → mine". **Defaulted decision:** if the user meant "always review", change one line in `resolveKind`; flagged in the report. | §3.4 |
| New work (branch-less drafts) | Offers `work`/`investigate` only; default `work`. A draft is structurally `mine` (`useQueue.ts:627`), is the only thing `reconcileNewWork` binds onto Claude's own new branch, and has no owner to review. `review`/`test` need a pulled branch. | §3.3 |
| Rebind (draft becomes a branch) | Keeps today's kind (`resolveKind` in `bindNewWorkLocked`, `queue.go:1124`). Work type: the draft's own when the resolved kind is `mine`, else `review`. `Rebind` keeps its signature. | §3.3 |
| Write path | **New `AdeService.SetWorkType`**, not a `SetBranchMeta` field. It spans two tables (branch or new work) and derives `kind`. `SetBranchMeta`'s documented rule "never turns a branch back into review" (`bridge/ade.go:996-1014`, `model/adequeue.go:7-9`) stays true for that method. | §3.5 |
| `parked` | Not a dropdown option (the user named four). No UI sets `parked` today (`rg "'parked'"` in `ade/`: readers only). A parked item keeps its work type. Picking `review`/`test` on a parked branch sets `kind` `review` (it rejoins the queue as review). `SetBranchMeta` `kind` `mine`/`parked` on a `review`/`test` row resets its work type to `work`, so the invariant holds. | §3.3 |
| Blockers vs review | `checkBlockable` (`repos/adequeue.go:237-266`) never lets a review branch be blocked. Switching an item with live blocker links to `review`/`test` is refused (`ErrWorkTypeBlocked`, `E_INVALID`). The dropdown disables those two options while `panel.blockers` is non-empty. No silent unlinking. | §3.3, §4.3 |
| What is persisted, where | `ade_branches.work_type`, `ade_new_work.work_type`, migration `0007`, backfilled from `kind`. Go model, `BranchFact`/`NewWorkFact`, bridge wire, `wire.ts`, `QueueItem`/`QueuePanel`. | §3, §4 |
| Which kinds count as "my work" | **All four work types.** `work`/`investigate`: mine. `review`: the row's own definition. `test`: an assigned verification task, same footing as review. Branch-less drafts: yes. **Not my work:** `parked` (out of the merge order, design `SPEC.md:127`) and dependencies (a wait, not work). A dependency still shows when it blocks a shown stack (§0 next row). So the cap reads the stored `kind`/`workType` pair only to exclude `parked`; the dropdown never moves an item out of "my work" except through `parked`. | §5.1 |
| Dependency nodes | Shown iff some member of a shown stack lists it in `blockers` (`QueueItem.blockers`, `useQueue.ts:137`). Otherwise hidden with the rest. A blocked item's own chip is on its own cell, so it never loses the link. | §5.1 |
| Unit of the cap | **Stacks** (`QueueView.stacks`), per the row. A stack with several members or several day segments counts once. | §5.1 |
| Ordering rule | Grounded in `buildMergeOrder`'s own `seq` (`useQueue.ts:1044-1091`: mine segments sorted `end`, `day`, `pos`; review-only segments placed with their conflict partner or at Later). Key per qualifying stack: (1) all members merged last; (2) earliest segment `day` ascending, so overdue past days first, `LATER` (9999) last; (3) index of its first segment in `view.segments` (`seq` order). Top 5 win. | §5.1 |
| Merged work | Ranks after unmerged work, still counts. A merged-but-unarchived stack on a past day would otherwise take a top slot ahead of live work. It still shows once expanded, with its purple Archive action. | §5.1 |
| Hiding layer | **UI level.** `useQueue` still computes stacks, segments, hours, overflow and overdue over every item. `AdeTimeline` filters only the rendered blocks and continuation rows. Band hours, capacity strip, overflow and overdue strips read the unfiltered view, so they are identical collapsed or expanded. Filtering `stacks` first would drop hidden items from `buildHoursOn` and `overflowOf`, and shift `mergeN` numbers. | §5.3 |
| A band whose work is all hidden | Keeps its hours, overflow and overdue text; no placeholder row. The toggle's count says work is hidden. | §5.3 |
| Toggle | New `AdeMyWorkToggle.vue` in `AdeRepoView`'s sticky header, right under `AdeMainLine`. Rendered only when collapsed-state hiding hides something. Collapsed: `Top 5 of my work · Show N more`. Expanded: `Show top 5 only`. shadcn `Button variant="link" size="sm"`. | §5.5 |
| Toggle state | `showAllWork = ref(false)` local to `AdeRepoView`, beside `historyOpen` (`AdeRepoView.vue:74`). `AdeView` keys that view by repo, so a tab switch (or the All agents tab) remounts and resets it. Runtime only, never persisted: `historyReach`'s own precedent. Not Pinia: no other component reads it. | §5.4 |
| A hidden item becomes selected | Auto-expand, once per selected id. Sources: Add popover (`AdeAddPopover.vue:110-115` selects the new id), All agents Open (`AdeAllAgentsView.vue:109-112`), dependency add. A later "Show top 5 only" stays collapsed. Only explicit selections count (`adeUiStore.selectedByRepo`), never `useQueue`'s own first-item fallback (`useQueue.ts:2405-2408`). | §5.4 |
| Visible effect of a work type | Dropdown value. Plus, for `test` only: status chip `test` in place of `review` (`workStatus`, `useQueue.ts:1168-1172`) and panel mono `<owner> · test` (`buildPanelMono`, `:2095-2096`), since both kinds are otherwise identical. No other look changes; the design's row rules stay (`design/SPEC.md:333`). | §4.2 |
| `historyOpen`/`historyReach` | Untouched. History entries are not stacks; the cap never filters them. | §5.3 |
| Drag and drop | Hidden rows are not rendered, so not draggable. `dropVerdict` still reads the full view. A drop onto a band appends after hidden items in that day's plan order; that is today's append rule. | §5.3 |
| All agents view | No cap. It calls `useQueue` for row facts only (`AdeAllAgentsView.vue:70-80`); the row scopes the cap to the repo timeline. | §5 |

## 1. Confirmed current state

- **Kind model.** `ItemKind = 'mine' | 'review' | 'parked' | 'dependency'` (`useQueue.ts:30`).
  `QueueItem` `:108-145`, `QueueStack` `:152-158` (not exported; reach it as
  `QueueView['stacks'][number]`), `QueueSpan` `:216-224`, `QueuePanel` `:310-366`, `QueueView`
  `:378-407`. `buildItems` `:592-683`: branches take `b.kind`; new work is hardcoded `'mine'`
  (`:627`); dependencies `'dependency'`.
- **Pipeline.** `buildStacks` `:805-850` (merging roots, then parked and dependency singletons);
  `computeEffDay` `:856-890`; `buildSegments` `:1012-1042`; `buildMergeOrder` `:1044-1091`;
  `spansForDay` `:1702-1727` (span carries `lead`, no stack root); `buildBands` `:1763`;
  `workStatus` `:1159`; `buildPanelMono` `:2078`; `buildPanel` `:2251` (`readOnly = kind ===
  'review'` `:2301`); `useQueue` `:2358-2656`.
- **Timeline.** `AdeRepoView.vue` builds `view` (`:244-263`), owns `historyOpen`/`historyReach`
  (`:74-75`), renders `AdeTimeline` (`:447-469`). `AdeTimeline.vue` groups `view.segments` by day
  (`blocksByDay` `:53-61`) and passes `blocks` to `AdeDayBand`; `AdeDayBand.vue` renders
  `AdeStackBlock` per block and `AdeContinuationRow` per `band.spans` (`:180-196`). Rows:
  `[data-testid="ade-stack-row"][data-ade-id]` (`AdeStackRow.vue:73-75`).
- **Kind writes (Go).** Constants and `ValidAdeBranchKind` `model/adequeue.go:8-25`; `AdeBranch`
  `:31-47`; `AdeNewWork` `:67-81`; `AdeBranchMetaPatch` (kind mine/parked only). Repo:
  columns `repos/adequeue.go:34-35`, scanners `:59-95`, `AddBranch` `:352`, `AddNewWork` `:388`,
  `SetBranchMeta` `:513`, `Rebind` `:700-751`, `checkBlockable` `:237`. Queue: `BranchFact`
  `queue.go:100-121`, `NewWorkFact` `:123-128`, `resolveKind` `:420-428`,
  `computeOneBranchFact` `:726-732`, `buildNewWorkFacts` `:886`, `bindNewWorkLocked` `:1123-1133`,
  `AddBranch` `:1234-1263`, `SetBranchMeta` `:1295`. Bridge: `AdeBranchWire` `bridge/ade.go:404`,
  `AdeNewWorkWire` `:438`, `toWireAdeBranch` `:579`, `toWireAdeNewWork` `:592`, `adeQueueError`
  `:825`, `AdeBranchMetaPatchArgs.validate` `:1007-1037`. `AdeService` has 24 members.
- **Migrations.** `0005` defines `ade_branches.kind CHECK (kind IN ('mine','review','parked'))`.
  `0006` is the latest. Registered in `storage/migrations/embed.go`'s ordered `names` list.
- **Details tab.** `AdeDetailsTab.vue` grid (`:190-216`): Name, Branch, Jira, PR rows. Review
  items hide the name input and estimate (`panel.readOnly`). Base picker already uses shadcn
  `NativeSelect` (`AdeLinkRow.vue:5,123-130`).
- **Mock runtime.** One fixed response per channel/args (`packages/workbench/src/testing/ui/
  mockRuntime.ts:20-30`), no sequencing. Fixture files with `newWork:` literals:
  `tests/ui/ade-{all-agents,dialogs,module,panel,timeline}.spec.ts`,
  `tests/unit/ade-{dialog-flow,dialog-rules,queue-rules}.spec.ts`,
  `tests/unit/support/mockupToWire.ts` (all under `apps/kira-space/`).

## 2. Split

None. One sequential implementer, commits in §8 order.

---

## 3. Work type: storage and Go

### 3.1 Migration `0007`

New `apps/kira-space/internal/storage/migrations/0007_p136_ade_work_type.sql`:

```sql
-- P136: user-chosen work type. kind stays the structural field (merge order, read-only).
ALTER TABLE ade_branches ADD COLUMN work_type TEXT NOT NULL DEFAULT 'work'
  CHECK (work_type IN ('work', 'investigate', 'review', 'test'));
UPDATE ade_branches SET work_type = 'review' WHERE kind = 'review';
ALTER TABLE ade_new_work ADD COLUMN work_type TEXT NOT NULL DEFAULT 'work'
  CHECK (work_type IN ('work', 'investigate'));
```

Existing data: `mine`/`parked` branches and all new work become `work`; `review` branches become
`review`. Archived rows migrate the same way. `embed.go`: append
`{Version: 7, Name: "p136_ade_work_type", File: "0007_p136_ade_work_type.sql"}`.

### 3.2 Model

`apps/kira-space/internal/storage/model/adequeue.go`:

- Constants `AdeWorkTypeWork/Investigate/Review/Test`.
- `ValidAdeWorkType(v string) bool`; `ValidAdeNewWorkType(v string) bool` (work, investigate).
- `DefaultAdeWorkType(kind string) string`: `review` for `review`, else `work`.
- `AdeWorkTypeFitsKind(workType, kind string) bool`: the §0 invariant.
- `AdeBranch.WorkType string \`json:"workType"\``; `Validate` checks `ValidAdeWorkType` and
  `AdeWorkTypeFitsKind`.
- `AdeNewWork.WorkType`; `Validate` checks `ValidAdeNewWorkType`.
- Update the kind-constant comment (`:7-9`): `SetWorkType` is the one path into `review` after add.

### 3.3 Repo

`apps/kira-space/internal/storage/repos/adequeue.go`:

- Sentinels beside `ErrNotBlockable`: `ErrWorkTypeBlocked` ("repos: unlink its dependencies
  before marking it review or test") and `ErrWorkTypeInvalid` ("repos: new work can only be to
  work or to investigate").
- `adeBranchColumns`/`adeNewWorkColumns` gain `work_type`; both scanners read it.
- `AddBranch` insert (`:369-373`) writes `b.WorkType`. `AddNewWork` insert (`:403`) writes
  `w.WorkType`.
- `Rebind` (`:700`): after reading `w`, `workType := w.WorkType` when `kind == mine`, else
  `model.DefaultAdeWorkType(kind)`; insert it.
- `SetBranchMeta` (`:513`): when `patch.Kind` is set, also
  `work_type = CASE WHEN work_type IN ('review','test') THEN 'work' ELSE work_type END`.
- New `SetWorkType(codeRepoID, item, workType string) error`, one transaction:
  - `nw:` item: `ValidAdeNewWorkType` else `ErrWorkTypeInvalid`; `UPDATE ade_new_work SET
    work_type = ? WHERE code_repo_id = ? AND id = ? AND archived_at IS NULL`;
    `sqlitex.RequireOneRow`.
  - Branch: read `kind` where `archived_at IS NULL` (no row: not-found error, same wording as
    `RequireOneRow`). New kind: `review` for `review`/`test`; for `work`/`investigate`, `parked`
    stays `parked`, anything else becomes `mine`. When the new kind is `review` and the old is
    not, `SELECT 1 FROM ade_blockers WHERE code_repo_id = ? AND item = ? LIMIT 1` found gives
    `ErrWorkTypeBlocked`. Then `UPDATE ade_branches SET kind = ?, work_type = ?`.

### 3.4 Queue

`apps/kira-space/internal/ade/queue.go`:

- `BranchFact.WorkType`, `NewWorkFact.WorkType`; set in `computeOneBranchFact` (`:728-732`) and
  `buildNewWorkFacts` (`:892-894`).
- `AddBranch` (`:1256-1257`): `WorkType: model.DefaultAdeWorkType(kind)`.
- `AddNewWork`: `WorkType: model.AdeWorkTypeWork`.
- New `SetWorkType(codeRepoID, item, workType string) error`: store call, then `notifyChanged`.
  No `openRepo`, no git: the shape of `SetBranchMeta` (`:1295-1301`).
- `resolveKind` unchanged (§0 defaulted decision).

### 3.5 Bridge

`apps/kira-space/internal/bridge/ade.go`:

- `AdeBranchWire.WorkType`, `AdeNewWorkWire.WorkType` (`json:"workType"`), mapped in
  `toWireAdeBranch`/`toWireAdeNewWork`.
- `AdeSetWorkTypeArgs{CodeRepoID, Item, WorkType string}`; `Validate`: repo id required,
  `validateAdeWorkItemID(Item, "item")` (refuses `dep:`), `model.ValidAdeWorkType`.
- `func (s *AdeService) SetWorkType(args AdeSetWorkTypeArgs) error`, placed after
  `SetBranchMeta`. Members: 24 before, 25 after.
- `adeQueueError` (`:825-831`): add `ErrWorkTypeBlocked`, `ErrWorkTypeInvalid` to the `E_INVALID`
  group.
- Update `AdeBranchMetaPatchArgs`'s comment (`:996-997`) to name `SetWorkType` as the review path.

Bindings regenerate through `sh scripts/setup.sh` (gitignored).

## 4. Work type: frontend

### 4.1 Wire, bridge, mutation

- `ade/wire.ts`: `export type AdeWorkType = 'work' | 'investigate' | 'review' | 'test'`;
  `AdeBranch.workType: AdeWorkType` (`:64`); `AdeNewWork.workType: AdeWorkType` (`:99`);
  `AdeSetWorkTypeArgs`.
- `bridge/index.ts`: `adeSetWorkType` beside `adeSetBranchMeta` (`:256-257`).
- `ade/mutations.ts`: `useAdeSetWorkType(codeRepoId)`, shaped like `useAdeSetBranchMeta`
  (`:125-136`), invalidating the repo snapshot.
- `tests/ui/support/ipcChannels.ts` `adeSetWorkType: 'kira:ade:setWorkType'`;
  `tests/ui/support/mockRuntime.ts` `adeSetWorkType: 'AdeService.SetWorkType'`.
- Fixtures: every helper that builds an `AdeBranch`/`AdeNewWork` gains `workType` (branch default
  `kind === 'review' ? 'review' : 'work'`, new work `'work'`). Typecheck finds each one.

### 4.2 `useQueue.ts`

- `Item.workType: AdeWorkType`; `buildItems`: `b.workType`, `w.workType`, dependency `'work'`
  (never read for a dependency).
- `QueueItem` gains `workType: AdeWorkType` and `merged: boolean` (`myWorkCap` needs both).
- `QueuePanel` gains `workType: AdeWorkType`; set in `buildPanel`. `buildDependencyPanel` sets
  `'work'` (the dropdown never renders for a dependency).
- `workStatus` (`:1168-1172`): non-conflict review label is `item.workType === 'test' ? 'test' :
  'review'`.
- `buildPanelMono` (`:2095-2096`): `${item.owner} · ${item.workType === 'test' ? 'test' :
  'review'}`.
- `QueueSpan.stackRoot: string`, set in `spansForDay` from `g.stackRoot` (§5.2).

No other kind site changes: `kind` keeps every structural meaning.

### 4.3 Dropdown

- New `ade/workType.ts`: `WORK_TYPE_LABEL: Record<AdeWorkType, string>`;
  `workTypeOptions(panel: Pick<QueuePanel, 'isNewWork' | 'blockers'>)` returning
  `{ value, label, disabled, tip }[]`: two options for new work, four for a branch;
  `review`/`test` disabled with tip `Unlink its dependencies first` while `blockers.length > 0`.
- New `ade/AdeWorkTypeField.vue` (`<script setup lang="ts">`, Tailwind classes): a label `Kind`
  plus shadcn `NativeSelect` (`id="ade-work-type"`, `data-testid="ade-work-type"`), options from
  `workTypeOptions`. On change: `useAdeSetWorkType().mutateAsync({ codeRepoId, item: panel.id,
  workType })`. On error: inline red text (`text-kira-sm text-[#f28b7d]`, the `meta.errors`
  style) and the select re-renders the stored `panel.workType`.
- `AdeDetailsTab.vue`: render `AdeWorkTypeField` as the grid row right after Name (`:190-204`).
  Rendered for every item, `readOnly` included: a review item's kind is the one thing besides notes
  the user may change. `AdeDetailPanel` routes dependencies to `AdeDependencyDetails`, so no
  dependency guard is needed here.
- Library check: `NativeSelect` is the shadcn-vue primitive this module already uses for a choice
  list. A dropdown-menu would add a trigger-button pattern for no gain.

## 5. Top-5 cap

### 5.1 `ade/myWorkCap.ts` (new, pure)

```ts
export const MY_WORK_LIMIT = 5;
export interface MyWorkCap {
  visibleRoots: ReadonlySet<string>; // stack roots shown while collapsed
  visibleItems: ReadonlySet<string>; // member ids of those stacks
  hiddenCount: number;               // stacks hidden while collapsed
}
export function myWorkCap(view: Pick<QueueView, 'stacks' | 'segments' | 'items'>): MyWorkCap;
```

1. `first[root]` = earliest segment `day`, and index of first segment in `view.segments`.
2. Qualifying stacks: `!parked && !dependency`.
3. Sort qualifying by (all members `merged` ? 1 : 0, earliest day, first index). Take 5.
4. Add every dependency stack whose root appears in some visible member's `blockers`.
5. `visibleItems` = members of visible stacks. `hiddenCount = stacks.length - visibleRoots.size`.

Always computed as the collapsed state; `showAllWork` decides whether it applies (§5.3).

### 5.2 Continuation rows carry their stack

`spansForDay` sets `stackRoot: g.stackRoot`. Needed to hide a hidden stack's day-2+ rows.

### 5.3 Rendering

- `AdeTimeline.vue`: new prop `visibleRoots: ReadonlySet<string> | null` (`null` shows all).
  `blocksByDay` skips a segment whose `stackRoot` is not in the set. New per-band `spansFor(band)`
  filters `band.spans` the same way, passed to `AdeDayBand` as a new `spans` prop.
- `AdeDayBand.vue`: render `spans` (the prop) in place of `band.spans`. Nothing else changes:
  `band.hours`, capacity, overflow, overdue and `isEmpty` stay from the full view.
- `useQueue` input and every computed band fact stay unchanged. Hiding is presentation only.

### 5.4 `AdeRepoView.vue`

- `const showAllWork = ref(false);` beside `historyOpen`, same comment style (keyed remount
  resets it).
- `const cap = computed(() => (view.value ? myWorkCap(view.value) : null));`
- `:visible-roots="showAllWork || !cap ? null : cap.visibleRoots"` on `AdeTimeline`.
- Reveal rule: a `watch` on the explicitly selected id's hidden state:
  ```ts
  const hiddenSelection = computed(() => {
    const id = adeUiStore.selectedByRepo[props.codeRepoId];
    const c = cap.value;
    if (!id || !c || !view.value?.items.some((i) => i.id === id)) return null;
    return c.visibleItems.has(id) ? null : id;
  });
  let revealedFor: string | null = null;
  watch(hiddenSelection, (id) => {
    if (id && id !== revealedFor) { revealedFor = id; showAllWork.value = true; }
  }, { immediate: true });
  ```
  Waiting for the id to exist in `view.items` covers the Add popover's select-before-refetch
  order. `revealedFor` lets a later collapse stick.

### 5.5 `ade/AdeMyWorkToggle.vue` (new)

Props `hiddenCount: number`, `expanded: boolean`; emits `toggle`. One row, Tailwind classes,
`data-testid="ade-my-work-toggle"`; muted text plus `Button variant="link" size="sm"`
`data-testid="ade-show-more"`. Text per §0. `AdeRepoView` renders it in the sticky header after
`AdeMainLine` when `cap && cap.hiddenCount > 0`. The header's live height already feeds
`scrollToDay` (`useElementSize`, `AdeRepoView.vue:81`), so no scroll math changes.

## 6. Tests

`CLAUDE.md`'s unit-test bar: only the ranking earns a unit test (qualification, merged-last, day,
seq order, multi-segment stacks, dependency follow). The Go work-type test is a cross-table
invariant over add, rebind, meta and blockers, the same justification P135 used. Nothing else.

- **Unit** `apps/kira-space/tests/unit/ade-queue-rules.spec.ts`, new `describe('my work cap')`,
  views built through `useQueue` from the file's own snapshot helper: 7 mine stacks on days 0-6
  keep days 0-4; an overdue (past) stack ranks first; an all-merged stack ranks after a Later one;
  a two-segment stack counts once, ranked by its earliest day; a review root with a mine kid and a
  dated draft qualify; parked hidden; a dependency blocking a visible stack visible, one blocking
  only a hidden stack hidden, an unlinked one hidden; `hiddenCount` right; 3 mine stacks only give
  `hiddenCount` 0.
- **Go** `apps/kira-space/internal/ade/queue_test.go`, `TestQueue_WorkType_FollowsKind` on
  `newQueueHarness` (`:107`): another author's branch adds as `review`/`review`; `SetWorkType`
  `test` keeps `kind` review; `investigate` gives `mine`; `review` again with a linked dependency
  fails `ErrWorkTypeBlocked`; new work `review` fails `ErrWorkTypeInvalid`; new work
  `investigate`, bound through `BindNewWork`, lands `mine`/`investigate`; `SetBranchMeta`
  `kind: parked` keeps `investigate`; an archived item is refused.
- **UI** `apps/kira-space/tests/ui/ade-timeline.spec.ts`:
  - `my work cap: 5 of 7 stacks, earliest first; show more reveals the rest; hours unchanged; a
    tab switch resets`. 7 mine stacks on days 0-6, one parked, one unlinked dependency, one
    dependency blocking the day-1 stack. Collapsed: exactly the day 0-4 rows
    (`ade-stack-row[data-ade-id]`), the linked dependency, no parked, no unlinked dependency;
    toggle text `Show 4 more`. Day 5's band `sub` text (`3h` from its hidden item's estimate)
    is the same before and after expanding. Expand: all rows, text `Show top 5 only`. Switch to
    the All agents tab and back: collapsed again.
  - `my work cap: a review item and a branch-less draft count as my work`. Dated draft, review
    root with a mine kid, 3 more mine stacks, 1 later mine stack: draft and review rows visible,
    the later stack hidden.
  - `my work cap: selecting a hidden item reveals the list`. Existing branch tab picks a
    candidate; the mocked `adeAddBranch` returns the id of a hidden Later stack already in the
    snapshot (the mock has no response sequencing, §1). The list expands. `Show top 5 only` then
    stays collapsed.
- **UI** `apps/kira-space/tests/ui/ade-panel.spec.ts`:
  - `work type: a branch lists four kinds; To test writes SetWorkType; a stored test item reads
    back`. Pick `To test`: the log holds `adeSetWorkType {codeRepoId, item, workType: 'test'}`.
    A fixture with `kind: 'review', workType: 'test'` shows the select at `test`, status `test`,
    mono `<owner> · test`, no name input, select enabled.
  - `work type: a draft offers two kinds; review and test disabled while blocked; a refused write
    shows the error`. New work: 2 options. A branch with a blocker: `review`/`test` options
    disabled. `adeSetWorkType` mocked `E_INVALID`: inline error, select back at the stored value.
- **Existing scenarios.** After the cap lands, any existing scenario seeding more than 5
  qualifying stacks loses rows. Fix each by expanding first (a `showAllWork(page)` helper,
  in `tests/ui/support/ade.ts` if two or more files need it), never by weakening an assertion.
  Parity specs (`ade-queue-parity`, `ade-timeline-parity`, `ade-all-agents-parity`): if one
  deep-compares `QueueItem`/`QueueSpan`, extend its projection for `workType`/`merged`/
  `stackRoot`, never the mockup expectation.

## 7. File ownership (one implementer)

Go: `storage/migrations/0007_p136_ade_work_type.sql` (new), `storage/migrations/embed.go`,
`storage/model/adequeue.go`, `storage/repos/adequeue.go`, `ade/queue.go`, `ade/queue_test.go`,
`bridge/ade.go`. Frontend (`apps/kira-space/frontend/src/`): `ade/wire.ts`, `bridge/index.ts`,
`ade/mutations.ts`, `ade/useQueue.ts`, `ade/workType.ts` (new), `ade/AdeWorkTypeField.vue` (new),
`ade/AdeDetailsTab.vue`, `ade/myWorkCap.ts` (new), `ade/AdeMyWorkToggle.vue` (new),
`ade/AdeTimeline.vue`, `ade/AdeDayBand.vue`, `ade/AdeRepoView.vue`. Tests: the §1 fixture files,
`tests/ui/support/{ipcChannels,mockRuntime}.ts`, optional `tests/ui/support/ade.ts`. Docs:
`docs/ARCHITECTURE.md`, `docs/v2.0/SPEC.md`.

## 8. Steps and commits

Each commit passes the pre-commit hook without `--no-verify`, and ends with the session's
attribution lines.

1. `feat(ade): work type storage (migration 0007, model, repo SetWorkType, rebind carry)`
2. `feat(ade): SetWorkType on AdeService and workType in the snapshot` (queue facts, bridge wire,
   `wire.ts`, `bridge/index.ts`, mutation, IPC mocks, fixtures)
3. `test(ade): work type follows kind across add, rebind, meta and blockers`
4. `feat(ade): work type dropdown in the details panel` (`useQueue` fields and `test` labels,
   `workType.ts`, `AdeWorkTypeField.vue`, `AdeDetailsTab.vue`)
5. `feat(ade): timeline shows the top 5 my-work stacks behind a show-more toggle`
   (`myWorkCap.ts`, `QueueSpan.stackRoot`, `AdeTimeline`/`AdeDayBand`/`AdeRepoView`,
   `AdeMyWorkToggle.vue`)
6. `test(ade): my work cap ranking rules`
7. `test(ade): ui coverage for P136` (§6 scenarios plus the existing-scenario expansions)
8. Follow-up `fix(…)` commits for whatever §9 finds, one per finding.
9. `docs: ARCHITECTURE records ade work type and the my-work cap (P136)`: the ade queue section
   (`docs/ARCHITECTURE.md:2223-2275`) gains `work_type` (migration `0007`), the kind invariant,
   `SetWorkType`, and the UI-level cap with its ordering rule.
10. `docs(v2.0): P136 result`: result section under the SPEC row, with §10's audit.

## 9. Verification

Fast checks per commit: `bun run typecheck`, `bun run lint`, `bun run build:space`,
`go build ./...`, and after Go commits
`go test ./apps/kira-space/internal/ade/... ./apps/kira-space/internal/bridge/... ./apps/kira-space/internal/storage/...`.

Migration backfill, once (not committed): build a scratch DB with `sqlite3`, apply `0001`-`0006`
in order, insert a `code_repos` row, one `mine` and one `review` branch and one new-work row, apply
`0007`, and read back `work_type` (`work`, `review`, `work`). Without the `sqlite3` CLI, a scratch
`go run` in the scratchpad against `sqlitex` does the same.

End of phase, in full:

- `bun run test:ui:space`
- `bun run test:unit`
- `bun run typecheck`
- `bun run lint:all` (`lint`, `lint:go`, `lint:dead`)
- the `go test` line above

## 10. Closing audit

Report each row with its command and result in the result section.

| Check | Command | Expect |
|---|---|---|
| Migration registered | `rg -n '0007_p136_ade_work_type' apps/kira-space/internal/storage/migrations/embed.go` | 1 hit |
| Column read and written | `rg -n 'work_type' apps/kira-space/internal/storage/repos/adequeue.go` | columns, `Rebind`, `SetBranchMeta`, `SetWorkType` |
| New member has a caller | `rg -n 'adeSetWorkType' apps/kira-space/frontend/src` | `bridge/index.ts`, `mutations.ts`; `useAdeSetWorkType` used by `AdeWorkTypeField.vue` |
| Service size | `rg -c '^func \(s \*AdeService\) [A-Z]' apps/kira-space/internal/bridge/ade.go` | 25 |
| Dropdown uses shadcn | `rg -n 'NativeSelect' apps/kira-space/frontend/src/ade/AdeWorkTypeField.vue` | import plus use |
| Cap is UI-level | `rg -n 'myWorkCap\|visibleRoots' apps/kira-space/frontend/src/ade` | `myWorkCap.ts`, `AdeRepoView.vue`, `AdeTimeline.vue` only; none in `useQueue.ts` |
| History untouched | `git diff 96a3d644 -- apps/kira-space/frontend/src/ade/AdeHistoryPull.vue apps/kira-space/frontend/src/ade/AdeHistoryBar.vue apps/kira-space/frontend/src/ade/useHistoryPull.ts` | empty; `historyOpen`/`historyReach` lines in `AdeRepoView.vue` unchanged |
| Toggle not persisted | `rg -n 'showAllWork' apps/kira-space/frontend/src` | `AdeRepoView.vue` only (no store, no settings) |
| No scoped styles | `rg -n '<style' apps/kira-space/frontend/src/ade/AdeWorkTypeField.vue apps/kira-space/frontend/src/ade/AdeMyWorkToggle.vue` | empty |
| No new dependency | `git diff --stat 96a3d644 -- package.json bun.lock` | empty |
| Suites | §9 | all green |

## 11. What a Linux sandbox cannot verify

- **Native select popup.** Playwright drives Chromium; `selectOption` never opens the OS popup.
  The shipped app renders `<select>` in WebKitGTK (Linux) or WKWebView (macOS). Option-disabled
  styling and popup look are unverified here; state it in the result.
- **Live app on real repos.** `ImportRepo`'s git discovery is macOS-gated. The
  `docs/DEV_ENVIRONMENT.md` bypass from P129 Part 5 (direct DB row, `settings.Git.GitPath`, raw
  `/wails/runtime` calls) allows a live check; optional, report whether it ran.
- **Author-email default on a real clone.** Covered by the Go harness's real git repos, not by a
  real remote.

## 12. Risks

- **Existing UI scenarios.** Any fixture with more than 5 qualifying stacks changes. §6 says how
  to fix; count the affected scenarios in the result.
- **`useQueue` lint ceiling.** `buildPanel`/`workStatus` sit near the cognitive-complexity limit.
  Put the `test` label in one helper (`reviewLabel(item)`) used by both.
- **`knip`.** `MY_WORK_LIMIT` and `WORK_TYPE_LABEL` must have real importers or stay unexported.
- **SQLite `ADD COLUMN ... CHECK`.** Supported with a constant `DEFAULT`; the backfill check in §9
  confirms it on the bundled driver.
- **Reveal watch loops.** `revealedFor` guards one expansion per id; never write `showAllWork`
  from anything but the toggle and this watch.

## 13. Acceptance

| Requirement | Where met |
|---|---|
| "a repo with 6+ qualifying items shows exactly 5 plus a working show-more control" | §5.1, §5.5; §6 first timeline scenario |
| "day totals and capacity math are correct whether the toggle is open or closed" | §0 hiding layer, §5.3; §6 hours assertion |
| "`review` items and branch-less drafts are reachable through the same cap" | §0 classification, §5.1; §6 second timeline scenario |
| Ordering rule stated, grounded in `useQueue`'s day sort | §0, §5.1 (`seq` from `buildMergeOrder`) |
| Parked and dependency classification stated | §0, §5.1 |
| Toggle scoped per repo tab, runtime only | §5.4; §6 tab-switch reset |
| `historyOpen`/`historyReach` untouched | §0, §10 |
| Hiding layer verified and stated | §0, §5.3 |
| Kind dropdown with the four user kinds | §4.3; §6 panel scenarios |
| Default rule stays pulling-in gives review (someone else's branch) | §0, §3.4 |
| What is persisted, where, migration | §3.1-§3.5, §4.1; §9 backfill check |
| The cap reads the stored kind | §5.1 reads `QueueStack.parked`/`dependency`, from stored `kind` |
| Which kinds count as my work | §0 |
