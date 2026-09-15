# P77 — Branches/stashes picker redesign

`docs/v1.8/SPEC.md`'s P77 row, turned into concrete steps. Everything below was read in the current
tree (`claude/v1-8-api-git-modules-e2luom` at `e88db595`, P71-P76 landed); line numbers are from
that tree. `BranchPicker.vue`, `rowMenuModel.ts` and `state/worktrees.ts` were re-read **after**
P76 widened the `createWorktree` emit and added `createWorktreeHere`, not from pre-P76 context.

SPEC asks for something the other rows in this chapter did not: **a concrete redesign proposal
before any implementation step**, not a cosmetic pass. Part A is that proposal — what the panel is,
what is measurably hard about it, and what replaces it, with a stated reason per choice. Part B is
the implementation.

Two facts shape the whole proposal, and neither is what SPEC's one-line complaint implies:

- **The panel is not a branches-and-stashes dropdown.** It is seven heterogeneous lists —
  branches, remote branches, tags, stashes, the global stash bucket, worktrees, stacks — stacked in
  one 320×420px popover with one scroll context (`BranchPicker.vue:395`-`552`). Five of them are
  capped at 50 rows; two are not capped at all. §1.1 measures it.
- **It is also the single funnel for twelve VS Code palette commands.**
  `apps/kira-studio-vscode/src/commands.ts`'s `MUTATING_COMMANDS` maps checkout, branch delete,
  branch rename, remote-branch delete, tag delete, four stash verbs, global-stash remove, worktree
  remove and stack set-parent all to `action: 'openBranchPicker'`, whose entire implementation is
  `isOpen.value = true` (`BranchPicker.vue:159`-`162`). Every one of those twelve opens the same
  panel scrolled to the top of Branches with no filter text and no focus inside it. §2 finding N5.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| Disclosure structure: flat, collapsible sections, tabs, something else | **Five tabs** (`KuiSegmented` strip with count badges) over one list body. Collapsible sections and flat both rejected with reasons | §3 |
| Grouping strategy | Five tabs — Branches (local + remote), Tags, Stashes (stack + global bucket), Worktrees, Stacks — with sub-groups inside two of them. Not seven tabs, not four | §4 |
| Search/filter mechanism, and what it filters over | One box, scoped to the active tab, matching the text each row already renders as its identity. Case-insensitive substring, **not** fuzzy — reason stated. Tab badges switch to per-tab match counts while a query is live, which is how a match in an inactive tab becomes findable at all | §5 |
| What "hard to navigate" actually is | Ten findings, each read out of the current source rather than inferred from the complaint | §2 |
| Does every existing row action survive | Yes — §8 maps all 31 of them, one row per action. Nothing moves to a different affordance, nothing is added | §8 |
| Is this `packages/git-ui`-shared or desktop-only | **Shared, both hosts, unconditionally.** `main.ts:79` mounts the same `App.vue` in both; nothing in the picker family reads `MountOptions.host`. The VS Code extension has no branch/stash browser of its own — its palette commands funnel *into* this panel | §0.1 |
| Is `GlobalStashList.vue` a cross-repo view | **No.** `globalStash.list` takes a `repoId` and reads `refs/kira/globalstash/` in that repo (`gitops/stash.go:126`). "Global" means *not addressed by stack position and not tied to a branch*, not cross-repository. Relabelling it is out of scope (§15) but the finding is stated so a later reader is not misled | §4 |
| Is there an existing search/filter primitive to reuse | Three, all reused: `KuiSearchInput` (already this panel's own filter box, and already exposing `focus()` for exactly the gap N6 names), `KuiSegmented` (already the review sidebar's count-badged pane switcher), and `contextMenuModel.ts`'s `enabledNeighbour` for roving keyboard focus | §3, §5, §7 |
| Should the filter become fuzzy (`fuzzysort` is already a repo dependency) | **No**, with reasons — §5.2. The measured problem is filter *scope* and list *ordering*, not match quality | §5.2 |
| New unit test | **One, earned:** the tab fold (`pickerModel.ts`) — filter-then-pin-then-cap over seven row kinds with five different orderings and a per-tab match count that must never disagree with the list it labels | §17.1 |
| Contract version | **37 → 38.** Four new `UiActionKind` members so the twelve palette commands can name a tab. The same shape G22 D10's own 24 → 25 bump took (two `UiActionKind` members, nothing else) | §13 |

### 0.1 Which host each item is about

| Item | Kira Studio | VS Code extension |
|---|---|---|
| §3-§12 the whole redesign | yes | yes — same `packages/git-ui` components, same mount |
| §13 palette tab targeting | no palette command reaches `openBranchPicker` on the desktop (`hostHandlers.ts` emits `ui.action` only for `revealCommit`) | **yes — the whole point.** All twelve commands live in `commands.ts` |
| §14 the stash-selection dead end | yes | yes — `App.vue`'s detail region is shared |
| §17.2 the interaction spec | no (no desktop harness mounts this panel) | yes — `tests/interaction/` |

---

# Part A — the redesign proposal

## 1. What the panel is today

### 1.1 Structure, measured

One `KuiPopoverPanel`, `:width="320"` (`BranchPicker.vue:395`), anchored under `AppToolbar.vue`'s
`[branch ▾]` trigger. Inside: `.kv-branch-panel { max-height: 420px }` (`:588`), a `KuiSearchInput`
filter (`:397`-`402`), then one `.kv-branch-panel-scroll { overflow-y: auto }` (`:598`) holding
seven sibling `.kv-branch-section`s in this order:

| # | Section | Rendered by | Cap | Filtered by the box |
|---|---|---|---|---|
| 1 | Branches | `BranchPicker.vue:405`-`476` | 50 | yes |
| 2 | Remote branches | `BranchPicker.vue:478`-`501` | 50 | yes |
| 3 | Tags | `TagList.vue` | 50 | yes |
| 4 | Stashes | `StashList.vue` | 50 | **no** |
| 5 | Global stash | `GlobalStashList.vue` | 50 | **no** |
| 6 | Worktrees | `WorktreeList.vue` | **none** | **no** |
| 7 | Stacks | `StackList.vue` | **none** | **no** |

The cap is `REF_LIST_SECTION_CAP = 50` (`refListModel.ts:58`), applied by `capSection`/`capItems`
(`:70`-`83`). Sections 6 and 7 never call either — they render `worktrees.entries.value`
(`WorktreeList.vue:126`) and `stack.stacks.value` (`StackList.vue:77`) straight through.

Row height is `.kui-row`'s `min-height: var(--kui-control-h, 22px)`
(`kira-ui/theme/controls.css:138`, bridged to `--kv-h-sm` = 22px at the default 13px font). Section
titles are `--kv-control-h-sm` = 18px. So the scroll viewport is roughly `420 - 22 (filter) - 16
(margins) ≈ 382px ≈ 17 rows`, against a worst case of `50 × 5 + worktrees + stacks ≈ 250+` rows —
about **fourteen viewport-heights of scrolling, in a 320px-wide popover**.

`StashDetailPane.vue` is *not* in this panel. It renders in `App.vue`'s detail region
(`App.vue:1635`/`:1661`) when a stash is the current selection. The picker is the browser; that
pane is the viewer. §2 finding N9 is the broken link between them.

### 1.2 Data is already loaded — nothing here is lazy

All five sources load eagerly on repo open, in one `watch` (`App.vue:334`-`349`): `refs.list`,
`stash.list` + `globalStash.list`, `worktree.list`, `stack.list`. So a tab strip carrying live
counts costs no request, and switching tabs costs no round trip. Worth stating, because it is what
makes §5.3's cross-tab match badges free.

`RefRow` already carries `committerDate` (`contract.ts:272`) and `checkedOutIn` (`:277`). Nothing in
the picker reads either for ordering today. §6 does. **No new wire field, no new request.**

## 2. What is hard to navigate

SPEC states the complaint but not the mechanism. Ten findings, each read out of the tree.

**N1 — seven unrelated kinds, one scroll context, no way to skip one.** §1.1's measurement. There is
no collapse, no jump, no index. The two sections with no cap at all (worktrees, stacks) sit last,
so they are simultaneously the furthest away and the only ones that can grow without bound.

**N2 — the filter covers three of seven sections.** `buildRefListSections`
(`refListModel.ts:99`-`105`) folds branches, remoteBranches and tags. Stash message, worktree path
and stack branch name are unreachable by the box. The placeholder says so — `"Filter branches and
tags"` (`BranchPicker.vue:400`) — which teaches the user the box is useless for four of the seven
lists rather than fixing it. Typing `auth` while hunting a stash labelled `auth refactor` shortens
the three ref sections and leaves the stash section exactly as long as it was.

**N3 — the cap and the sort interact badly.** `sortByName` is a plain `localeCompare`
(`refListModel.ts:47`-`49`); the cap is 50. On a 200-branch repo the 50 rendered are the
alphabetically first 50 — the branch used ten minutes ago is very likely among the 150 behind
`"150 more — refine your filter"` (`:472`-`474`). The only escape is remembering a substring, and
`filterRefs` is deliberately substring-only, never fuzzy (its own doc comment, `:38`-`40`). So the
cap systematically hides the most useful rows and the message names the one remedy that needs
knowledge the user came here to look up.

**N4 — HEAD is not pinned.** The current branch gets `font-weight: 600` plus a `●`
(`BranchPicker.vue:411`/`:429`-`434`) wherever it happens to sort alphabetically. On a repo past 50
branches it can be **absent from the list entirely**. Branches checked out in another worktree
(`checkedOutIn`) render a `worktree` badge but sort nowhere special either.

**N5 — twelve palette commands, one untargeted destination.** `MUTATING_COMMANDS`
(`commands.ts:64`-`210`): `checkout`, `branchDelete`, `branchRename`, `deleteRemoteBranch`,
`tagDelete`, `stashApply`, `stashPop`, `stashDrop`, `stashBranch`, `globalStashRemove`,
`worktreeRemove`, `stackSet` — all `action: 'openBranchPicker'`. `runUiAction`'s case
(`App.vue:872`-`874`) calls `AppToolbar`'s expose (`:260`), which calls `open()`
(`BranchPicker.vue:159`-`162`), whose whole body is `isOpen.value = true`. "Remove Worktree…" opens
a panel scrolled to the top of Branches, six sections above the worktree list.

**N6 — opening the panel focuses nothing.** `open()` sets a flag. `KuiPopoverPanel` manages focus
only on *close* (`restoreFocusToTrigger`). A click-opened panel leaves focus on the trigger, outside
the panel; a palette-opened one leaves it wherever VS Code left it. The filter box — the panel's one
navigation tool — always needs a mouse click first. `KuiSearchInput` already exposes `focus()` for
precisely this case and says so in its own doc comment (`KuiSearchInput.vue:8`-`13`, `:66`); this
panel never calls it.

**N7 — keyboard traversal is linear and enormous.** Every row's main element is a focusable
`KuiButton`, and five of the seven sections add a second focusable kebab per row. No roving
tabindex, no `role="listbox"`, no type-ahead beyond the box. Reaching the Stacks section from the
filter is up to ~500 Tab stops.

**N8 — the rows lose to the width.** A stash row packs eight fields into 320px minus a 22px icon
and a 22px kebab (`StashList.vue:111`-`127`): `stash@{N}`, origin chip, `auto` chip, message, base
sha + base subject, `-u`, file count, relative date. `.kv-stash-message` is the `flex: 1` field
(`:165`-`171`), so **the user's own label is the first thing to collapse**, while
`.kv-stash-base` holds a separately reserved `max-width: 12em` (`:173`-`180`) for a fact
`StashDetailPane.vue:68` already states in full.

**N9 — selecting a stash from the panel usually shows nothing.** `StashList.vue:49`-`51` calls
`StashState.select(sha)`, which sets `selectedSha` only (`state/stash.ts:120`-`122`). The detail
region is gated by `hasSelection` (`App.vue:1395`: `selection.row.value >= 0 ||
workingState.selected.value`) **before** `selectionIsStash` is ever consulted
(`:1627`-`:1636`) — so with no graph row selected the pane renders "Select a commit to see its
details." A global-stash entry can never satisfy that gate on its own: `stashRows.ts:31`-`41` builds
its decoration filter from the *stash stack* list, so no `{kind: 'stash'}` decoration exists for a
`refs/kira/globalstash/` entry and `isStashSha` (`App.vue:310`-`314`) never matches it. On top of
that the panel never closes on select, so the pane the click was meant to fill is behind the
popover.

**N10 — the panel misnames itself.** `role="dialog" aria-label="Branches and tags"`
(`BranchPicker.vue:396`) and `ariaLabel="Filter branches and tags"` (`:401`), for a surface holding
seven kinds. A screen-reader user is told about two of them.

## 3. Disclosure: five tabs

**Decision: a `KuiSegmented` strip of five count-badged tabs above one list body.**

### 3.1 Why not flat (today)

N1 measures it: seven kinds, ~250 capped rows, one 382px viewport. Flat has one virtue — every kind
is visible at once — and that virtue is already destroyed by the scroll depth. Keeping flat and only
capping harder makes N3 worse.

### 3.2 Why not collapsible sections

Collapsible sections fix "scroll past what you do not want." They do not fix "find the section":
with seven collapsibles the header itself still has to be scrolled to, and every open section pushes
the rest down, so the panel's shape changes with what is open and "which kinds exist" is legible
only when everything is collapsed. They also need per-user collapsed state to be worth anything, and
the only durable store here is `PersistedViewState`, whose own documented policy discards a
version-mismatched blob whole (`viewState.ts:29`-`32`, `:100`) — bumping 6 → 7 for a popover's
disclosure state would reset every user's column widths, scroll row and selection. Not worth it.

### 3.3 Why tabs

A tab strip is a **constant-position index**. It names every kind in a fixed place, it costs one
row of chrome, and it turns the body's scroll depth into the depth of *one* kind instead of seven.
Three further properties matter here specifically:

- **Counts come free** (§1.2), so the strip answers "do I even have stashes here?" without a click.
- **A live query can label the strip** (§5.3), which is the only mechanism that makes a match in an
  inactive tab discoverable at all. No collapsible-section layout gives that without rendering
  every section anyway.
- **It gives N5 a targeting mechanism that costs four union members** (§13). Twelve palette
  commands stop sharing one destination.

### 3.4 Reuse, not invention

`ReviewView.vue:516`-`520` already builds a `KuiSegmented` with three count-badged options
(Commits/Files/Comments) and swaps the panel body on `@update:model-value` (`:815`-`821`). That is
the identical pattern, in the same package, shipped. This phase reuses the component verbatim.

**ARIA.** `KuiSegmented` is `role="group"` + `aria-pressed`, not `tablist`/`tab`/`tabpanel`. Kept as
is: a toggle-button group switching a body is what the repo's own precedent already does, and
promoting `KuiSegmented` to a real tablist would either change semantics for its four existing call
sites or grow a second mode for one consumer. One additive improvement instead — an optional
`ariaControls` prop forwarded onto every button, pointing at the body's `id`, and the body carries
`aria-label` = the active tab's name. That plus §12's corrected panel label closes N10.

## 4. Grouping: what goes in each tab

| Tab | Icon | Holds | Why these together, and not split further |
|---|---|---|---|
| **Branches** | `codicon-git-branch` | local branches, then a **Remote** sub-group | One question — "which line of development?" The DWIM already unifies them: `remoteCheckoutTarget` (`refListModel.ts:146`-`150`) sends the *local* name when one exists, so a remote row is frequently a route to a local branch. Splitting them into two tabs would make the user guess which one holds the branch they want |
| **Tags** | `codicon-tag` | tags | A different question (a point, not a line) and a different sort — `sortTags` uses `naturalCompare` so `v10` follows `v9` (`refListModel.ts:15`-`36`). Already its own component |
| **Stashes** | `codicon-archive` | stash stack, then a **Global stash** sub-group | One question — "which set of saved changes?" Two buckets that already share a row shape, a detail pane, and four of six menu items |
| **Worktrees** | `codicon-multiple-windows` | worktrees | A worktree is a *place*, not a ref. Its rows carry three inline actions and a removal dialog nothing else shares |
| **Stacks** | `codicon-list-tree` | stacks, then the **Needs attention** orphan group | Stack rows *are* branch names, but with parent/depth/stale/restack structure and a per-stack header action. Folding them into Branches would make one tab answer two questions with two row shapes |

Five, not seven: Remote branches and Global stash are sub-groups, not destinations — each is a
refinement of the question its host tab already asks, and each is small relative to it.

Five, not four: no pair of the five above answers the same question. §15 records "fold Stacks into
Branches" as the option considered and declined.

**Sub-group headings** reuse `.kv-branch-section-title` and render only when that sub-group has rows
*after* filtering — so a query matching only remote branches shows the Remote heading and no empty
Local one.

**Stash sub-groups stay visibly separate** rather than merging into one list with an origin chip:
the two row menus genuinely differ (`buildStashMenu` offers Pop and Drop, `buildGlobalStashMenu`
offers neither and adds Remove from global stash — `rowMenuModel.ts:360`/`:401`, with D12's reason
recorded there). Merging would make which menu a row gets invisible until it is opened.

## 5. Search and filter

### 5.1 One box, scoped to the active tab

The box stays where it is (`KuiSearchInput`, top of the panel). Three changes:

1. It filters **the active tab**, which closes N2 for the four lists it never reached.
2. Its `placeholder`/`ariaLabel` become the active tab's — `"Filter stashes"`, `"Filter
   worktrees"` — which closes half of N10.
3. Query text is per-panel-open: cleared on close, never persisted. Same rule `PersistedViewState`
   already applies to the graph search query, for the reason recorded there (`viewState.ts:18`-`23`:
   a remembered term silently re-running against a repository that has moved on).

**What each tab matches over** — in every case, the text the row already renders as its identity, so
a match is always visible in the row that matched:

| Tab | Fields |
|---|---|
| Branches | `RefRow.shortName` (local and remote) |
| Tags | `RefRow.shortName` |
| Stashes | `stashLabel(entry)` — git's `"WIP on <b>: "` framing already stripped by `stashListModel.ts:23`-`33` — plus `entry.branch` (the origin chip) |
| Worktrees | `WorktreeList.vue:40`-`44`'s `label(entry)` (branch name, or `detached @ <sha>`) plus `entry.path` |
| Stacks | `StackBranch.name` plus the owning `StackSummary.base` |

Not matched: `upstream`, base-commit subjects, stack `tip` shas. None is rendered as a row's
identity, and each would make a match land on a row with no visible reason for being there.

### 5.2 Substring, not fuzzy — and why, given `fuzzysort` is already here

`fuzzysort@4.0.2` is a repo dependency and powers quick-open over up to 50,000 paths
(`apps/kira-studio/frontend/src/repo/state/quickOpen.ts:79`-`157`). Declined here, for three
reasons rather than "existing code works":

1. **Bundle placement.** It lives in the desktop app. `packages/git-ui` is also bundled into the VS
   Code extension webview (`package.json`: `git-core`, `git-ipc`, `kira-ui`, codicons, seti,
   slickgrid, vue — no matcher), so adding it here ships a 50k-path-scale matcher into the
   extension for a list of at most a few hundred rows.
2. **One rule per concept in this module family.** `filterRefs` (`refListModel.ts:38`-`40`) and
   `fileTreeModel.ts:64`'s `filterFiles` both specify "case-insensitive substring, not fuzzy, not
   regex" as this family's rule. Having the picker's filter score differently from the file tree's
   filter in the same panel family is worse than either rule alone.
3. **It does not address the measured problem.** N2 is scope and N3 is ordering. Fuzzy matching
   fixes neither; it changes how a query the user already typed correctly is ranked.

If a later phase does want ranked matching in the picker, `fuzzysort` is the library to reach for
and it should move into a shared package first — recorded here so the next reader does not
re-derive it.

### 5.3 Cross-tab match counts

While the query is empty, each tab's badge is its total. While it is non-empty, **each badge is that
tab's match count**, computed with that tab's own field scope from §5.1. So typing `auth` on the
Branches tab immediately shows `Stashes 2`, and clicking through keeps the query.

This is the piece no other disclosure structure gives: today a stash matching the query is not merely
buried, it is unmatchable and unhinted. The counts are free — every list is already in memory
(§1.2) — and the badge and the list it labels are computed by the same fold (§9), so they cannot
disagree.

## 6. Ordering, pinning and the cap

### 6.1 Per-tab ordering

| Tab / list | Order | Reason |
|---|---|---|
| Branches, local | HEAD, then branches checked out in another worktree, then `committerDate` descending; ties by name | Closes N3/N4. `committerDate` is already on the wire (`contract.ts:272`) and already loaded |
| Branches, remote | `committerDate` descending; ties by name | Same |
| Tags | unchanged — `sortTags`/`naturalCompare` | A tag list is a version sequence; `v10` after `v9` is the whole point of that function. Recency would destroy it |
| Stashes, stack | unchanged — stack order (`entry.index`) | `stash@{0}` is already newest, and the index is the addressing scheme the Pop/Drop verbs use |
| Stashes, global | `timestamp` descending | The bucket has no stack position at all (`rowMenuModel.ts:393`-`399`), so nothing is lost by ordering it |
| Worktrees | current, then main, then `path` | Today it is whatever `worktree.list` returned |
| Stacks | unchanged — `buildStackRows` pre-order | The order *is* the structure (parent before child, `contract.ts:690`-`692`) |

Alphabetical ordering has one real virtue — a stable position for a known name. That virtue is
served by the filter box; the list is what you read when you are looking for something *recent*. The
trade is stated rather than assumed, and HEAD is pinned so the one row whose position matters most
never moves.

### 6.2 Pin before cap

Three rules, in this order, and the order is the point:

1. **Filter first.** A query that excludes HEAD must not resurrect it — pinning applies only among
   rows that already matched.
2. **Pin second.** HEAD, then worktree-checked-out rows, are moved to the front.
3. **Cap third**, and the cap floor is never below the pinned count — so a pinned row is never
   capped out, and never appears twice.

### 6.3 The cap becomes actionable

`"150 more — refine your filter"` becomes a real `KuiButton`: **"Show 50 more (150 remaining)"**,
raising *that list's* cap by `REF_LIST_SECTION_CAP` for the current panel-open. Stepping resets when
the panel closes and when the query changes (a new query is a new list).

Stepping, not "show all", and not virtualization: a repo with thousands of branches exists, each
step is a deliberate click, and the common case is under 50. A virtualizer earns its keep against
thousands of rows scrolled continuously — that is not this. `WorktreeList`/`StackList` gain the same
cap, closing the "uncapped and furthest away" half of N1.

## 7. Density, focus and keyboard

### 7.1 One field removed, one width raised

The stash row drops its base-commit column (`.kv-stash-base`, `StashList.vue:121`-`123`) — the fact
is unchanged and stated in full by `StashDetailPane.vue:68` the moment the row is selected, and its
reserved `max-width: 12em` is what was crowding out the user's own label (N8), which §5.1 now also
makes the thing the filter matches. It survives as the row's tooltip.

Panel width 320 → 380 (`:width` prop on `KuiPopoverPanel`). One kind per tab means one row shape per
body, so the extra 60px goes to identity fields rather than to more competing columns. §12 covers
the geometry, including why a 380px panel cannot overflow a narrow webview.

### 7.2 Focus on open

`open()` focuses the filter input on the next tick, via `KuiSearchInput`'s own exposed `focus()`
(`KuiSearchInput.vue:66`) — the escape hatch that component documents for exactly this case. Both
entry points (the trigger click and `runUiAction`'s palette route) go through the same function, so
N6 closes for both.

### 7.3 Roving focus over one list

One body means a roving-tabindex list is finally tractable. The step function is
`@kira/kira-ui`'s `enabledNeighbour` (`contextMenuModel.ts:47`-`61`) — already framework-agnostic,
already exported, already the wrap-around neighbour walk `KuiMenuList` uses. It takes
`{id, disabled}[]`, which §9's fold produces as a by-product.

- `ArrowDown`/`ArrowUp` move between rows; `ArrowUp` from the first row returns to the filter.
- `Home`/`End` jump to the first/last row.
- `Enter` on a focused row runs its primary action where it has one (branch/tag/stash rows), and
  does nothing where it has none (worktree/stack rows, which carry only trailing icon actions).
- `Tab` from a focused row reaches that row's own trailing buttons, unchanged.

Roving focus lands on the row container (`tabindex` 0/-1), not the row's main button, because
worktree and stack rows have no main button (`WorktreeList.vue:127`, `StackList.vue:96`) — one
uniform rule beats two.

No new keyboard chord is invented for switching tabs: the strip sits before the filter in DOM order,
so `Shift+Tab` from the filter reaches it and each tab is a plain activatable button.

## 8. Every existing action, mapped

Nothing is added, nothing is removed, and no action changes affordance. The table is the proof.

| # | Action today | Where today | Where after |
|---|---|---|---|
| 1 | Checkout local branch (row click) | `BranchPicker.vue:183`-`187` | Branches tab, local list, row click |
| 2 | Checkout remote branch, DWIM (row click) | `:189`-`193` | Branches tab, Remote sub-group, row click |
| 3-7 | Ref menu: Checkout / Rename branch… / Review branch changes / Create worktree here… / Delete branch | `buildRefMenu` branch arm, `rowMenuModel.ts:239`-`266` | unchanged — same kebab, same right-click, same builder |
| 8-10 | Ref menu (remote): Checkout / Review branch changes / Create worktree here… | `rowMenuModel.ts:228`-`238` | unchanged |
| 11-15 | Stack menu on a branch row: Set/Change stack parent… / Remove from stack / Restack this stack / Go to parent branch / Go to child branch | `rowMenuModel.ts:272`-`289`, handled `BranchPicker.vue:296`-`323` | unchanged |
| 16 | Inline branch rename editor + submit/escape | `BranchPicker.vue:413`-`425`, `:332`-`339` | unchanged, inside the Branches tab row |
| 17 | Force-delete banner after `NotFullyMerged` | `:467`-`471`, `:326`-`330` | unchanged, rendered under the local list |
| 18 | PR badge — button when `openExternalCapability`, plain pill otherwise | `:436`-`450` | unchanged |
| 19 | Tag checkout (row click), closing the panel | `TagList.vue:35`-`39` | Tags tab, row click |
| 20-23 | Tag menu: Checkout / Delete tag / Push to `<remote>` (disabled) / Delete on `<remote>` (disabled) | `rowMenuModel.ts:190`-`220` | unchanged |
| 24 | Stash row select (show changes) | `StashList.vue:49`-`51` | Stashes tab, stack sub-group, row click — **plus §14's fix** |
| 25-30 | Stash menu: Apply (cross-branch label) / Pop (absent cross-branch) / Drop / Create branch from stash… / Save to global stash… / Show changes | `buildStashMenu`, `rowMenuModel.ts:360`-`391` | unchanged |
| 31 | "Save to global stash…" header button | `GlobalStashList.vue:91`-`98` | Stashes tab header action |
| 32-35 | Global stash menu: Apply here / Create branch from this… / Show changes / Remove from global stash | `buildGlobalStashMenu`, `rowMenuModel.ts:401`-`435` | unchanged |
| 36 | "Create Worktree…" header button | `WorktreeList.vue:118`-`124` | Worktrees tab header action |
| 37-39 | Worktree row icons: Switch / Open in new window / Remove (with its preflight dialog) | `WorktreeList.vue:139`-`165`, `:62`-`111` | unchanged, Worktrees tab |
| 40 | Per-stack "Restack" header button | `StackList.vue:80`-`87` | unchanged, per-stack sub-group header inside the Stacks tab |
| 41-42 | Stack row icons: Set stack parent… / Remove from stack | `StackList.vue:129`-`146` | unchanged |
| 43 | Orphan ("Needs attention") rows: Set stack parent… | `StackList.vue:150`-`169` | unchanged, Stacks tab |
| 44 | Read-only degradation (`writeCapability: false`) → `buildReadOnlyRefMenu` / `buildReadOnlyStashMenu`, hidden header buttons and row icons | `BranchPicker.vue:220`, `StashList.vue:68`-`71`, `WorktreeList.vue:140`/`149`/`158`, `StackList.vue:129`/`138` | unchanged — every gate stays on the component that owns it |

Two behaviours outside the row inventory also survive unchanged: `closeForCheckout()`'s
focus-to-trigger-before-close fix (`BranchPicker.vue:171`-`174`, W20's reason recorded there), and
the PR warm-up on open (`:361`-`371`). The warm-up gets strictly *better*: `visibleBranchNames`
already scopes to what is rendered, for the reason G32's round-3 performance review recorded
(hundreds of `gh` spawns from one open), and with tabs a picker opened on Stashes renders no branch
rows and therefore warms nothing.

---

# Part B — implementation

## 9. `pickerModel.ts` — the fold

New file, `packages/git-ui/src/components/pickerModel.ts`, beside `refListModel.ts` /
`stashListModel.ts` / `stackListModel.ts` — the same "pure fold out of the template" convention
those three already follow.

**`refListModel.ts` is not modified.** `buildRefListSections` has two other consumers —
`review/BaseSelector.vue:17` and `review/ReviewView.vue:61` — so changing its sort to recency would
silently reorder the review view's own branch selector. The new module reuses that file's parts
(`filterRefs`, `sortTags`, `naturalCompare`, `capItems`, `REF_LIST_SECTION_CAP`) and owns the
picker-specific ordering itself.

```ts
export type PickerTab = 'branches' | 'tags' | 'stashes' | 'worktrees' | 'stacks';

/** Every capped list in the panel — the key `capSteps` and `PickerModel` are both addressed by. */
export type PickerListKey =
  | 'branchesLocal' | 'branchesRemote' | 'tags'
  | 'stashStack' | 'stashGlobal' | 'worktrees' | 'stacks';

export interface PickerList<T> {
  readonly visible: readonly T[];
  readonly hiddenCount: number;
}

export interface PickerInput {
  readonly branches: readonly RefRow[];
  readonly remoteBranches: readonly RefRow[];
  readonly tags: readonly RefRow[];
  readonly stashes: readonly StashEntry[];
  readonly globalStashes: readonly StashEntry[];
  readonly worktrees: readonly WorktreeEntry[];
  readonly stacks: readonly StackSummary[];
  readonly orphans: readonly StackBranch[];
}

export interface PickerModel {
  /** Every tab's badge: totals with an empty query, match counts with a live one (§5.3). */
  readonly counts: Readonly<Record<PickerTab, number>>;
  readonly branchesLocal: PickerList<RefRow>;
  readonly branchesRemote: PickerList<RefRow>;
  readonly tags: PickerList<RefRow>;
  readonly stashStack: PickerList<StashEntry>;
  readonly stashGlobal: PickerList<StashEntry>;
  readonly worktrees: PickerList<WorktreeEntry>;
  readonly stacks: readonly { summary: StackSummary; branches: readonly StackBranch[] }[];
  readonly orphans: PickerList<StackBranch>;
  /** The active tab's rows in DOM order, for §7.3's roving focus — shape chosen to feed
   *  `enabledNeighbour` directly. */
  readonly rowIds: readonly { id: string; disabled: boolean }[];
}

export function buildPickerModel(
  input: PickerInput,
  filter: string,
  tab: PickerTab,
  capSteps: Readonly<Partial<Record<PickerListKey, number>>>,
): PickerModel;
```

Counts are computed for all five tabs on every call (the strip shows all five); the per-list
`visible`/`hiddenCount` are materialised for the active tab only, with every other list returned
empty — the body renders one tab, so folding the other four would be work nothing reads.

The three-rule core (§6.2), local branches shown; the other lists are the same shape with their own
comparator and no pin step:

```ts
function orderLocalBranches(rows: readonly RefRow[]): { rows: RefRow[]; pinned: number } {
  const isPinned = (r: RefRow) => r.isHead || r.checkedOutIn !== undefined;
  const pinned = rows.filter(isPinned).sort(
    (a, b) => Number(b.isHead) - Number(a.isHead) || a.shortName.localeCompare(b.shortName),
  );
  const rest = rows.filter((r) => !isPinned(r)).sort(
    (a, b) => b.committerDate - a.committerDate || a.shortName.localeCompare(b.shortName),
  );
  return { rows: [...pinned, ...rest], pinned: pinned.length };
}

/** `capItems` with a floor: a pinned row is never capped out, and never duplicated — the rows are
 *  already ordered pinned-first, so one slice does both. */
function capWithPins<T>(rows: readonly T[], pinned: number, cap: number): PickerList<T> {
  const limit = Math.max(cap, pinned);
  if (rows.length <= limit) return { visible: rows, hiddenCount: 0 };
  return { visible: rows.slice(0, limit), hiddenCount: rows.length - limit };
}
```

Row ids are stable per kind and double as DOM ids for focus: `branch:<refname>`,
`remote:<refname>`, `tag:<refname>`, `stash:<sha>`, `global:<sha>`, `worktree:<path>`,
`stack:<name>`, `orphan:<name>`. `disabled` is `false` for every row today — the field exists
because `enabledNeighbour` takes it, not because a row is currently ever skipped.

## 10. `BranchPicker.vue` — the shell

The file stops rendering seven sections and becomes: trigger, strip, filter, one body.

- `activeTab = ref<PickerTab>('branches')`, plain component state. **Not persisted** — see §15.
- `model = computed(() => buildPickerModel(…, filter.value, activeTab.value, capSteps.value))`.
- `tabOptions = computed<KuiSegmentedOption[]>(…)` from `model.counts`, icons per §4.
- `open(tab?: PickerTab)` sets `activeTab` when given one, flips `isOpen`, and focuses the filter on
  the next tick (§7.2). `defineExpose({ open })` keeps its name; the parameter is optional so every
  existing caller is unchanged.
- `close()` keeps its existing job (clearing `refMenu`/`renaming`/`forceDeleteCandidate`) and also
  clears `filter` and `capSteps`.
- Watching `filter` resets `capSteps` (§6.3).
- `visibleBranchNames` (`:361`-`371`) reads the model's own two branch lists instead of
  `sections.branches`/`sections.remoteBranches` — same shape, same G32 scoping guarantee.
- Every existing handler (`checkoutBranch`, `checkoutRemote`, `openRefMenu*`, `refMenuSections`,
  `onRefMenuSelect` including P76's `createWorktreeHere` arm at `:275`-`290`, `confirmForceDelete`,
  `submitRename`) is unchanged. They are moved inside the Branches tab's body, not rewritten.
- Every emit is unchanged, including P76's widened `(e: 'createWorktree', seed?: WorktreeCreateSeed)`
  (`:106`-`108`) — the Worktrees tab's header button still forwards the seed-less `{}` shape
  `WorktreeList.vue` has always sent.

Keyboard handling (§7.3) lives here, over `model.rowIds`, since this file owns the body.

## 11. The five child components take a section prop

`TagList.vue` already has the right contract: `section: RefListSection`, rendering exactly what the
parent hands it (`TagList.vue:15`-`19`, and its doc comment says why). The other four each read
state and cap it themselves — `StashList.vue:47`, `GlobalStashList.vue:38`,
`WorktreeList.vue:126`, `StackList.vue:77`/`:91`. They move to `TagList.vue`'s contract:

| Component | Gains | Loses |
|---|---|---|
| `StashList.vue` | `section: PickerList<StashEntry>` | its own `capItems` call; the base-commit column (§7.1) |
| `GlobalStashList.vue` | `section: PickerList<StashEntry>` | its own `capItems` call |
| `WorktreeList.vue` | `section: PickerList<WorktreeEntry>` | nothing — it had no cap at all |
| `StackList.vue` | `stacks`/`orphans` as pre-filtered, pre-capped lists | its own reads of `stack.stacks.value`/`stack.orphans.value` for rendering |

Each keeps its `ops`/`stash`/`worktrees`/`stack` props: the row *actions* still call through those
states. Only what a component renders moves to the parent. Each keeps its own section heading, which
becomes a sub-group heading (§4) or the tab's own heading.

`StackList.vue` keeps reading `stack.stacks.value` for its per-stack `needsRestack` header button —
the filter narrows which branch rows render, never which stacks exist.

## 12. Panel geometry

```css
.kv-branch-panel {
  /* was: max-height: 420px */
  max-height: min(520px, var(--kui-float-max-h, 520px));
  max-width: var(--kui-float-max-w, 380px);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
```

`--kui-float-max-h`/`--kui-float-max-w` are written by `floatingPosition.ts`'s `size()` middleware
(`FLOAT_MAX_HEIGHT_VAR`/`FLOAT_MAX_WIDTH_VAR`, `:39`-`40`) and documented as opt-in: "a consumer
opts in by reading them… a surface that already fits is unaffected." This panel never opted in and
carries a literal instead. Reading them is what makes a 380px `:width` safe in a narrow webview —
`shift()` already keeps the surface inside the viewport, and the cap keeps its *content* from
overflowing when the panel is genuinely wider than the space.

`.kv-branch-panel-scroll` keeps `overflow-y: auto`; it now holds one tab's body.

## 13. Palette targeting — contract 37 → 38

Four new `UiActionKind` members beside the existing `openBranchPicker`, which keeps its name and its
meaning (the Branches tab):

```ts
  | 'openBranchPicker'
  /** P77: the same panel, opened on its Tags / Stashes / Worktrees / Stacks tab. Twelve palette
   *  commands funnelled into `openBranchPicker` alone (commands.ts's MUTATING_COMMANDS), which
   *  opens a five-tab panel on whichever tab it was last left on and no closer to the row the
   *  command names. One member per tab, the same shape G22 D10 used for
   *  'resetSelected'/'cherryPickSelected'. */
  | 'openTagPicker'
  | 'openStashPicker'
  | 'openWorktreePicker'
  | 'openStackPicker'
```

`MUTATING_COMMANDS` re-pointing (`commands.ts`):

| Command | Was | Now |
|---|---|---|
| `checkout`, `branchDelete`, `branchRename`, `deleteRemoteBranch` | `openBranchPicker` | `openBranchPicker` (unchanged) |
| `tagDelete` | `openBranchPicker` | `openTagPicker` |
| `stashApply`, `stashPop`, `stashDrop`, `stashBranch`, `globalStashRemove` | `openBranchPicker` | `openStashPicker` |
| `worktreeRemove` | `openBranchPicker` | `openWorktreePicker` |
| `stackSet` | `openBranchPicker` | `openStackPicker` |

`App.vue`'s `runUiAction` (`:872`-`874`) gains four cases, each calling
`toolbarRef.value?.openBranchPicker(tab)`; `AppToolbar.vue`'s expose (`:260`) forwards the optional
tab to `BranchPicker.open`.

**The bump and its chores**, exactly the set P74's and P75's own result sections recorded:

- `validate.ts:137` `CONTRACT_VERSION = 37` → `38`, with its own entry in that file's running
  comment block naming this phase and the four members.
- `apps/kira-studio/internal/gitrpc/stash_test.go:46` `TestContractVersion_Is37` → `Is38`, the
  established per-bump convention.
- `packages/git-ipc/testdata/graphChunkFrame.{bin,json}` regenerated via
  `gitsock`'s `TestFixtures_CaptureGraphChunkFrame` under `KIRA_GIT_FIXTURES=write`
  (`internal/gitsock/graphstream_test.go:531`), since the captured envelope carries the version.
- **No `internal/bridge/gitstream.go` allowlist entry.** That allowlist classifies *request*
  methods; this phase adds no request. `ui.action` is an event the extension host emits onto an
  already-open webview channel, the same class P75 confirmed for `graph.revealCommit`.

## 14. The stash-selection dead end

N9, fixed in three lines, all in `packages/git-ui`:

1. `App.vue:1395` — `hasSelection` gains the stash case, so the gate matches the `v-else-if` chain
   below it that already handles stashes:
   ```ts
   const hasSelection = computed(
     () => selection.row.value >= 0 || workingState.selected.value || selectionIsStash.value,
   );
   ```
   (`selectionIsStash` is declared at `:1248`, above this, so no reordering is needed.)
2. Selecting a stash opens the detail region when it is collapsed — the same rule a graph selection
   already applies (`App.vue:1220`).
3. The picker closes on a stash row select, through the existing `closeForCheckout()` (focus to the
   trigger first, then close — `BranchPicker.vue:171`-`174`), so the pane the click fills is not
   behind the popover.

This also makes a global-stash entry reachable at all: it can never be a graph row (§2 N9's
`stashRows.ts` evidence), so before this fix its "Show changes" needed an unrelated commit selected
first.

## 15. Deliberately out of scope

- **Moving the picker out of the toolbar.** SPEC asks to redesign the dropdown, not to replace it
  with a sidebar or a tree view. The trigger, its position and its `[branch ▾]` label are unchanged.
- **Persisting the active tab.** `PersistedViewState` is the only durable store, and its documented
  policy discards a version-mismatched blob whole (`viewState.ts:29`-`32`) — bumping 6 → 7 would
  reset every user's column widths, scroll row and selection for a popover's tab. `ReviewView.vue`'s
  own pane toggle sets the same precedent: component state, not persisted.
- **Virtualizing the lists.** §6.3's reason: stepping bounds the render cost, each step is a
  deliberate click, and the common case is under 50 rows.
- **Fuzzy matching.** §5.2's three reasons, and the pointer to `fuzzysort` for whoever revisits it.
- **Touching `buildRefListSections`.** `review/BaseSelector.vue` and `review/ReviewView.vue` both
  consume it; changing its sort would silently reorder the review view's branch selector (§9).
- **Folding Stacks into Branches** (four tabs instead of five). Stack rows are branch names with
  parent/depth/stale structure and a per-stack header action — one tab, two row shapes, two
  questions (§4).
- **Renaming "Global stash".** The label is genuinely misleading — it is per-repository (§0), not
  cross-repository — but a rename ripples through four menu items (`rowMenuModel.ts:387`/`:426`),
  two palette command titles in `apps/kira-studio-vscode/package.json`, and the `saveGlobalStash`
  `UiActionKind` member. This redesign is about structure.
- **Adding row actions no row has today.** No kebab on worktree or stack rows, no branch creation
  from the picker, no stash creation. §8 is an exact mapping, not a superset.
- **A real `tablist`/`tabpanel` ARIA contract on `KuiSegmented`.** §3.4's reason; the additive
  `ariaControls` prop is the whole a11y change to that component.
- **The commit-vs-stash detail-pane precedence.** Selecting a stash while a commit is selected
  leaves the commit highlighted in the graph while the stash's pane renders. Pre-existing
  (`App.vue:1627`-`:1645`'s `v-else-if` order), untouched here.
- **`fakeGraphHost.ts`'s unanswered methods beyond the five §17.2 needs.** The harness answers what
  its own specs ask for, the convention its doc comment already states.

## 16. Files

Added:

| File | Contents |
|---|---|
| `packages/git-ui/src/components/pickerModel.ts` | §9's fold |
| `packages/git-ui/src/components/pickerModel.test.ts` | §17.1's earned unit test |
| `apps/kira-studio-vscode/tests/interaction/branch-picker.spec.ts` | §17.2's interaction spec |

Modified:

| File | Change |
|---|---|
| `packages/git-ui/src/components/BranchPicker.vue` | §10 — strip, one body, tab state, cap steps, focus-on-open, roving focus; §12's geometry; §14's close-on-stash-select |
| `packages/git-ui/src/components/StashList.vue` | §11's `section` prop; §7.1's dropped base column |
| `packages/git-ui/src/components/GlobalStashList.vue` | §11's `section` prop |
| `packages/git-ui/src/components/WorktreeList.vue` | §11's `section` prop |
| `packages/git-ui/src/components/StackList.vue` | §11's pre-filtered `stacks`/`orphans` props |
| `packages/git-ui/src/components/AppToolbar.vue` | §13 — the optional tab on the exposed `openBranchPicker` |
| `packages/git-ui/src/App.vue` | §13's four `runUiAction` cases; §14's three lines |
| `packages/git-ui/src/icons/index.ts` | The five tab icons, as their own const (the file's own "kept separate because these decorate X, not an action" convention) |
| `packages/kira-ui/src/KuiSegmented.vue`, `optionTypes.ts` | Optional `ariaControls` (§3.4); `badge` widened to `number \| string` so §5.3 can pass `formatChangeCount`'s `1.2K` for a four-figure count |
| `packages/git-ipc/src/contract.ts` | §13's four `UiActionKind` members |
| `packages/git-ipc/src/validate.ts` | `CONTRACT_VERSION` 37 → 38 and its comment entry |
| `packages/git-ipc/testdata/graphChunkFrame.{bin,json}` | Regenerated (§13) |
| `apps/kira-studio-vscode/src/commands.ts` | §13's eight re-pointed table entries |
| `apps/kira-studio/internal/gitrpc/stash_test.go` | `TestContractVersion_Is37` → `Is38` |
| `apps/kira-studio-vscode/tests/interaction/support/fakeGraphHost.ts` | §17.2's five opt-in scripted responses |

Deleted: none. `refListModel.ts` is untouched (§9).

**No new dependency.** `KuiSegmented`, `KuiSearchInput`, `enabledNeighbour`, `capItems`,
`formatChangeCount`, `@floating-ui/dom`'s `size()` vars and the codicon set are all already here;
§5.2 states why the one candidate library is declined.

## 17. Tests

### 17.1 One new unit test, earned

`CLAUDE.md`'s default is none, and every other piece of this phase gets none. §9's fold is the
exception, measured against the bar rather than waved past it — it is the "decision structure too
large to hold in your head" case, with rules that interact rather than compose:

- **Filter, then pin, then cap, in that order** (§6.2). Each pairwise swap is a real defect: pinning
  before filtering resurrects HEAD out of a query that excluded it; capping before pinning drops
  HEAD out of a 200-branch repo, which is N4 restated.
- **Five orderings across seven row kinds** (§6.1), two of which must *not* change (tags keep
  `naturalCompare`, the stash stack keeps its index) while three do.
- **Five filter scopes over seven row kinds** (§5.1), each over different fields, one of them a
  derived value (`stashLabel`, not the raw message).
- **The counts and the list must agree** (§5.3). A badge computed over the whole source while the
  list is computed over the filtered source is a silent lie the user reads before clicking.

Cases:

| # | Asserts |
|---|---|
| 1 | HEAD sorts first in the Branches tab regardless of name or `committerDate` |
| 2 | A `checkedOutIn` branch sorts after HEAD and before every unpinned row |
| 3 | HEAD survives a cap of 1 against 60 branches, exactly once |
| 4 | A filter excluding HEAD does not pin it back in |
| 5 | Local branches order by `committerDate` descending, ties by name |
| 6 | Tags keep `naturalCompare` (`v9` before `v10`) and are never reordered by recency |
| 7 | The stash stack keeps `index` order; the global bucket orders by `timestamp` descending |
| 8 | Worktrees order current, then main, then path |
| 9 | Stash filtering matches `stashLabel` (git's `"WIP on main: "` framing stripped) and the origin branch, not the raw message |
| 10 | Worktree filtering matches both the label and the path |
| 11 | Stack filtering matches a branch name and its stack's base |
| 12 | Counts equal totals with an empty query, and per-tab match counts with a live one |
| 13 | Counts are computed for all five tabs while only the active tab materialises rows |
| 14 | A cap step raises exactly one list's cap and leaves the others' `hiddenCount` alone |
| 15 | `rowIds` are unique and in DOM order for each tab, including both sub-groups |

### 17.2 One interaction spec, and the harness it needs

`apps/kira-studio-vscode/tests/interaction/branch-picker.spec.ts`. There is no coverage of this
component anywhere today — confirmed by search, not assumed.

`fakeGraphHost.ts` currently answers `app.init`, `repo.list`, `repo.open`, `graph.*` and leaves
everything else deliberately unanswered (its own doc comment, `:249`-`257`). It gains five opt-in
scripted responses — `refs.list`, `stash.list`, `globalStash.list`, `worktree.list`, `stack.list` —
**additively**, the same shape P76 used when it widened `gitStreamMock.ts` with an optional third
parameter: every existing caller keeps hanging on every method beyond what it already answered.

Cases:

1. The strip renders five tabs whose badges match the seeded counts.
2. Clicking Stashes swaps the body, and the filter's `aria-label` becomes "Filter stashes".
3. A query typed on Branches puts a match badge on Stashes; switching tabs keeps the query and
   shows the matching stash row.
4. Opening the panel focuses the filter input (N6).
5. `ArrowDown` from the filter focuses the first row; `ArrowUp` from it returns to the filter.

### 17.3 Not extended

`rowMenuModel.test.ts` gets nothing: no menu builder changes, including P76's `createWorktreeHere`
arms, so its five P76 cases still describe the tree exactly. `stashListModel.test.ts` and
`stackListModel.test.ts` likewise — §11 moves *where* their outputs render, never what they compute.

### 17.4 Checks

`go build ./...`, `go vet ./...`, `go test ./...` (needed this time — `stash_test.go` changes);
`bun typecheck`, `bun lint`; both `bun run build` and `bun run build:vscode`; `bun run test:unit`;
`bun run test:webview`; `bun run test:ui`. The fixture regen (`KIRA_GIT_FIXTURES=write`) runs as
part of the contract commit, not afterwards — P74's own result section records what it costs to
discover a stale fixture only at the end.

## 18. Order and sizing

### 18.1 Commits

1. **§9, §10, §11, §12, §7.1 — the shell.** `pickerModel.ts`, `BranchPicker.vue`'s strip and single
   body, the four `section`-prop conversions, the geometry, the dropped stash column. One commit:
   a half-converted picker — tabs for two kinds, stacked sections for the other five — is worse than
   either end state, the same reason P75 §4 gave for landing its checkbox conversion atomically.
   Ordering and filtering are unchanged in this commit: each list gets today's content, in today's
   order, in its new home.
   → `refactor(git-ui): give the branch picker one tabbed body`
2. **§5 — the scoped filter and the cross-tab counts.**
   → `feat(git-ui): filter every branch-picker tab, not only refs`
3. **§6 — ordering, pinning, and the stepped cap.**
   → `feat(git-ui): rank branch picker rows by recency and pin the current branch`
4. **§7.2, §7.3 — focus on open and roving keyboard focus.**
   → `feat(git-ui): focus and keyboard-navigate the branch picker`
5. **§14 — the stash-selection dead end.** Independent of 1-4; may land anywhere after 1.
   → `fix(git-ui): show a stash's changes when its picker row is selected`
6. **§13 — palette tab targeting.** Contract members, the version bump, the fixture regen, the Go
   version test and the eight re-pointed commands, in one commit: a bumped constant without its
   regenerated fixture is a red suite, and a re-pointed command without its member does not
   typecheck.
   → `feat(git-ipc): open the branch picker on a named tab`
7. **§17's assertions**, once the behaviour they describe is in.
   → `test: cover the branch picker tab fold and its interaction`

### 18.2 One pass, no seam

One Sonnet pass, sequential. There is no genuine seam: commits 2, 3 and 4 all edit
`pickerModel.ts` and `BranchPicker.vue`, and commit 1 is the ground all three stand on. Commit 5 is
the only piece that touches a file the others barely do (`App.vue`), and commit 6 is the only piece
that touches Go — neither is large enough to be worth running concurrently against a tree the other
five are rewriting.

Size: roughly 15 source files, one Go test line, one contract bump. The load-bearing decisions are
four, all in Part A — tabs over collapsible sections (§3), five tabs over four or seven (§4),
filter scope over match quality (§5.2), and pin-before-cap (§6.2). Everything downstream of those
is local.

## 19. Dogfooding note

The repo-map MCP server's tools were not reachable for this planning pass, the same constraint P75
§10 and P76 §14 recorded: this is a subagent session, and `CLAUDE.md`'s own step-3 caveat applies —
the tool manifest is fixed at session start. Navigation was done with Grep/Glob/Read.

**Nothing new is logged in `docs/v1.8/mcp-repo-map-issues.md`.** This pass never called the server,
so it produced no evidence about it; inventing an entry would be the manufactured finding
`CLAUDE.md` warns against.
