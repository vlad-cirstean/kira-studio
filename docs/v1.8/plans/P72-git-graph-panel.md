# P72 — Git graph panel: dropdown removal, rendering/perf/layout, settings relocation

`docs/v1.8/SPEC.md`'s P72 row, turned into concrete steps. Everything below was read in the current
tree (`claude/v1-8-api-git-modules-e2luom` at `20ae8f18`); line numbers are from that tree.

Everything in `packages/git-ui/src/` ships to **both** surfaces — Kira Studio (mounted by
`apps/kira-studio/frontend/src/views/repo/RepoGraphView.vue` through
`repo/git/gitUiModule.ts`) and the VS Code extension (`apps/kira-studio-vscode`). Every item below
therefore states what it does on each surface, and the two items that are genuinely Studio-only
(§7's tab strip, §9's app-wide settings dialog) say so explicitly rather than leaving the VS Code
behaviour to be discovered later.

Three items, one phase:

**A. Remove the repo-switch dropdown.** Delete `RepoPicker.vue` and its `AppToolbar.vue` mount.

**B. Rendering, performance and layout.** Four reported symptoms plus the sticky-graph-tab request.

**C. Settings relocation.** Audit every leaf `RepoSettingsDialog.vue` edits and move what has no
per-repo axis into Kira Studio's app-wide settings, setting by setting.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| Whether anything else consumes `RepoPicker.vue`, or hides a side effect the rest of the app depends on | No. Its one side effect is `repoState.refreshList()` on open; two other call sites already do that independently. It has no other consumer, and deleting it orphans exactly one helper module and one icon constant | §1 |
| What replaces it on each surface | Studio: the left sidebar's repo list. VS Code: the existing `kiraVersion.openRepository` command (`extension.ts:489`/`:717`), plus `NoRepositoryPanel.vue` when no repo is open | §1.2 |
| Whether symptoms (a), (b), (c) share one root cause | **(a) and (b) do; (c) does not.** (a)/(b) are one design property — a valid computed lane layout is discarded wholesale and rebuilt from row 0 — reached by two different triggers (component teardown; a refresh's row-0 chunk). (c) is a different subsystem: SlickGrid's variable-row-height position index going stale against heights the metadata provider has already changed | §2 |
| Whether (a) is fixable on both surfaces | No. Studio's teardown is self-inflicted (`MainView.vue` has no `KeepAlive`) and is fixed. VS Code's is `retainContextWhenHidden: false`, a deliberate memory decision recorded in `panelView.ts:2`-`5`; flipping it is its own decision with its own cost and is out of scope | §3, §10 |
| Whether (c) is fixed blind or traced first | The one *provable* defect in (c) is fixed outright (a missing `invalidateRowHeights()` whose own sibling call site documents why it is needed). The rest is a primary hypothesis with a stated decision rule, traced with P22's own CDP methodology before any runway change | §5 |
| Whether (d) introduces a new appearance setting | **No.** Appearance already flows app-wide through the `--kira-* → --vscode-* → --kv-*` bridge; the badge is simply not on that chain (a literal `10px`). Putting it on the chain adds no knob | §6, §8 |
| What (d) drags in with it | Three latent defects that the current literal sizes hide: no `box-sizing` anywhere in `packages/`, `TokenReader.watch()` observing the wrong element, and `parseFloat` on a `calc()`-valued custom property | §6.2 |
| The sticky graph tab | A layout fix in `TabStrip.vue`: the pinned tab moves into a fixed leading slot outside the strip's own `overflow-x: auto` container, and renders icon-only | §7 |
| Which repo settings move | Two of eleven move outright; one is reclassified in place; the rest stay, each with a stated per-repo reason. Not a blanket move | §8 |
| Whether flipping `instanceWide` is enough for a move | No — and this is the audit's most load-bearing finding. `instanceWide` is a *label*, not a mechanism: the actual cross-repo collapse is hardcoded in Go (`gitreposettings.go`'s `resolveRepoID`/`Get`) and in `RepoSettingsState`'s merge | §8.2 |
| Tests | None new. §12 names the one candidate and declines it, with reasons | §12 |
| One Sonnet pass or a split | One, with two clean seams (after §1, and between §7 and §8) | §13.2 |

---

# Part A — the repo-switch dropdown

## 1. Confirmed current state

### 1.1 Every reference, and what each becomes

| # | Reference | Fate |
|---|---|---|
| 1 | `packages/git-ui/src/components/RepoPicker.vue` (149 lines) | Deleted |
| 2 | `AppToolbar.vue:62` — `import RepoPicker from './RepoPicker.vue'` | Deleted |
| 3 | `AppToolbar.vue:281` — `<RepoPicker :repo-state="repoState" @repo-opened="…" />` | Deleted |
| 4 | `AppToolbar.vue:86` — `(event: 'repo-opened', repoId: string): void` | Deleted: line 281 was its only emitter |
| 5 | `App.vue:1453`, `App.vue:1492` — `@repo-opened="handleRepoOpened"` on the two `<AppToolbar>` mounts | Deleted |
| 6 | `App.vue:1436` — the same binding on `<NoRepositoryPanel>` | **Kept.** A different component with its own `repo-opened` emit; `handleRepoOpened` stays |
| 7 | `packages/git-ui/src/components/repoLabel.ts` | Deleted — `RepoPicker.vue:19` is its only importer (verified by grep over `packages/` and `apps/`, excluding `dist/`) |
| 8 | `icons/index.ts:41` — `STATE_ICONS.check` | Deleted — `RepoPicker.vue:99` is its only consumer |
| 9 | `icons/index.ts:35` — the `STATE_ICONS` doc comment naming `RepoPicker.vue` | Reworded to name the panels that remain |

`STATE_ICONS.repo`/`chevronDown` are each still used elsewhere (`NoRepositoryPanel.vue:31`;
`BranchPicker.vue:366`, `review/BaseSelector.vue:123`) and stay. `STATE_ICONS.openFolder` already
has no consumer in this tree — a pre-existing orphan, **left alone**: deleting it is unrelated to
this row and would make the diff argue for something it wasn't asked to.

No test, spec or fixture references `RepoPicker` (grep over the whole tree, `node_modules` and
`dist/` excluded). `NoRepositoryPanel.vue:4`, `repoLabel.ts:2` and
`apps/kira-studio-vscode/src/ports/workspaceRoots.ts:16` mention it only in prose; the first two
files are edited or deleted anyway, the third's comment gets its cross-reference dropped.

### 1.2 The side-effect audit — the thing the SPEC row asked to confirm before deleting

`RepoPicker.vue`'s entire script is a popup: an `isOpen` ref, a document `pointerdown` closer, a
computed trigger label, and two handlers. **Its only side effect on anything outside itself is
`props.repoState.refreshList()` at `:41`**, inside `toggle()`, on the open transition.

Nothing depends on that call happening here:

- `NoRepositoryPanel.vue:20` calls `props.repoState.refreshList()` itself.
- `App.vue:1071` calls `await repo.refreshList()` in the bootstrap fallback and then reads
  `repo.candidates.value` at `:1072`.

So `repo.list`, `RepoState.refreshList()` and `RepoState.candidates` all stay — they have two live
consumers without this component. `state/repo.ts` is not touched at all.

`selectCandidate()` (`:49`) performs `repoState.open(...)` and emits; that is the switch path
itself, which is what this item removes, not a side effect that outlives it.

### 1.3 The behavioural consequence, stated rather than discovered later

`RepoPicker.vue`'s own doc comment (`:6`) claims it "is the *only* way to switch repositories
(G-UX D4)". That is true **inside the git-ui bundle** and false for either shipped surface:

- **Kira Studio**: repo workspaces are opened from the app's own left sidebar; the graph tab is a
  pinned tab *of* a repo workspace (`tabKinds.ts:410`-`424`, `pinned: true`). A repo switch is a
  workspace switch and was never this dropdown's job here. `C10-git-graph-native.md:786` already
  records that Studio does not mount `RepoPicker.vue`'s sibling panel for the same reason.
- **VS Code**: `kiraVersion.openRepository` (`extension.ts:489`, implemented at `:717`-`760`) is a
  contributed command that calls `repo.open` directly. A multi-root workspace with two repos can
  still switch through it. `NoRepositoryPanel.vue` still covers the no-repo state.

That is the full replacement story. Nothing in this item needs a new affordance.

---

# Part B — rendering, performance and layout

## 2. Root cause, before any fix

The SPEC row asks whether (a), (b) and (c) share one cause. Read in full:
`state/graphView.ts`, `state/packedStream.ts`, `graph/layoutStore.ts`, `graph/layoutClient.ts`,
`graph/layout.worker.ts`, `graph/graphColumn.ts`, `graph/geometry.ts`, `components/CommitGrid.vue`,
`components/columns.ts`, `apps/kira-studio/frontend/src/views/repo/RepoGraphView.vue`,
`apps/kira-studio/frontend/src/workbench/panels/MainView.vue`,
`apps/kira-studio-vscode/src/panelView.ts`.

**Verdict: (a) and (b) share one root cause. (c) is separate.**

### 2.1 The shared cause behind (a) and (b)

The graph's lane layout is treated as disposable. There is exactly one way to change it —
`LayoutStore.append(chunk)` — and it asserts contiguity from row 0
(`layoutStore.ts:171`-`175`: *"chunks must be appended contiguously and in order"*). There is no
update-in-place path and no second buffer. So the only way to change what the graph shows is
`GraphViewState.#resetLayout()` (`graphView.ts:373`-`377`):

```ts
#resetLayout(): void {
  this.layout.clear();        // rowCount -> 0, laneCount -> 0
  this.#layoutClient.reset(); // frontier dropped, in-flight submits marked stale
  this.laneCount.value = 0;
}
```

…followed by a full re-stream from row 0 and one worker round trip per chunk
(`graphView.ts:399`: `await this.#layoutClient.submit(...)`).

Both symptoms are that reset, reached two different ways:

**(a) "reloads every time its tab regains focus."** `MainView.vue:19` is

```vue
<component :is="TAB_VIEWS[activeTab.kind]" v-if="activeTab" :key="activeTab.id" :tab="activeTab" />
```

— `v-if`, no `KeepAlive`, no `v-show`. Switching tabs destroys the view component.
`RepoGraphView.vue`'s `onUnmounted` then calls `handle.unmount()`, and its own comment states the
consequence plainly: *"A mere tab switch away, not a workspace close — git-ui's own AppRoot/App.vue
instance is torn down."* On return, `onMounted(() => void mountGraph())` builds a brand-new
`GraphViewState`, whose `LayoutStore` and `LayoutClient` start empty by construction.

The *data* side of that remount is already cheap — `App.vue:1060`'s
`graphView.openStream(repoId)` resumes from the host's cached rows, and its own comment says so
(*"that single round trip is the whole of 'rehydrates without re-running git'"*). It is the
**layout** side that has no rehydration: every chunk is re-submitted to the worker, `LayoutStore`
re-appends every chunk, and `CommitGrid.vue`'s `loadedRows` watcher (`:769`-`774`) calls
`updateRowCount()` once per chunk, which under `enableVariableRowHeight: true` (`:645`) rebuilds
SlickGrid's whole row-position index each time (`ensureRowPositionIndexer`, rebuilt "when the
indexed row count no longer matches the dataset length"). That is the reload the user sees.

**(b) "checking out a branch/commit disaligns the graph, then it snaps back."** A checkout emits
`repo.changed`/`refsChanged`, which `graphView.ts:103`-`106` subscribes to and turns into an
auto-refresh (`:358`: `await this.refresh()`). `graph.refresh` re-walks and answers a chunk with
`from === 0`; `packedStream.ts:74`-`77` recognises the restart and fires both hooks:

```ts
if (chunk.from === 0 && this.store.rowCount > 0) {
  hooks.onReset?.();   // -> #resetLayout(): laneCount 0, LayoutStore empty
  this.reset();        // -> generation++
}
```

For the window between that line and the worker's answer landing:

- `LayoutStore.rowCount` is 0, so `graphColumn.ts`'s `readSlice` (`:35`-`46`) takes its
  early-return for **every** visible row: `lane: undefined`, `laneCount: layout.laneCount` (now 0).
- `generation` bumped, so `CommitGrid.vue:776`-`782` fires `invalidateAllRows()` +
  `updateRowCount()` + `render()` — every visible row is rebuilt *at the degenerate lane count*.
- But **no column rebuild happens**. `rebuildColumns()` (`:297`-`306`) — the only thing that feeds
  `graphColumnWidth(laneCount)` (`geometry.ts:49`-`55`) into SlickGrid's column model — is not one
  of the calls in that watcher. So the graph column keeps its pre-checkout *width* while its
  contents are drawn for zero lanes, and `computeMessageWidth` (`:208`-`214`) likewise still
  reflects the old width. That is the disalignment.
- When the first chunk's layout resolves, `handleChunkLayout` (`:505`-`511`) sees
  `laneCount !== lastRebuiltLaneCount` and calls `rebuildColumns()`. That is the snap-back.

Same defect, two triggers: a layout that is still perfectly valid on screen is thrown away before
its replacement exists.

### 2.2 Why (c) is not the same bug

Two independent reasons it cannot be:

1. `graph.loadMore` is **not** scroll-triggered in this app — it is an explicit button
   (`LoadMoreButton.vue:45`). Scrolling an already-loaded history touches neither `#resetLayout`
   nor `generation`. A flicker during plain scrolling therefore cannot be the §2.1 defect.
2. The (c) class of symptom has a distinct, concrete, provable cause of its own in this file.

`getItemMetadata` → `columns.ts`'s `rowMetadata` (`:318`-`330`) returns a **per-row `height`**,
taller when the row carries a ref or PR badge (`rowHasBadges`, `:307`-`316`, which reads
`ctx.prsFor(sha)`). SlickGrid's contract for that is explicit:

> `invalidateRowHeights()` — *"Call this after the values driving `rowHeightProvider` (or, with the
> default provider, the item metadata heights) have changed without a change in row count."*

`CommitGrid.vue` honours that contract in exactly one place — the token-change listener at `:743`,
whose own comment names the rule: *"the token driving `rowHeightProvider` … just changed for every
row that has one, without a row-count change — exactly the case `invalidateRowHeights`'s own doc
comment calls out."*

**The `pr.generation` watcher (`:798`-`804`) is the same case and does not call it.** A PR
resolution landing flips rows from the compact height to the expanded one; the watcher calls
`invalidateAllRows()` + `render()` only, so the rows are *re-rendered at their new content* while
the position index still holds their old heights. `ensureRowPositionIndexer` will not rebuild
either, because the row *count* has not changed. With `rowTopOffsetRenderType: 'transform'`
(`:653`), every subsequent scroll paints rows at indexed offsets that no longer match their real
heights — which is what "scrolling flickers" looks like. PR resolution is asynchronous and arrives
while the user is scrolling, which is exactly when the symptom is reported.

That is a separate subsystem (SlickGrid's position index) from §2.1's (git-ui's `LayoutStore`), so
(c) gets its own fix and its own verification.

**(d)** — badge font size — is cosmetic and shares nothing with the other three; see §6.

## 3. Fix (a): stop tearing the graph down on a tab switch

**Studio only.** `MainView.vue:19` gains a `KeepAlive` with an explicit `include`, not a blanket
one:

```vue
<KeepAlive :include="KEEP_ALIVE_VIEWS" :max="KEEP_ALIVE_MAX">
  <component :is="TAB_VIEWS[activeTab.kind]" v-if="activeTab" :key="activeTab.id" :tab="activeTab" />
</KeepAlive>
```

- `KEEP_ALIVE_VIEWS = ['RepoGraphView']` — one entry. A blanket `KeepAlive` would silently change
  the lifetime of every data grid, console and stream tab in the app; that is a different phase's
  decision and would not be justified by this row.
- `<script setup>` gives a component no `name`, so `RepoGraphView.vue` adds
  `defineOptions({ name: 'RepoGraphView' })`. Without it `include` matches nothing and the change
  is a silent no-op — the single most likely way to "fix" this and ship nothing.
- `:max` bounds the cache. The graph tab is `pinned: true` and there is at most one per repo
  workspace (`tabKinds.ts:410`), so the realistic ceiling is the number of open repo workspaces; a
  small explicit `max` makes that a guarantee rather than an assumption.

`RepoGraphView.vue` then distinguishes deactivation from destruction:

- `onActivated` / `onDeactivated` replace nothing — the mount is *not* torn down on deactivate.
- `onUnmounted` keeps today's `handle?.unmount()`: a closed tab, or a `:max` eviction, still
  disposes. This is what keeps the transport lease discipline (`P67b §2.1`, quoted in that file's
  own comment) intact.
- `onMounted`'s `void mountGraph()` stays; with `KeepAlive` it runs once per cached instance.

**Reactivation sizing.** While deactivated, Vue detaches the subtree; on reactivate the *same* DOM
nodes are reinserted, so SlickGrid's viewport `scrollTop` and its canvas survive. The grid's
`ResizeObserver` (`CommitGrid.vue:725`-`726`) fires on reinsert and `scheduleResize` runs
`resizeCanvas()` + `rebuildColumns()` (`:523`-`524`). **Verify this during implementation rather
than assume it** — a detached element reports zero size, and whether the observer delivers the
0 → N transition is the one thing here that a reading of the code cannot settle. If it does not
fire, the fallback is one line of new surface: `MountHandle` (`main.ts:21`-`23`) gains
`refresh(): void` that forwards to the grid's existing resize path, and `onActivated` calls it.
Prefer the observer; add the method only if the trace shows it is needed.

**VS Code is unaffected and deliberately so.** `panelView.ts:2`-`5`: *"`retainContextWhenHidden` is
deliberately left off — W9's rehydration exists precisely so we do not pay for it — so
`resolveWebviewView` runs again on every hide/reveal."* That is a platform-level teardown of the
entire webview, not a Vue lifecycle decision, and flipping it trades memory for this; it is listed
in §10 as out of scope with that reason, not silently skipped.

## 4. Fix (b): do not discard a valid layout before its replacement exists

The refresh path resets, then rebuilds. The fix is to make the reset **not observable**: hold the
previous layout on screen until the replacement's first chunk has landed, and swap in one step.

In `GraphViewState`:

- `#resetLayout()` stops being called from `packedStream`'s `onReset` hook. Instead, `#applyChunk`
  performs the reset **after** `await this.#layoutClient.submit(...)` resolves for the restarting
  chunk, immediately before `this.layout.append(layoutChunk)` — so `LayoutStore.clear()` and
  `append()` happen in the same synchronous block, and `laneCount` never passes through 0.
- The `LayoutClient.reset()` half must still happen *before* the submit — its whole job is to drop
  the stale frontier and invalidate in-flight responses (`layoutClient.ts:51`-`54`), and submitting
  a restart against a stale frontier would produce a wrong layout, which is worse than a flicker.
  So the two halves separate: `#layoutClient.reset()` stays on the `onReset` hook;
  `layout.clear()` + `laneCount` move to the post-await block. `LayoutStore.clear()` has no
  ordering relationship with the worker, so this is a safe split, and `LayoutClientStaleError`
  (`:123`) already covers a response that races a second reset.
- `PackedStream.reset()`'s `generation` bump (`packedStream.ts:61`-`67`) stays where it is: the
  *commit rows* genuinely are gone at that instant and the grid must not render stale text. The
  window where rows are present but layout is not is exactly the window `readSlice`'s
  `row >= layout.rowCount` early-return (`graphColumn.ts:35`) already handles — with this change it
  shrinks to at most one frame instead of a whole worker round trip.

Second, the missing column rebuild. `CommitGrid.vue`'s `generation` watcher (`:776`-`782`) calls
`invalidateAllRows()` + `updateRowCount()` + `render()` but never `rebuildColumns()`, even though a
generation bump is precisely a moment when `laneCount` may have moved. Adding a
`rebuildColumns()`-if-lane-count-changed there — the same guard `handleChunkLayout` already uses at
`:507`, so the `lastRebuiltLaneCount` gate that G32 finding #7 introduced is preserved, not
reverted — closes the residual case where the new history's lane count differs from the old one.

This fix is in `packages/git-ui/`, so **both surfaces get it.**

## 5. Fix (c): the row-position index

### 5.1 The provable half — fixed outright

`CommitGrid.vue:798`-`804`, the `pr.generation` watcher, gains `grid?.invalidateRowHeights()`
before `invalidateAllRows()`. Justification is §2.2's: `rowMetadata` (`columns.ts:318`-`330`)
derives `height` from `rowHasBadges`, which reads `prsFor`; the row count does not change, so
nothing else rebuilds the index; and the sibling call site at `:743` documents this exact contract.

Audited alongside it, so the change is a considered set rather than one patch:

| Watcher | Can it change a row's height? | Verdict |
|---|---|---|
| `selection.row` (`:759`) | No — `rowMetadata` only adds `kv-row-selected` to `cssClasses` | Unchanged |
| `loadedRows` (`:769`) | Count changes; `updateRowCount()` rebuilds the index by itself | Unchanged |
| `generation` (`:776`) | Count changes; same | Unchanged (but see §4's column rebuild) |
| `search.searchGeneration` (`:788`) | No — highlighting only, inside the existing message line | Unchanged |
| **`pr.generation` (`:798`)** | **Yes — `rowHasBadges` reads `prsFor`** | **Add `invalidateRowHeights()`** |
| `stack.generation` (`:807`) | No — stack state changes badge *styling* (`.kv-badge-branch--stacked/--stale`), never badge presence, and `rowHasBadges` does not consult it | Unchanged |
| `detailOpen` (`:820`) | Column set changes, not heights; `rebuildColumns()` → `resizeCanvas()` re-renders | Unchanged |
| `dateFormat` (`:827`) | No — one cell's text | Unchanged |

§6 adds a ninth caller of `invalidateRowHeights()` for a different reason (the badge row track
grows); it lands with §6, not here.

### 5.2 The unproven half — trace before changing

If §5.1 does not fully resolve the reported flicker, the secondary hypothesis is render runway.
SlickGrid's stock buffer is `minRowBuffer: 3` (`CommitGrid.vue:652`) — three rows either side —
and `graphColumn.ts:92` builds a **fresh SVG per row per render pass**, so a fast fling can outrun
the renderer and paint a partially-populated viewport.

This app has already root-caused and fixed exactly this class of symptom in its own data grid.
`apps/kira-studio/frontend/src/views/shared/slick/kiraSlickGrid.ts:114`-`116` states the comparison
directly: *"SlickGrid's own runway (F4) is smaller than this app's at rest — 3 rows/side
(`minRowBuffer`) against this app's 560px (≈20 rows/side) — and not velocity-scaled in motion."*
That file carries the whole P22 apparatus: a velocity-scaled runway, a per-render cell budget, and
a catch-up render gated on scroll quiescence plus a per-frame scroll-sequence gate.

**Decision rule, so this does not become an open-ended optimisation:**

1. Land §5.1. Re-check the symptom on a repo large enough to fling (this repo's own history
   suffices) with PR resolution enabled.
2. If it persists, trace it under CDP the way P22 did — record a fling, look at whether the frames
   show *blank* rows (renderer outrun → runway) or *mispositioned* rows (index → §5.1 was
   incomplete).
3. Blank rows → raise `minRowBuffer` in `CommitGrid.vue` first; that is one number and is reversible.
   Only if that is insufficient does adopting `KiraSlickGrid`'s velocity-scaled runway become
   justified — and that is a **separate phase**, not this one: that class lives in
   `apps/kira-studio/frontend/`, which `packages/git-ui/` may not import, so adopting it means
   either hoisting it into a shared package or duplicating it, and neither is a fix this row asked
   for.
4. Mispositioned rows → the index is still stale somewhere §5.1's table missed; re-derive from
   `rowMetadata`'s inputs rather than adding invalidations speculatively.

**Do not measure for its own sake.** `CLAUDE.md`'s rule is to measure only when a concrete question
is at stake; here the concrete question is exactly step 2's blank-vs-mispositioned, and nothing
else in this phase needs a trace.

## 6. Fix (d): branch/tag labels match the commit-message text

### 6.1 Confirmed current state

The badge strip and the message subject sit in one grid cell but on unrelated type scales:

| Element | Current | Where |
|---|---|---|
| `.kv-badge` | `font-size: 10px`, `height: 16px`, `line-height: 16px`, `border: 2px solid transparent` | `CommitGrid.vue:1190`-`1201` |
| `.kv-badge-icon` | `font-size: 11px` | `:1222`-`1224` |
| `.kv-badge-current-glyph` | `font-size: 9px` | `:1296`-`1298` |
| `.kv-cell-message` (subject text) | `font-size: var(--kv-font-size)` — 13px under VS Code's default, 12px under Studio's | `:955`, `theme/vscode-tokens.css:144` |
| `.kv-cell-message` tracks | `grid-template-rows: 0 18px`; with badges, `16px 18px` | `:1122`-`1132` |
| `--kv-row-height` / `-compact` | `36px` / `20px`, literals | `theme/density.css` |

So the label is three points smaller than the text beside it, by literal, on both surfaces. The
existing comment at `:1113`-`1115` documents the arithmetic the literals encode: `16px`+`18px`
plus padding equals `--kv-row-height`'s `36px`.

### 6.2 What the fix drags in — three latent defects the literals were hiding

**(i) No `box-sizing` anywhere in `packages/`.** Verified by grep across every `.css`/`.vue` under
`packages/`: zero matches. `.kv-badge` therefore already occupies `16 + 2 + 2 = 20px` inside a
`16px` grid track. It is not visible today because the track's sibling row and the cell padding
absorb it; it becomes visible the moment the badge grows. Fix: `box-sizing: border-box` on
`.kv-badge` specifically — **not** a package-wide reset, which would change every SVG-sized element
in `graph/` and is far outside this row.

**(ii) `TokenReader` reads one element and watches another.** `readTokens.ts:48` reads from
`document.documentElement`; `readTokens.ts:80` observes `document.body`. Under VS Code that is
harmless — VS Code mutates `<body>`'s class on theme switch, which is what the comment describes.
Under Kira Studio it is a real gap: `apps/kira-studio/frontend/src/state/settings.ts:19`-`28`
(`applyAppearance`) writes `--kira-font-size` onto `document.documentElement.style`. A live
Appearance font-size change therefore never notifies `CommitGrid.vue`'s listener, so the grid's row
height and its measured date-column width both stay sized for the old font until the next remount.
Fix: `watch()` observes `this.#target` **as well as** `body` — one `MutationObserver` called twice,
not two observers, and no signature change for the VS Code call path.

**(iii) `parseFloat` on a `calc()`-valued custom property returns `NaN`.** For an unregistered
custom property, `getComputedStyle().getPropertyValue()` substitutes `var()` references but does
**not** evaluate `calc()`. `--kv-row-height` is a plain `36px` literal today, so
`rowHeightPx`/`compactRowHeightPx` (`readTokens.ts:115`, `:127`) work. The moment this fix derives
them from the font token, they become `calc(...)` strings, `Number.parseFloat` returns `NaN`, and
both functions **silently fall back to the 36/20 literals** — the change would appear to do nothing
and the CSS would look right while SlickGrid sized every row wrong. This is the trap in this item.

### 6.3 Mechanism

Badge type and box derive from the same token the message text already uses, via the scale that
already exists for exactly this:

- `.kv-badge { font-size: var(--kv-t-md); height: var(--kv-h-xs); line-height: …; box-sizing: border-box }`
  — `--kv-t-md` is `var(--kv-font-size)` and `--kv-h-xs` is `calc(var(--kv-font-size) + 5px)`, both
  from `theme/kira-structure.css:29`/`:36`. At the 13px VS Code default `--kv-h-xs` is 18px, which
  is already the message line's own track height, so the two rows become the same height by
  construction rather than by two coincidentally-equal literals.
- `.kv-badge-icon` and `.kv-badge-current-glyph` move to `var(--kv-t-sm)` / `var(--kv-t-xs)` — they
  are deliberately a step below the label (an icon and a check glyph read as decoration, not text),
  but they now move *with* it instead of staying pinned at 11px/9px.
- `.kv-cell-message { grid-template-rows: 0 var(--kv-h-xs) }`, and with badges
  `var(--kv-h-xs) var(--kv-h-xs)`.
- `density.css`: `--kv-row-height: calc(2 * var(--kv-h-xs) + 2px)` and
  `--kv-row-height-compact: calc(var(--kv-h-xs) + 2px)` — the same `+2px` cell padding the existing
  comment at `CommitGrid.vue:1113`-`1115` already documents. `--kv-row-height-comfortable` has no
  consumer in this tree and is left alone.

**And, mandatorily paired with that** (defect iii): `readTokens.ts` stops parsing length tokens out
of a computed string and measures them instead, using this component's own existing precedent — the
live `.kv-cell-date` probe (`dateFormat.ts:24`, `measureAbsoluteDateWidth`). A hidden probe element
with `height: var(--kv-row-height)`, read through `getBoundingClientRect().height`, gives a real
resolved pixel value with no `@property` registration and no browser-support question on either
surface. `--kv-font-family` stays a string read; only the three length tokens change path.

Then `invalidateRowHeights()` at the token-change listener (`:743`) — already there — does the rest.

## 7. The sticky graph tab

**Studio only.** `TabStrip.vue:255`-`266` is one flex row with `overflow-x: auto`, and
`tabs` (`:129`) is `tabsForWorkspace(...)`, which returns *pinned first, then the rest*
(`state/mode.ts:87`-`95`). The pinned graph tab is therefore inside the scrolling container and
scrolls away with everything else — the reported behaviour.

The request is that it not scroll, that it show only its git icon, and that the tab bar begin after
it. The fix is structural, not a `position: sticky` patch (sticky inside a `scrollbar-width: none`
flex row with `gap` is fragile and still participates in the scroll width):

- The template splits `tabs` into two computeds — `pinnedTabs` and `scrollingTabs` — using the same
  `isPinned(tab)` predicate already defined at `:25`-`27`. `tabsForWorkspace`'s partition is
  unchanged; this only stops flattening it back into one list.
- `pinnedTabs` render in a new fixed leading slot, a sibling of `.tab-strip` and outside its
  `overflow-x`, inside a wrapper that is the actual flex row. `.tab-strip` keeps its wheel handler,
  hidden scrollbar and `scrollIntoView` watch, all of which now operate only on the scrolling half.
- A pinned tab renders **icon-only**: `CodiconIcon` plus the accessible name. `titleFor(tab)` moves
  from the visible span to the tooltip/`aria-label`, so the repo name is still reachable but the
  chrome is one glyph. `tabKinds.ts:412`-`414`'s `title` is unchanged — this is a rendering
  decision in the strip, not a registry change.
- A thin separator between the fixed slot and the strip is what makes "and after it the tab bar
  begins" visible.

`is-empty` (`:251`, `:330`) currently covers "no tabs at all". In a repo workspace the pinned tab
always exists, so the empty branch is now reachable only when `scrollingTabs` is empty while a
pinned tab is present — the wrapper must keep its height in that case, which is what that branch
already exists to do. The `v-if="tabs.length > 0"` condition moves to the wrapper.

Nothing here touches `TAB_KINDS`, `tabsState`, drag-reorder (a pinned tab is already
`:draggable="false"`, `:210`) or the pinned context menu (`:71`-`82`).

---

# Part C — settings

Planned last, per the SPEC row's own sequencing, because §6 is the item that could have introduced
a new appearance knob. **It does not** — see §8.1 — so this part's scope is exactly what exists
today.

## 8. The audit

### 8.1 What §6 changes about this part: nothing

Appearance already reaches git-ui app-wide, through a token bridge, without any per-repo setting:

`SettingsDialog.vue` Appearance → `settings.ts:19`-`28` writes `--kira-font-size` /
`--kira-font-family` on `documentElement` → `tokens.css:139`-`141` derives `--kira-t-*` →
`theme/vscode-bridge.css:93`-`96` maps `--vscode-font-family`/`--vscode-font-size` onto them →
`git-ui/src/theme/vscode-tokens.css:144` maps `--kv-font-size` onto *that* →
`kira-structure.css:27`-`40` derives the whole `--kv-t-*`/`--kv-h-*` scale.

§6's fix is precisely *putting the badge onto that chain* (it is currently off it, at a literal
`10px`). So it adds no setting, no leaf, and nothing to relocate. The §6.2(ii) fix is what makes
the existing app-wide control actually take effect live in the graph.

### 8.2 The finding that decides how a move is implemented

**`instanceWide` is a label, not a mechanism.** `schema.ts`'s own comment says a `true` value means
the stored value is shared installation-wide, "a reserved sentinel row, not a schema change". The
implementation is hardcoded in two places, neither of which reads the flag:

- `apps/kira-studio/internal/storage/repos/gitreposettings.go` — `resolveRepoID` maps
  `logLevelSettingKey` to `sentinelRepoID = ""`, and `Get` performs a second
  `selectAllFor(sentinelRepoID)` for that one leaf by name.
- `packages/git-ui/src/state/repoSettings.ts:57`-`64` — the cross-repo merge reads
  `event.settings['kiraVersion.log.level']` as a string literal.

So "just flip `instanceWide` on another key" **does not work**: the flag would be true and the
storage would still scope the value by `repoId`. Any move that lands on this mechanism must first
make those two sites schema-driven (`SETTINGS[key].instanceWide`, over `repoSettingKeys()`) rather
than key-literal. That is a real, bounded piece of work, and it is a precondition, not a detail.

### 8.3 Second finding: a relocation removes the setting from VS Code

`SettingsDialog.vue` and `packages/shared/domain/settings.ts` are Kira Studio's. The VS Code
extension has no app-wide settings dialog; for a `source: 'repo'` key, `RepoSettingsDialog.vue`
**is** the only surface (`toVsCodeConfiguration()` skips every key with a `source`, so these keys
are not in `contributes.configuration` either). Relocating a control into Studio's dialog therefore
*deletes it* from VS Code unless the git-ui dialog keeps rendering it there.

git-ui already has the seam for that: `MountOptions.host: HostKind` (`main.ts:28`), and
`RepoGraphView.vue` passes `host: 'kira'` while the extension passes `'vscode'`. So a relocated
control is host-conditional in `RepoSettingsDialog.vue` — hidden under `'kira'` (Studio owns it
app-wide), shown under `'vscode'` — rather than deleted. `App.vue` already threads `host` down; the
dialog needs it as a prop.

### 8.4 Setting by setting

All eleven `source: 'repo'` leaves (`schema.ts`, enumerated by `repoSettingKeys()`), plus the one
non-schema leaf the dialog edits. "Per-repo axis" means: is there a defensible reason two
repositories on this machine should hold different values?

| # | Setting | Dialog section | Per-repo axis? | Verdict |
|---|---|---|---|---|
| 1 | `dateFormat` (not in `SETTINGS`; lives in `PersistedViewState`, `viewState.ts:54`) | Display | **No.** Relative-vs-absolute timestamps is a reading preference about the person, not the repository — the same class as `appearance.fontSize` | **Move** to `appearance.dateFormat` in `packages/shared/domain/settings.ts`. The only genuinely appearance-class leaf this dialog holds. See §9.1 |
| 2 | `kiraVersion.log.level` | Diagnostics | **No** — and the codebase already says so (`instanceWide: true`, and a user-visible note in the dialog). It is the verbosity of one process's own diagnostic log | **Move** to `advanced.gitLogLevel`. It is already installation-wide in intent; relocating it puts it where installation-wide settings actually live and lets §9.2 delete the sentinel-row special case outright. See §9.2 |
| 3 | `kiraVersion.graph.pageSize` | Graph | **Yes.** 5000 commits is a different proposition on a 300-commit repo than on a kernel-sized one; the whole point of the knob is matching page size to history size | Stays per-repo |
| 4 | `kiraVersion.graph.scope` | Graph | **Yes.** "all refs" vs "HEAD's ancestry" is a statement about a repository's branching shape | Stays per-repo |
| 5 | `kiraVersion.stash.showInGraph` | Stash | **Yes.** Its own description records that off "drops `refs/stash` entirely" from the walk — it changes what the walk returns, not how it looks. A repo the user stashes heavily in and one they never stash in genuinely differ | Stays per-repo. *Borderline, and deliberately so*: it sits closest to "look", but it is a walk-input, and moving a knob that changes query results is not what this row asked for |
| 6 | `kiraVersion.stash.includeUntracked` | Stash | **Yes.** Its description ties it to collision risk on pop, which is a function of the repo's own `.gitignore` and working tree | Stays per-repo |
| 7 | `kiraVersion.checkout.autoStash` | Checkout | **Yes.** Read client-side only (`schema.ts`'s G28 D16 comment), and it governs a *write* to a specific working tree | Stays per-repo |
| 8 | `kiraVersion.pull.strategy` | Pull | **Yes.** `"auto"` explicitly defers to that repo's own `branch.<name>.rebase`/`pull.rebase` config; a global override would contradict per-repo git config | Stays per-repo |
| 9 | `kiraVersion.review.baseCandidates` | Branch review | **Yes.** `['main','master']` is a per-repo naming convention | Stays per-repo |
| 10 | `kiraVersion.github.enabled` | GitHub | **Yes.** Its description is explicitly scoped: "for this repository". Not every repo has a GitHub remote | Stays per-repo |
| 11 | `kiraVersion.worktree.prepareScript` | (not rendered in the dialog today) | **Yes**, emphatically. A shell command run in a specific tree, guarded by a sha256-pinned approval the extension cannot even name | Stays per-repo. **Never** relocate: a machine-wide script is a different security proposition |
| 12 | `kiraVersion.worktree.basePath` | (not rendered in the dialog today) | Arguable. A per-machine worktree root is plausible | Stays per-repo. "Arguable" is not "no legitimate axis", and this row's instruction is to move what has *no* per-repo reason. Moving it would also be moving a field the dialog does not currently show, which is scope the row did not ask for |

**Two move, one is reclassified where it sits, nine stay.** Note what is *not* on the move list: no
colour, no graph density, no lane palette. The dialog holds none — `palette.ts` and `density.css`
are CSS token layers with no user-facing control at all, and §8.1's bridge already makes them
follow Studio's own Appearance section. The premise that this dialog is full of appearance settings
turns out to be false; saying so is more useful than manufacturing a larger table.

## 9. The relocations

### 9.1 `dateFormat`

- `packages/shared/domain/settings.ts`: `appearanceSettingsSchema` gains
  `dateFormat: z.enum(['relative','absolute']).default('relative')` — the same `.default(...)`
  discipline as `wordWrap`/`rowColoring`/`inlineBlame`, so an existing stored row hydrates to
  today's behaviour. `defaultSettings.appearance` gains the matching entry.
- `SettingsDialog.vue` Appearance gains the control.
- `apps/kira-studio/frontend/src/views/repo/RepoGraphView.vue` passes the value into `mount()` — a
  new optional `MountOptions` field with the same "defaults to today's behaviour when absent"
  shape as `view`. `App.vue` prefers it over `PersistedViewState.dateFormat` when present.
- `RepoSettingsDialog.vue`'s Display section becomes host-conditional per §8.3: rendered under
  `'vscode'`, hidden under `'kira'`. With Display empty under Studio the section header hides too.
- `PersistedViewState.dateFormat` **stays at version 6** and is not removed: it is still the VS Code
  surface's own storage. No version bump, therefore no discard-whole migration
  (`viewState.ts:120`-`130`).

### 9.2 `kiraVersion.log.level`

This is the one that pays off §8.2. Because it is the *only* `instanceWide: true` key, relocating
it lets the special case be deleted rather than generalised:

- `packages/shared/domain/settings.ts`: `advancedSettingsSchema` gains
  `gitLogLevel: z.enum(['off','error','warn','info','debug']).default('info')`.
- `SettingsDialog.vue` Advanced gains the control; `RepoSettingsDialog.vue`'s Diagnostics section
  becomes host-conditional (§8.3) and its `logLevelInstanceWide` note (`:133`) goes with it under
  Studio.
- `repoSettings.ts:57`-`64`'s cross-repo merge becomes a plain "different repo → ignore", deleting
  the `log.level` literal.
- `gitreposettings.go`: `resolveRepoID`'s `logLevelSettingKey` branch and `Get`'s second
  `selectAllFor(sentinelRepoID)` are deleted. The sentinel row itself stays readable for any
  already-stored value — deleting rows is a migration this row does not need.
- `schema.ts`: `SettingDef.instanceWide` loses its only user. **Keep the field**, with its comment
  updated to say no key currently sets it — it is a documented schema capability, and removing it
  along with its consumers in the same commit makes a later reintroduction re-derive the design.

Both relocations keep the VS Code surface working through `host`, which is why §8.3 is a
precondition for both and lands first within Part C.

## 10. Deliberately out of scope

- **Flipping `retainContextWhenHidden`** for the VS Code graph view. It would fix (a) there, and it
  is a memory trade recorded as deliberate at `panelView.ts:2`-`5`. Reversing a documented decision
  belongs in its own row with its own measurement, not in a bundle.
- **Adopting `KiraSlickGrid`'s velocity-scaled runway inside git-ui.** §5.2 step 3 — it needs the
  class hoisted into a shared package or duplicated, and only a trace can justify either.
- **A `box-sizing` reset across `packages/`.** §6.2(i) fixes `.kv-badge`; a package-wide reset
  would silently resize the graph SVG column and every dialog in `kira-ui`.
- **Removing `STATE_ICONS.openFolder`** (§1.1) — a pre-existing orphan, unrelated to this row.
- **Moving `worktree.basePath`, `stash.showInGraph`, or any other row 3-12 leaf.** §8.4 states the
  per-repo reason for each; a blanket move is exactly what the SPEC row forbids.
- **Deleting the sentinel `repo_id = ""` rows** from `git_repo_settings` (§9.2).
- **`graph/layout.worker.ts` itself.** SPEC names it as a candidate; the round trip proved not to
  be the cause of anything here (§2.1 — the defect is that the round trip is *re-run needlessly*,
  which §3 and §4 address on the caller side). The worker is not edited.

## 11. Files

Deleted:

| File | Why |
|---|---|
| `packages/git-ui/src/components/RepoPicker.vue` | §1 |
| `packages/git-ui/src/components/repoLabel.ts` | Dead once the above goes (§1.1 #7) |

Modified:

| File | Change |
|---|---|
| `packages/git-ui/src/components/AppToolbar.vue` | Import, `repo-opened` emit, mount removed (§1.1) |
| `packages/git-ui/src/App.vue` | Two `@repo-opened` bindings on `<AppToolbar>` removed (§1.1); `host` threaded to `RepoSettingsDialog` (§8.3); `dateFormat` prefers the mount option (§9.1) |
| `packages/git-ui/src/icons/index.ts` | `STATE_ICONS.check` removed, doc comment reworded (§1.1) |
| `apps/kira-studio-vscode/src/ports/workspaceRoots.ts` | Stale `RepoPicker.vue:33` cross-reference in a comment |
| `apps/kira-studio/frontend/src/workbench/panels/MainView.vue` | Targeted `KeepAlive` (§3) |
| `apps/kira-studio/frontend/src/views/repo/RepoGraphView.vue` | `defineOptions({ name })`, activate/deactivate lifecycle, `dateFormat` mount option (§3, §9.1) |
| `packages/git-ui/src/state/graphView.ts` | `#resetLayout()` split; clear+append in one block (§4) |
| `packages/git-ui/src/components/CommitGrid.vue` | Lane-count rebuild on `generation` (§4); `invalidateRowHeights()` on `pr.generation` (§5.1); badge/track/box-sizing CSS (§6.3) |
| `packages/git-ui/src/theme/density.css` | `--kv-row-height`/`-compact` derived from `--kv-h-xs` (§6.3) |
| `packages/git-ui/src/theme/readTokens.ts` | Probe-measured lengths; `watch()` observes `#target` as well as `body` (§6.2 ii/iii) |
| `apps/kira-studio/frontend/src/workbench/panels/TabStrip.vue` | Pinned tabs in a fixed leading slot, icon-only (§7) |
| `packages/shared/domain/settings.ts` | `appearance.dateFormat`, `advanced.gitLogLevel`, both defaults (§9) |
| `apps/kira-studio/frontend/src/workbench/SettingsDialog.vue` | Two new controls (§9) |
| `packages/git-ui/src/main.ts` | Optional `dateFormat` on `MountOptions`; `MountHandle.refresh()` only if §3's trace demands it |
| `packages/git-ui/src/components/dialogs/RepoSettingsDialog.vue` | `host` prop; Display and Diagnostics sections host-conditional (§8.3, §9) |
| `packages/git-ui/src/state/repoSettings.ts` | `log.level` merge special case removed (§9.2) |
| `packages/git-core/src/settings/schema.ts` | `kiraVersion.log.level` removed; `instanceWide` kept with an updated comment (§9.2) |
| `apps/kira-studio/internal/storage/repos/gitreposettings.go` | `resolveRepoID`/`Get` sentinel branches removed (§9.2) |

`apps/kira-studio/frontend/bindings/` is gitignored and regenerated by the Wails build.
`packages/host-vscode/package.json` is regenerated by `scripts/gen-settings.ts`; removing a
`source: 'repo'` key changes nothing there (`toVsCodeConfiguration()` already skipped it), so the
regenerated file should come out byte-identical — **check that it does**, because a diff would mean
the key was contributed after all.

No new IPC channel. `repoSettings.get`/`set`/`changed` keep their shapes; `RepoSettingsSnapshot`
loses one member, which is a type change every consumer sees at compile time.

## 12. Tests

`CLAUDE.md`'s default is no dedicated unit test, and **this phase needs none.** Asked explicitly
rather than skipped: nothing here is a parser, boundary arithmetic, a cache invalidation, a crypto
path, a concurrency problem, or a decision structure too large to hold in your head. §1 is a
deletion. §3 is a template attribute plus a lifecycle hook. §4 moves two statements across an
`await`. §5.1 adds one method call. §6 is CSS plus a measurement change. §7 is a template split.
§9 is a field on a zod schema and a control in a dialog. The rendering bugs in particular are
exactly the layout/rendering class where a unit test would assert the implementation back at
itself; the real verification is looking at the graph.

**The closest candidate, named and declined:** `readTokens.ts`'s switch from `parseFloat` to a probe
(§6.2 iii). It is a real behavioural change in a function that returns a number, and
`rowHeightPx`/`compactRowHeightPx` have documented fallbacks. It is declined because the probe
requires layout — a jsdom unit test cannot exercise the thing that changed (`getBoundingClientRect`
returns 0 there), so a test would only re-assert the fallback path, which is the half that did not
change. If any existing `state/`-level spec already constructs a `TokenReader`, update it to the
new shape; do not add a file.

**Existing coverage to run rather than extend.** Whatever Playwright specs already drive the repo
graph tab and the tab strip must pass: §7 changes the strip's DOM shape (a pinned tab is no longer a
descendant of `[data-testid="tab-strip-row"]`), so any selector reaching a pinned tab through that
container needs updating — that is a selector fix in an existing spec, not a new test. §9 changes
`RepoSettingsSnapshot`'s member list, so any settings fixture carrying `kiraVersion.log.level`
needs it removed.

Fast checks per commit: `bun run typecheck`, `bun run lint`, `bun run build`, plus `go build ./...`,
`go vet ./...`, `go test ./...` for the step that touches `gitreposettings.go`.

## 13. Order and sizing

### 13.1 Implementation order

Deletion first (it shrinks the surface every later step reads), then the root-caused fixes in
dependency order, then settings last per the SPEC row.

1. **Delete the dropdown** — `RepoPicker.vue`, `repoLabel.ts`, the `AppToolbar.vue` import/emit/
   mount, the two `App.vue` bindings, `STATE_ICONS.check`, the two stale comments.
   `docs(git-ui)`-adjacent prose only; no behaviour beyond the removal.
   → `refactor(git-ui): remove the repo-switch dropdown`
2. **(b)** — `graphView.ts`'s reset split, plus `CommitGrid.vue`'s lane-count rebuild on
   `generation`. Verify by checking out a branch with a different lane shape and watching for the
   snap.
   → `fix(git-ui): keep the graph layout on screen across a refresh`
3. **(c) §5.1** — `invalidateRowHeights()` on `pr.generation`, and the §5.1 table re-checked
   against the code as it stands after step 2.
   → `fix(git-ui): rebuild row heights when PR badges resolve`
4. **(c) §5.2** — only if the symptom survives step 3. Trace first; then at most `minRowBuffer`.
   Skipping this step because step 3 fixed it is a valid outcome and should be recorded as one.
   → `fix(git-ui): widen the commit grid's render runway` *(conditional)*
5. **(d)** — `readTokens.ts` first (probe + observer target), *then* `density.css` and
   `CommitGrid.vue`'s CSS. In that order: the reverse ships a frame where every row is sized from a
   `NaN` fallback.
   → `fix(git-ui): size ref badges from the shared type scale`
6. **(a)** — `MainView.vue`'s `KeepAlive`, `RepoGraphView.vue`'s `defineOptions` + lifecycle. Last
   of the rendering items so the reactivation path is exercised against the already-fixed grid, and
   so §3's open question (does the `ResizeObserver` fire on reinsert) is answered against final
   code.
   → `perf(repo): keep the git graph mounted across tab switches`
7. **Sticky graph tab** — `TabStrip.vue`.
   → `fix(workbench): pin the graph tab outside the scrolling tab strip`
8. **§8.3's host seam** — `host` prop on `RepoSettingsDialog.vue`, threaded from `App.vue`. Alone,
   changing nothing user-visible, so step 9's diff is only the relocation.
   → `refactor(git-ui): thread host into the repo settings dialog`
9. **§9.1 `dateFormat`**, then **§9.2 `log.level`** (Go and TypeScript together — a half-applied
   §9.2 leaves the sentinel logic reading a key that no longer exists). `go build/vet/test` green
   before the front end is touched, M2's ordering discipline.
   → `feat(settings): move date format and git log level app-wide`

### 13.2 One pass, two seams

One Sonnet pass. Steps 2-6 are one continuous thread — each reads the same three files and each
later step's verification depends on the earlier ones being in place.

**Seam 1: after step 1.** The deletion is file-disjoint from everything else
(`RepoPicker.vue`/`repoLabel.ts`/`icons/index.ts`/`AppToolbar.vue` versus
`graphView.ts`/`CommitGrid.vue`/`readTokens.ts`), and `App.vue`'s two edits are in different regions
of the file.

**Seam 2: between step 7 and step 8.** Part C shares no file with Part B —
`RepoSettingsDialog.vue`, `repoSettings.ts`, `schema.ts`, `gitreposettings.go`,
`shared/domain/settings.ts`, `SettingsDialog.vue` versus everything above. This is the seam the
SPEC row's own sequencing already implies.

**Never split inside step 5** (a `readTokens.ts` change without the CSS, or the reverse, is a
visibly wrong grid) **or inside step 9** (a TypeScript-only §9.2 leaves Go reading a deleted key).

Size: 2 files deleted, ~18 modified, of which roughly half are removals or one-to-five-line
additions. The three that carry real thought are `graphView.ts`'s reset split (step 2),
`readTokens.ts`'s probe (step 5) and `gitreposettings.go` (step 9).

## 14. Dogfooding note

The repo-map MCP server was built and started per `CLAUDE.md`'s headless steps and called over curl
(the native tool surface does not appear in an agent-harness session). It did real work:
`find_references` on `shortRepoLabel` returned the single `RepoPicker.vue:29` call and settled
§1.1 #7 in one call, and `search_symbols` on `rowMetadata` located `columns.ts:318` — where §2.2's
evidence for (c) actually lives — without opening the file.

**One non-trivial finding is logged in `docs/v1.8/mcp-repo-map-issues.md`**, and it is directly
relevant to §1: `find_references` answers `no references found` for a TypeScript `const` object
that has real reads, including reads in its own file (`GEOMETRY`, `STATE_ICONS`; `TAB_KINDS` and
`SETTINGS` return partial results missing every non-call read). Function references resolve
correctly in the same files, so the gap is specific to non-call reads of a `const`. **Consequence
for whoever implements §1.1: the dead-code column there was verified by grep, not by the MCP
server — do not re-derive it from `find_references`, and do not extend the deletion set on the
strength of a "no references found" answer.** Per this log's own rule, nothing about the server is
fixed in this phase.

One trivial note also logged: the on-disk token file stores only `hash`/`salt`/`expiresAt`, so a
session that has lost the startup banner must delete it and restart to mint a fresh token —
`CLAUDE.md` already documents that remedy, and it worked.
