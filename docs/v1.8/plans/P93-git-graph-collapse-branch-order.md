# P93 — git graph: collapse non-checked-out branches, branch-ordered commit layout

`docs/v1.8/SPEC.md`'s P93 row (`:167`), turned into concrete steps. Everything below was read in
the current tree (`claude/v1-8-p82-p83-implementation-ocpvj1` at `8c8d2133`, P71-P92 landed); every
line number is from that tree.

Two changes, one pipeline. Ordering lands first and collapse is defined on top of it — see §9 for
why that dependency is real, not stylistic.

No new dependency. No wire change, no Go change, no SQLite migration. One new `@kira/git-core`
module (`graph/rowPlan.ts`), one new `git-ui` state class, one `PersistedViewState` version bump
(7 -> 8).

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| How are non-checked-out groups sequenced? | **Tip committer date, descending** — `RefRow.committerDate` (`packages/git-ipc/src/contract.ts:271`), already in hand from `refs.list` for every ref. No extra git call, no wire change, stable across sessions. Ties break on kind then refname, so a rebuild never reshuffles | §3.2 |
| Is there a better "most-recently-active"? | **No.** Last-checkout time exists only in the reflog; nothing in this app records or requests it, and `git reflog` per branch is a spawn per branch on every refs change. Declined for cost, not for taste | §3.2 |
| Does branch-ordered layout survive the streamed/chunked load? | **Only by giving up incremental layout append.** Display order is a permutation of loaded rows and a new page inserts into the middle of it, so `LayoutStore.append`'s contiguity contract (`layoutStore.ts:172`) can never hold again. Every plan change re-lays-out the whole visible list in one pass | §5 |
| Does it survive the *host's* walk? | **Untouched.** `graph.stream` keeps emitting `--topo-order` rows in arrival order (`porcelain/log.go:28`, `gitsession/walk.go:249`). Ordering is a pure client-side projection over the rows already loaded | §5.1 |
| What breaks in the lane engine? | `lanes.ts`' stated invariant (`:5`-`:9`): a parent's row is always greater than its child's. Branch grouping puts a group's merge base *above* the group. Resolved by keeping every upward link out of the projected parent CSR and drawing it as a fork stub instead | §2, §6.2 |
| Nested divergence — a branch off a branch? | **Not nested.** A branch off B is reachable from its own tip, so it is its own group at its own priority. A group's collapsed range only ever contracts commits no other ref claims. No recursive collapse exists to design | §3.1, §4.3 |
| Collapsed row's visual | A real grid row: three stacked dots in the group's lane (a vertical ellipsis, built from the existing circle primitive), a muted italic message cell reading `47 more commits on feature/x`, blank author/date cells, a chevron affordance | §4.2, §6.1 |
| Where does expand/collapse state live? | **Split.** The per-group expanded set is session-only, in `GraphOrderState`; the collapse-by-default flag is persisted in `PersistedViewState` (v8). Reasons in place | §4.4 |
| One subagent or several? | **One sequential.** Ordering and collapse share the `RowPlan` module, the projection and the relayout path — splitting them splits one continuous piece of work | §9 |

Genuinely left out, named rather than half-built (`CLAUDE.md`'s "scope left out stays out"):

- **A per-group header row.** A group renders as its commits plus (when collapsed) one placeholder;
  there is no separate "feature/x" title row. Adding one means a second synthetic row kind, its own
  height, its own accessibility label and its own hit-testing — real scope, no part of the row.
- **Persisting which groups a user expanded.** §4.4 argues it out.
- **Ordering by anything the host would have to compute** (a merge-base walk, `rev-list --count`
  per branch, a per-branch reflog read). Every input this plan uses is already loaded.
- **`ReviewView.vue`.** It has its own commit list and never mounts `CommitGrid.vue` (the only
  mount is `App.vue:1605`). A ranged review walk is a single line of history; grouping it is
  meaningless.
- **The VS Code extension's own review diff**, `UncommittedChangesStrip.vue`'s own strip, and the
  graph column's width model (P92 item 1). None of them read row order.

---

# 1. The engine as it stands

Read these before changing anything; the design below turns on the exact shapes.

**Rows are one coordinate system, everywhere.** `CommitStore` row index == `LayoutStore` row index
== SlickGrid row index == `SelectionState.row` == `viewState.scrollRow`. `createCommitDataView`
(`components/columns.ts:363`) is the whole of it: `getLength` is `loadedRows()`, `getItem(row)` is
`store.commitAt(row)`, `getItemMetadata(row)` is `rowMetadata(deps, row)`.

**Arrival order is topological.** `logBaseArgs` (`internal/gitclient/porcelain/log.go:25`-`:30`)
passes `--topo-order`; `Walk.Stream` (`internal/gitsession/walk.go:249`) emits rows in that order in
`ChunkRows`-sized pieces (`gitrpc/graph.go:18`, 500); `PackedStreamState.applyChunk`
(`state/packedStream.ts:70`) appends them and throws on a gap.

**Lane layout is a forward pass that depends on that order.** `assignLanes`
(`packages/git-core/src/graph/lanes.ts:142`) claims "the leftmost lane already expecting this row"
(`:170`), converges every other lane expecting it (`:183`), then opens a lane per parent (`:212`,
`:241`). Its own doc comment states the precondition plainly (`:5`-`:9`): *"a commit's parents
always have a strictly larger row index than the commit itself (children before parents), so the
pass never needs to look behind itself."*

**Its input is the store's parent CSR.** `CommitStore.layoutInput(from, to)`
(`store/commitStore.ts:398`) hands over `parentOffsets`/`parentRows` as views over the whole store
(absolute row indices, `-1` for a parent not loaded yet) and drains
`#resolvedSinceLastLayoutInput`.

**Its output accumulates append-only.** `LayoutStore.append` (`graph/layoutStore.ts:171`) asserts
`chunk.from === this.#rowCount` — chunks must be contiguous and in order. `segmentsInRow`
(`:217`) answers per row from two disjoint scans: a CSR window over the `LONG_EDGE_ROWS` (64, `:60`)
rows above, and a binary-search-bounded scan of `#longEdges`, which is sorted by `fromRow` ascending
"true by construction, never re-sorted" (`:133`).

**Rendering is per row, pure.** `createGraphFormatter` (`graph/graphColumn.ts:82`) builds a
`RowSlice` (`graph/rowSvg.ts:45`) from `layout.laneOf/colorOf/segmentsInRow` plus
`store.decorationAt/parentsOf`, and `buildRowSvg` (`:372`) draws it. `edgeCommand` (`:126`) decides
a segment's shape from `row` vs. `fromRow`/`toRow`; `planNode` (`:240`) draws one of three shapes
(`palette.ts:30`'s `NodeKind`).

**Selection is already sha-authoritative.** `SelectionState` (`state/selection.ts:25`) holds `row`
*and* `sha`, and `selectBySha` (`:47`) exists precisely because "a re-walk renumbers every row".
`App.vue:276`-`:287` re-resolves on `generation`. This is the seam that makes a renumbering
tolerable; nothing in `App.vue` needs to change for it.

---

# 2. The invariant that breaks

Branch-ordered layout renders the checked-out branch's chain first, in full, then each other
branch's group. Take `main` checked out and `feature` forked from commit `M`:

- `M` is on `main`, so it renders inside group 0, above every other group.
- `feature`'s oldest own commit has `M` as its parent, and renders in a later group — *below* `M`.

So a parent sits above its child. That is not an artifact of one ordering rule; it is what branch
grouping *is*. Every candidate design has to answer it, and only three answers exist:

1. **Teach the lane pass to look behind itself.** Rejected. The pass's whole shape (open lanes
   expecting a future row, `pendingBySlot`, the frontier) is built on one-directional resumption,
   and `lanes.ts`' own doc comment records the last time someone made lane assignment depend on
   something other than row order — it broke the paged-equals-one-pass invariant.
2. **Store the link reversed (parent as `fromRow`, child as `toRow`) so the buffers stay sorted.**
   Works arithmetically and needs no `LayoutStore` change under a full relayout (§5), but the
   picture it produces is wrong: a lane opened at `M` stays open until the group's bottom row, so
   *every* branch contributes a full-height lane from its merge base down to its own block. On a
   repo with twenty branches that is twenty permanently-occupied lanes — past `GEOMETRY.maxLanes`
   (12) before the first screen, and the exact visual noise this phase exists to remove.
3. **Keep the upward link out of the lane pass entirely and draw it as a stub.** Chosen.

**The decision: an upward link is never a lane.** The projected parent CSR handed to `assignLanes`
contains only links that point *down* the display order. Every link that would point up is recorded
on the child entry as a *fork stub* and drawn as a short dashed run in the child's own lane, in the
parent's lane colour, ending at the row's top edge (§6.2). Consequences, stated rather than
discovered:

- `packages/git-core/src/graph/lanes.ts`, `edges.ts`, `colors.ts`, `types.ts` and
  `graph/layoutStore.ts` are **unchanged**. No new `EdgeKind`, no out-of-chunk edge, no re-sorted
  `#longEdges`. The whole of §2's problem is absorbed by the projection.
- Continuity *through a collapsed range* is preserved as a real lane, because those links point
  down (§4.3). Continuity *across a group boundary* is a stub, not a line. That is the honest
  trade: the connection stays visible and clickable, it is not drawn as thousands of rows of
  vertical line.

---

# 3. The row plan: grouping and ordering

New pure module, `packages/git-core/src/graph/rowPlan.ts` — beside `lanes.ts`/`layout.ts` because
it reads the store's parent CSR and produces a `LayoutInput`, and because it is exactly the kind of
interacting-rules logic `CLAUDE.md` says earns a unit test (§8.1). No Vue, no DOM.

## 3.1 Group assignment

A commit belongs to the **first tip, in priority order, that reaches it**. Equivalently, propagated
backwards:

```
priority(row) = min( tipPriority(sha(row)),  min over children c of row: priority(c) )
```

This is computable in arrival order and **final on arrival**, which is the property the whole design
rests on: under `--topo-order` every commit that can reach `X` is already loaded when `X` arrives,
so no later page can lower `X`'s priority. State that in the module's doc comment; it is the reason
a plan rebuilt after page 5 agrees with one rebuilt after page 1 about every row page 1 held.

Incremental form, run once per appended store range:

```
claimed: Int32Array over store rows, seeded UNCLAIMED
pendingBySha: Map<string, number>          // claims aimed at a not-yet-loaded parent
for row in [from, to) ascending:
  p = min(claimed[row], pendingBySha.take(sha(row)) ?? UNCLAIMED, tipPriority(sha(row)) ?? UNCLAIMED)
  claimed[row] = p
  for parentRow, parentSha of store.parentsOf(row):
    if parentRow === -1: pendingBySha.set(parentSha, min(existing, p))
    else: assert(parentRow > row); claimed[parentRow] = min(claimed[parentRow], p)
```

`store.parentsOf(row)` is an `Int32Array` of parent rows with `-1` for unresolved
(`commitStore.ts:154`); the parent *sha* for the `-1` case comes from the same place the store's own
`#pendingParents` reads it. The `assert(parentRow > row)` is the topo-order precondition made loud —
`LayoutStore.append`'s contiguity assert is the established precedent for this class of check.

A row nothing claims lands in a synthetic last group, `other`. Under scope `all` it should stay
empty; under scope `head`, or a stash-only walk, it is the total answer that keeps every loaded row
renderable.

## 3.2 Group order

Priorities, assigned once per refs change:

| Priority | Group | Source |
|---|---|---|
| 0 | checked-out branch | `head.kind === 'branch'` -> that `RefRow`; `detached` -> `head.sha`; `unborn` -> no group 0 |
| 1 | stash | present only when the walk carries stash rows |
| 2 … | local and remote branches, **interleaved**, `committerDate` descending | `RefsState.branches` + `.remoteBranches` |
| … | tags, `committerDate` descending | `RefsState.tags` (`peeledObjectId ?? objectId`) |
| last | `other` | nothing |

Why `committerDate` on the tip: it is the only "how recently was this branch worked on" datum the
app already has — `RefRow.committerDate` (`contract.ts:271`) comes back on every `refs.list` for
every ref, needs no extra spawn, and is the same number `git for-each-ref --sort=-committerdate`
sorts by, which is what "most recently active branch" means in git's own vocabulary. The obvious
alternative, last-checkout time, lives only in `HEAD`'s reflog: it is per-repo, not per-branch,
requires parsing `git reflog show HEAD` and re-parsing it on every refs change, and answers nothing
for a branch never checked out here. Declined on cost.

Why locals and remotes interleave rather than banding: a remote branch whose local twin exists
claims nothing (the local is higher priority and takes every commit first), so its group renders
empty and never appears. What remains in the remote band is genuine work with no local branch —
which belongs beside the local branches by recency, not behind all of them.

Why the stash sits at priority 1: a stash entry is a handful of rows about work happening now, and
today it renders inline near the top by date. Burying it behind two hundred remote branches would be
a regression this phase did not ask for.

Ties (equal `committerDate`) break on kind (local, remote, tag) then `refname` ascending. The plan is
rebuilt on every page, so a nondeterministic tiebreak would reshuffle rows mid-scroll.

## 3.3 Display order

Counting sort over `claimed`: count per priority, prefix-sum, scatter — `O(rows)`, stable in store
order inside each group, so **within a group the order is still topological** and every intra-group
parent link still points down.

---

# 4. Collapse

## 4.1 What collapses

A group is collapsed when all three hold: collapse is enabled (§4.4), the group is not group 0, and
its key is not in the expanded set. A collapsed group with `n` members renders as:

- `n <= MIN_COLLAPSIBLE` (3): every member, unchanged. Collapsing 3 rows into 3 rows (tip +
  placeholder + oldest) saves nothing and costs a click.
- otherwise: member 0 (the branch tip), one **placeholder** contracting members `1 … n-2`, and
  member `n-1` (the group's oldest own commit — the divergence point SPEC asks for; its parent is in
  an earlier group, which is exactly what makes it the fork).

Group 0 is never collapsed: SPEC's "only the checked-out branch's own direct-ancestor chain renders
fully expanded, commit by commit".

## 4.2 The placeholder as a grid row

It is an ordinary SlickGrid row, not an overlay:

- **Graph cell**: the group's own lane, drawn continuous through the row (the links either side of
  it are real, downward links — §4.3), with the node replaced by three small stacked dots in the
  lane colour. Expressed with the existing circle primitive: `NodeKind` gains `'collapsed'` and
  `planNode` returns three `NodeShapePlan`s at `cy - gap`, `cy`, `cy + gap`.
- **Message cell**: a chevron, then `47 more commits on feature/x`, in the muted italic the stash
  subject already uses. Class `kv-cell-message--collapsed`, `data-testid="graph-collapsed-row"`,
  `data-group-key`.
- **Author/date cells**: empty. A contracted range has no single author and no single date, and
  showing the newest hidden commit's would read as a fact about the row.
- **Height**: the compact height. A placeholder never carries badges.
- **Activation**: click anywhere on the row, or `Enter`/`Space` with it focused, expands the group.
  A collapsed row is never "selected" in `SelectionState`'s sense — there is no sha to select.
- **Accessibility**: `aria-expanded="false"` on the row, `aria-label` = the message text.
  `applyAccessibility` (`CommitGrid.vue:658`) reads `store.commitAt(row)` today for its label; it
  gets the plan-entry branch instead.

`getItem` must still answer a `CommitRecord` (SlickGrid's typed data view). It returns the record of
the placeholder's **first contracted store row** — the formatters never read it for a collapsed
entry (each asks the plan first), so it is a shape, not data on screen. Do not make `getItem`
nullable: three formatters, `getItemMetadata` and SlickGrid's own internals all dereference it.

## 4.3 Contraction, and why it is safe

The placeholder's projected links are the union of its contracted rows' parent links, mapped to
display rows and deduplicated:

- a link landing inside the same placeholder — dropped (internal);
- a link landing on a later display row — kept, in first-seen order;
- a link landing on an earlier display row — a fork stub (§2), not a lane.

Two facts make this bounded and clean. First, `priority(parent) <= priority(child)` by construction
(§3.1), so a link never points at a *later* group — every cross-group link is upward, i.e. a stub.
Second, a group's rows are contiguous in display order and the only same-group row after the
contracted range is the group's last member. So the common case is exactly one kept link plus a
stub, and the lane through the placeholder is continuous — SPEC's "without breaking the graph-line
continuity through it", satisfied by the contraction rather than by special-casing the renderer.

A branch off a branch is a separate group at its own priority (§3.1), never a nested collapse
inside another group's range. A group *can* still contain internal merges — a topic branch merged
into `feature` and then deleted leaves commits no ref claims but `feature`, and they sit in
`feature`'s group. They contract like any other member; their own upward links become stubs on the
placeholder. The renderer draws one stub per row (§6.2), so a placeholder with several does not turn
into a fan.

## 4.4 Where the state lives

**Per-group expanded set: session-only**, a `Set<string>` of group keys on `GraphOrderState`,
cleared on repo switch, pruned on every rebuild to keys that still match a group.

Not persisted, for three reasons: a group key is a ref name, and ref names churn, so a persisted set
silently accumulates entries for branches that no longer exist; a checkout re-partitions every group,
so yesterday's set describes a partition that no longer exists; and `state/viewState.ts`'s own v3
doc comment (`:12`-`:17`) already declines to persist exactly this class of state — "those are facts
about one commit at one moment, and restoring a stale one is §6.8's own argument".

**The collapse-by-default flag: persisted**, `PersistedViewState.collapseBranches: boolean`, default
`true`, version 7 -> **8**. It is a view preference of the same kind as `searchOpen`, `detailOpen`
and `fileListMode`, which all live there; the version bump follows the file's own documented policy
(a shape change discards the stale blob whole and re-seeds). One toolbar toggle drives it
(§7, `AppToolbar.vue`).

A repo setting (`kiraVersion.graph.*`, server-side) was the alternative: it costs a schema leaf, a
Go model field, a storage leaf, a dialog row and a wire round trip to express one boolean the panel
already persists four of. Declined.

---

# 5. The relayout pipeline

## 5.1 Why incremental append cannot survive

`LayoutStore.append` requires `chunk.from === rowCount` (`layoutStore.ts:172`). Under arrival order a
new page only ever appends. Under display order a page's rows scatter into existing groups and every
display row below the first insertion shifts. There is no contiguous range to append. This is not a
tunable — it is what "group-major order over a set that grows in a different order" means.

So: **every plan change re-lays-out the whole visible list, in one pass, in the worker.** Triggers:
a page landing, a collapse toggle, a refs/HEAD change, a repo switch, a refresh.

The host side is untouched by this. `graph.stream`, `graph.loadMore`, `graph.status`, `Walk.Stream`'s
caching and dictionary marks, `ChunkRows`, the packed codec: all unchanged. Ordering is a projection
over rows the client already holds, which is also why a plan change costs no git work at all.

## 5.2 The cost, honestly

`assignLanes` is a forward pass at roughly `O(rows x laneCount)` (`findExpectingLane` and step 2 each
scan the open lanes). At 100k loaded rows and a dozen lanes that is a few million simple operations —
single-digit milliseconds in the worker — plus `laneOf`/`colorOf` (2 x 4 bytes/row) and the edge
buffer (6 x 4 bytes/edge), so a few megabytes built and transferred per rebuild. A page is 5000 rows
by default, so rebuilds are occasional, not per-frame.

And the default view is far cheaper than that bound suggests: collapsed, the visible list is the
checked-out chain plus about three rows per branch, so the pass runs over a fraction of the loaded
rows. The expensive case is a user expanding everything, which is the case they asked for.

No measurement is planned here. `CLAUDE.md`'s rule is to measure when a real question is at stake;
the alternative to a full relayout is not slower, it is incorrect (§5.1), so a number would not
change the decision. If §10's manual pass finds a visible stall on a large repo, that is a finding
with its own follow-up, not a reason to pre-optimise now.

## 5.3 The rebuild, step by step

In `GraphViewState`, replacing the per-chunk `submit`/`append` pair at `state/graphView.ts:409`-`:422`:

```
1. plan = rowPlan.build(store, tips, expandedKeys, collapseEnabled)   // §3, §4 — main thread, O(rows)
2. input = projectLayoutInput(plan, store.layoutInput(0, store.rowCount))
3. layoutClient.reset(); chunk = await layoutClient.submit(input)
4. (a newer rebuild started meanwhile -> the promise rejects LayoutClientStaleError -> return)
5. layout.clear(); layout.append(chunk); laneCount = layout.laneCount
6. planRevision++      // what the grid invalidates on
```

Notes that are load-bearing:

- `store.layoutInput(0, rowCount)` is still the source of the base CSR **and** the thing that drains
  `#resolvedSinceLastLayoutInput` (`commitStore.ts:403`). Building the projection from a hand-rolled
  read of the store instead would leave that accumulator growing for the life of the session. The
  projection ignores `resolvedParentSlots` (a fresh pass has no earlier frontier to patch) and passes
  an empty one.
- `layoutClient.reset()` before each submit is what makes a superseded rebuild reject rather than
  land out of order; `LayoutClientStaleError` (`layoutClient.ts:123`) already exists for exactly
  this and must be caught at the call site rather than surfacing as an unhandled rejection.
- `clear()` and `append()` stay in one synchronous block, for the reason `#applyChunk`'s own comment
  gives (`graphView.ts:419`-`:421`): `laneCount` must never observably pass through 0.
- `onChunkLayout`'s `LayoutRange` subscribers (`:424`) now always see `{ from: 0, to: plan.length }`.
  `CommitGrid.vue`'s `handleChunkLayout` (`:605`) already calls `grid.invalidateRowHeights()` (P92
  item 4), which is the correct response to "every row may have moved".
- Viewport: a rebuild must not move the user. Capture the top visible **store** row before step 1
  (`getViewportTop` is already exposed, `CommitGrid.vue:1070`) and restore it after step 6 through
  the plan. `App.vue` already does this shape around auto-refresh; reuse it rather than inventing a
  second.

## 5.4 Identity plan

`RowPlan` has an identity form: one entry per store row, in store order, no groups, no placeholders,
`storeRowAt(d) === d`. It is what a caller with no tips yet gets (a repo whose `refs.list` has not
resolved), and it reproduces today's behaviour exactly. Every consumer in §7 is written against the
plan, so "no plan yet" and "collapse turned off" are the same code path, not a branch.

---

# 6. Rendering

## 6.1 The collapsed node

`graph/palette.ts:30` — `NodeKind` gains `'collapsed'`. `nodeKindFor` is untouched (it answers from
parent count and stash-ness); the collapsed kind is decided by `graphColumn.ts`'s `readSlice` from
the plan entry, before it ever calls `nodeKindFor`.

`graph/geometry.ts` — two constants beside `GEOMETRY`'s existing node radii:

```ts
/** P93: the collapsed-range row's own three stacked dots — a vertical ellipsis in the group's
 *  lane, small enough to read as "something is elided here" rather than as three commits. */
collapsedDotRadius: 1.8,
collapsedDotGap: 4.5,
```

`graph/rowSvg.ts:240`'s `planNode` gains the `'collapsed'` branch, returning three filled dots at
`cy - gap`, `cy`, `cy + gap`, before the existing stash/merge/ordinary branches. The HEAD ring/halo
arms do not apply (a placeholder is never HEAD).

## 6.2 The fork stub

`RowSlice` (`rowSvg.ts:45`) gains one field:

```ts
/** P93 §2: this row's own upward link — its parent sits ABOVE it, in an earlier branch group, so
 *  it is deliberately not a lane (a lane per branch from its merge base down to its block blows
 *  past GEOMETRY.maxLanes on any repo with a dozen branches). Drawn as a short dashed run in this
 *  row's own lane, in the PARENT's lane colour, ending at the row's top edge. `undefined` for
 *  every row whose parents are all below it, which is every row of the checked-out group. */
readonly forkStub: { readonly color: number } | undefined;
```

One stub per row, not one per upward link: the plan reports the *nearest* one (the largest display
row among the row's upward targets, i.e. the closest above), and a row with several is the rare
contracted-merge case of §4.3. A fan of overlapping stubs at one x would be noise, not information.

`planEdgePaths`' `EdgePathPlan` gains `readonly dashed?: boolean`; `buildPathElement`
(`rowSvg.ts:305`) sets `stroke-dasharray` from it, the same literal `planNode`'s dashed stash ring
already uses. A new `planForkStub(slice, nodeCenterY)` returns the stub's own plan — from
`-GEOMETRY.overdraw` down to `nodeCenterY` at `laneX(slice.lane)` — and `buildRowSvg` appends it with
the other paths, under the nodes.

Stub colour is the parent's lane colour so the line reads as "this comes from *that* branch";
`graphColumn.ts`'s `readSlice` reads it with `layout.colorOf(parentDisplayRow)`, which is valid
because the parent is above and every row was laid out in the same pass.

Clicking a stub scrolls to its parent row — `hitTest.ts`'s `laneAt` already answers "which lane was
clicked" and `CommitGrid.vue:395`'s `handleClick` already has the cell; the stub is in the row's own
lane, so the test is "this row has a stub and the click landed in its lane".

---

# 7. File by file

**`packages/git-core/src/graph/rowPlan.ts`** (new). The whole of §3 and §4.1/§4.3, pure:

```ts
export interface TipRef { readonly sha: string; readonly key: string; readonly label: string }
export interface RowPlanEntry {
  readonly kind: 'commit' | 'collapsed';
  readonly storeRow: number;        // a commit's row; a placeholder's FIRST contracted row
  readonly groupIndex: number;
  readonly hiddenCount: number;     // 0 for a commit
}
export interface RowPlan {
  readonly length: number;
  readonly revision: number;
  entryAt(displayRow: number): RowPlanEntry;
  storeRowAt(displayRow: number): number;
  displayRowOf(storeRow: number): number;   // -1 when hidden
  containingDisplayRow(storeRow: number): number;  // the placeholder hiding it, or its own row
  groupKeyAt(displayRow: number): string;
  forkParentOf(displayRow: number): number; // display row above, or -1
}
export function buildRowPlan(store, tips, options): RowPlan
export function projectLayoutInput(plan: RowPlan, base: LayoutInput): LayoutInput
export function identityRowPlan(rowCount: number): RowPlan
```

`buildRowPlan` keeps its `claimed` array and `pendingBySha` map across calls for the same store
generation (§3.1's incremental form); a `generation` argument resets them. `projectLayoutInput`
builds the display-coordinate CSR per §4.3 and records each entry's fork parent.

**`packages/git-core/src/index.ts`** — export the new names beside the existing `graph/*` ones.

**`packages/git-ui/src/state/graphOrder.ts`** (new). `GraphOrderState`: holds the tip list (fed by
`App.vue` from `RefsState`, mirroring how `SelectionState` takes a `CommitStore` and nothing else —
this class never imports `RefsState`), the session-only expanded set, the persisted
`collapseEnabled` flag, the current `RowPlan`, and a `revision` `ShallowRef`. Methods:
`setTips(tips)`, `toggleGroup(key)`, `setCollapseEnabled(on)`, `rebuild(store, generation)`,
`reset()`.

**`packages/git-ui/src/state/graphView.ts`** — takes a `GraphOrderState` (optional; absent means the
identity plan, §5.4). `#applyChunk`'s layout half (`:402`-`:424`) becomes §5.3's `#rebuildLayout`,
called after every chunk applies and whenever the order state's revision changes. `LayoutRange` stays
the same type and now always spans the whole plan.

**`packages/git-ui/src/state/viewState.ts`** — `PersistedViewState.version` 7 -> 8, one new
`collapseBranches: boolean`, the `isPersistedViewStateShape` check, and a v8 entry in the file's own
doc comment in the same voice as v5/v6/v7.

**`packages/git-ui/src/components/columns.ts`** — `CommitDataViewDeps` gains `plan: () => RowPlan`.
`getLength` is `plan().length`; `getItem`/`getItemMetadata` translate through `storeRowAt`.
`messageFormatter` renders the collapsed cell when `plan().entryAt(row).kind === 'collapsed'`;
`authorFormatter`/`dateFormatter` return an empty cell for it. `rowMetadata` adds
`kv-row-collapsed` and never asks for the expanded height on a placeholder.

**`packages/git-ui/src/graph/graphColumn.ts`** — `readSlice` takes the plan, resolves the store row,
returns `nodeKind: 'collapsed'` for a placeholder, and fills `forkStub` from
`plan.forkParentOf(row)` + `layout.colorOf(...)`.

**`packages/git-ui/src/graph/rowSvg.ts`**, **`geometry.ts`**, **`palette.ts`** — §6.

**`packages/git-ui/src/components/CommitGrid.vue`** — the translation sites, all of them:
`handleClick` (`:395`) and `handleContextMenu` (`:427`) convert before `selection.select`;
`moveSelection` (`:464`) walks display rows and skips placeholders for selection but stops on them
for focus; `handleKeyDown` (`:491`) adds `Enter`/`Space` on a placeholder; `applyAccessibility`
(`:658`) branches on entry kind; the `scroll` emit (`:827`) converts to a store row;
`scrollToRow` (`:1031`) converts from one, and **expands the containing group first** when the target
is hidden (`containingDisplayRow`) — a search hit must be reachable; the dataView (`:754`) and the
formatter get the plan accessor; a `planRevision` watcher calls `grid.invalidate()`.

**`packages/git-ui/src/components/AppToolbar.vue`** — one icon toggle,
`data-testid="graph-collapse-toggle"`, bound to `collapseBranches`, `aria-pressed`, tooltip
"Collapse other branches".

**`packages/git-ui/src/App.vue`** — construct `GraphOrderState`, feed it from `refsState.branches`/
`.remoteBranches`/`.tags`/`.head` and the stash state in a watcher, pass it to `GraphViewState` and
`CommitGrid`, thread `collapseBranches` through the persisted view state, and clear it on repo
switch beside the existing `graphView.reset()` (`:259`). Selection, search reveal, detail and the
context menus are untouched — they speak store rows, and `CommitGrid.vue` is where the conversion
lives.

---

# 8. Tests

## 8.1 Unit — `packages/git-core/src/graph/rowPlan.test.ts` (new)

This clears `CLAUDE.md`'s bar unambiguously: several interacting rules (priority propagation,
ordering, contraction, expansion), boundary arithmetic (display-vs-store index mapping), and an
incremental-arrival invariant that is invisible in the output of any one call. Cases:

- **Assignment is final on arrival.** Build a fixture DAG, feed it as one page and as three pages,
  assert identical `claimed` arrays — the paged-equals-one-pass property, the same shape
  `lanes.test.ts` already guards for lane assignment.
- **Priority propagation**: a commit reachable from both the checked-out branch and a feature branch
  lands in group 0; one reachable only from the feature branch does not; a commit no tip reaches
  lands in `other`.
- **Ordering**: group-major, store order within a group, ties broken deterministically; two
  rebuilds of the same input produce byte-identical order.
- **Contraction**: a collapsed group of `n > 3` yields `tip, placeholder, oldest`; `n <= 3` yields
  every row; the placeholder's projected links contain no internal link, no duplicate, and nothing
  pointing at an earlier display row.
- **Projection direction**: over a fixture with a branch forked from the middle of `main`, every
  entry in the projected CSR points strictly down, and the fork row reports the expected
  `forkParentOf`.
- **Expansion**: expanding a group restores its rows in order and leaves every other group alone.

## 8.2 Unit — existing files

`graph/rowSvg.test.ts` gains the two new plans (a `'collapsed'` node returns three circles at the
expected offsets; a stub's `d` runs from the row top to the node and carries `dashed`). Nothing else
changes: `layoutStore.test.ts` and `lanes.test.ts` guard modules this phase does not touch, and both
must stay green untouched — that is itself the evidence for §2's claim.

No unit test for the toolbar toggle, the persisted flag, or the translation sites: wiring, a
required-field check and one-line conversions, all below the bar.

## 8.3 Interaction — `apps/kira-studio-vscode/tests/interaction/graph-branch-order.spec.ts` (new)

The DOM-level home for the git-ui bundle, beside `graph-columns.spec.ts`. `fakeGraphHost.ts` needs a
multi-branch fixture: a packed history with a `main` chain, two feature branches forked from it at
different depths, and a `refs.list` answer carrying `isHead` and distinct `committerDate`s (it
already answers `refs.list` under `WITH_PICKER_DATA`, `:640`, and already builds `RefRow`s — extend
that fixture rather than adding a second mechanism).

- Rows render group-major: every `main` row precedes every `feature/*` row, and the two feature
  groups appear newest-tip-first.
- A collapsed group shows exactly three rows, the middle one `graph-collapsed-row`, with a count
  matching the fixture's hidden commits.
- Clicking it expands to the full member list in order; clicking again re-collapses.
- The toolbar toggle off renders every row expanded, in group order still.
- No row overlap and no horizontal scrollbar after a toggle (P92 items 2 and 4's assertions, re-run
  against a reordering — a plan change is exactly the "rows moved" case those two fixed).
- The fork row draws a dashed stub, and no lane is open across the gap between a group and its merge
  base (assert the drawn path count in an intervening row).

## 8.4 UI — `apps/kira-studio/tests/ui/repo-workspace.spec.ts`

Its `graphStreamFixture.ts`/`gitStreamMock.ts` already drive a real graph in the desktop app. Add:
the default view is collapsed; expanding survives a tab switch within the session; the persisted
`collapseBranches` survives a relaunch (v8's own round trip); a search reveal that lands inside a
collapsed group expands it and scrolls to the commit.

## 8.5 Go

None. Nothing on the host changes (§5.1).

---

# 9. Order of work

One sequential Sonnet subagent, per `CLAUDE.md`'s default. The two SPEC items are **not**
independent and must not be split across concurrent subagents: collapse is defined on a group's
contiguous block, which only exists once grouping and ordering exist; both live in the same
`rowPlan.ts` and both flow through the same projection and the same relayout path. Splitting them
would hand two agents the same new module.

The dependency runs one way, and SPEC asked for it to be checked rather than assumed: **ordering
first, collapse second**. Collapse contracts a range of consecutive rows belonging to one branch —
under today's timestamp interleaving no such range exists, so the collapse logic would have to be
written against a row sequence that does not yet exist and rewritten once it does. The reverse
dependency does not hold: ordering is complete and shippable on its own (commits 1-4 below leave a
working, fully-expanded, branch-ordered graph).

Size is real but bounded: eight commits, roughly 1200 lines of new/changed code, concentrated in one
new pure module plus translation sites in one component. It stays within one pass.

1. `feat(git-core): add the branch-grouped row plan` — §3, `rowPlan.ts` (ordering only; identity
   collapse), plus `rowPlan.test.ts`'s ordering and assignment cases.
2. `feat(git-core): project a display-ordered layout input` — §4.3's projection and fork-parent
   recording, plus its own tests.
3. `refactor(git-ui): lay the graph out over the row plan, not the store's rows` — §5.3's rebuild in
   `graphView.ts`/`graphOrder.ts`, identity plan only. The graph looks identical after this commit;
   that is the point.
4. `feat(git-ui): order the commit grid by branch` — the translation sites in `CommitGrid.vue`/
   `columns.ts`/`graphColumn.ts`, tips fed from `App.vue`. Branch-ordered, still fully expanded.
5. `feat(git-ui): draw a fork stub where a branch leaves an earlier group` — §6.2.
6. `feat(git-core): contract a collapsed branch group into one row` — §4.1/§4.3 in `rowPlan.ts`,
   plus the contraction tests.
7. `feat(git-ui): render and expand collapsed branch rows` — §4.2, §6.1, the keyboard and click
   paths, `scrollToRow`'s auto-expand.
8. `feat(git-ui): persist the collapse-by-default toggle` — §4.4's v8 bump and the toolbar control.

Conventional Commits; each message ends with the two attribution lines this session uses.

---

# 10. Verification

Per commit (fast, cheap): `bun run typecheck`, `bun run lint`, `bun run build`. No Go change in any
commit, so no `go build`/`go vet` gate — run them once at the end anyway to prove that claim.

Once, near the end (`CLAUDE.md`'s "implement the whole plan first, then test once"):

- `bun test packages/git-core packages/git-ui` — `rowPlan.test.ts`, `rowSvg.test.ts`, and
  `lanes.test.ts`/`layoutStore.test.ts` green **without edits** (§8.2).
- `bun run build:test`, then `graph-branch-order.spec.ts`, `graph-columns.spec.ts` and
  `repo-workspace.spec.ts`. The `ui` project runs webkit (`playwright.config.ts:49`), which this
  container does not preinstall — `docs/DEV_ENVIRONMENT.md` has `bunx playwright install webkit` and
  its system libraries. Run the full `bun run test:ui` if time allows.
- Every failing check gets fixed in this same pass, pre-existing or not, and the pre-commit hook
  passes clean on a normal (non-bypassed) commit before this phase is reported done.

Manual, in `bun run dev`, against a real repository with at least a dozen branches — this is the
half Playwright cannot judge:

1. Open the repo. The checked-out branch's chain runs top to bottom with no other branch's commit
   interleaved anywhere in it. Every other branch is three rows.
2. Group order matches `git for-each-ref --sort=-committerdate refs/heads refs/remotes` with the
   checked-out branch lifted to the top and empty groups dropped. Check this against real output,
   not by eye.
3. Expand a branch: its commits appear in place, in order, and nothing above it moves. Collapse it
   again: the same three rows come back.
4. Scroll to the bottom and Load more repeatedly on a repo with more history than one page. The
   viewport does not jump, the selected commit stays selected, and rows do not visibly reshuffle
   above the viewport.
5. Search for a commit that lives inside a collapsed branch and select the hit: the group expands
   and the row is revealed and selected.
6. Check out a different branch. The graph re-partitions: the new branch is group 0 and fully
   expanded, the old one collapses to three rows.
7. A detached HEAD and an unborn branch both render without an empty group 0 and without an error.
8. Fork stubs read as connections, not as glitches, in **both** the dark and light theme, and at
   graph font size 9 and 24 (P92 item 9's leaf) — the stub is the one element whose legibility is a
   judgement about contrast and scale, not an assertion.
9. `laneCount` on a twenty-branch repo stays in the same range it does today. If the graph column
   widens noticeably, §2's decision leaked and a lane is being opened for a cross-group link.

Do not commit a screenshot or a findings document; the commit log is the record.

# 11. Out of scope

- **The host.** `graph.stream`, `graph.loadMore`, `Walk`, `logsession`, the packed codec and the
  `--topo-order` walk itself are untouched (§5.1).
- **`lanes.ts`, `edges.ts`, `colors.ts`, `graph/types.ts`, `layoutStore.ts`.** §2 is the argument
  for why this phase reaches none of them; a change to any of them means the stub decision was
  abandoned and the plan needs revisiting, not extending.
- **Lane assignment policy** — which lane a branch gets, and in what colour. Groups change the row
  order handed to the pass; the pass's own rules stay as they are.
- **A per-group header row**, and any group-level action (checkout, delete) attached to one.
- **Persisting the expanded set** (§4.4), and any cross-session memory of which branches were open.
- **The graph column's width model** (P92 item 1) and its resize handles.
- **`ReviewView.vue`** and the ranged review walk: one line of history, no groups.
- **P94's tooling.** Independent phase, different subsystem.
