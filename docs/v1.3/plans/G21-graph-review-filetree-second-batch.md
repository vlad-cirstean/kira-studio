# G21 — Second git-graph / review-panel bug and polish batch

> **What this phase is.** SPEC's G21 row is thirteen findings from a second round of hands-on use of the shipped extension, on top of G19's own already-shipped batch: the graph column (items 1, 3, 4), the graph's columns and detail panel (5, 6), a VS Code setting (7), the review bar (8), the file tree/list shared by both panels (9-13), and one cross-cutting component-library ask (2). The row carries three load-bearing scoping instructions, all of which this document obeys explicitly rather than paraphrasing:
>
> 1. **Items 1, 6 and 8 must be re-verified against current code before any fix.** All three read as identical to G19's D1/D2/D8. §1's F1/F6/F8 below are that re-verification, done by reading the actual shipped files, not G19's plan. **All three of G19's fixes are present and correct.** Two of the three nevertheless have a real, distinct remaining gap that G19 did not and could not have covered (F1's merge-at-HEAD overlap; F6's *unreachable-for-existing-users* default), and one has a real adjacent defect plus a mismatch between the fix G19 shipped and what item 8's own wording asks for (F8). None of the three is re-fixed reflexively; each names precisely what is *not* being touched.
> 2. **Item 13 must reconcile with G19's D8, not revert it.** D13 below is a per-call-site split, designed from the actual call graph: three navigational single-file call sites, one bulk call site, and one new keyboard/double-click distinction.
> 3. **Item 2 must build on G20, not duplicate it.** G20 is now fully implemented and shipped (`17217d96`…`6b5f7e25`). §1 F2 re-surveys what it left behind: dialogs, buttons, filter inputs, native `<select>`s, segmented toggles — and three native `title` tooltips in DOM-builder `.ts` files that G20's `.vue`-only grep structurally could not see.
>
> Every file:line citation below was produced by reading the tree in this container on 2026-09-08, at `6b5f7e25`, working tree clean.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against `claude/feature-v1-3-headless-git` at **`6b5f7e25`** — the tip of G20's six commits (`17217d96` the `kira-ui` floating module, `9f632f99` 61 tooltip migrations + the force-delete popup, `b0b3705e` the 7 dropdowns, `ff809fe1` the CodeMirror escape fix, `f333b25d`/`6b5f7e25` the two geometry test tiers). `packages/kira-ui` exists and exports `KuiButton`, `KuiIconBox`, `KuiTextInput`, `KuiContextMenu`, `KuiPopoverPanel`, `KuiTooltip`, plus `contextMenuModel.ts`, `floatingPosition.ts`, `tooltip.ts` (`packages/kira-ui/src/index.ts`). `CONTRACT_VERSION` is **23** (`packages/git-ipc/src/validate.ts:36`). Working tree clean; no concurrent agent in this worktree.

### 0.2 Scope, and the 1:1 map every item is traceable through

| Area | SPEC items | Findings | Decisions |
|---|---|---|---|
| Git graph rendering | 1, 3, 4 | F1, F3, F4 | D1, D3, D4 |
| Graph columns / detail panel | 5, 6 | F5, F6 | D5, D6 |
| Component library (beyond G20) | 2 | F2 | D2 |
| VS Code settings | 7 | F7 | D7 |
| Review bar | 8 | F8 | D8 |
| File tree / file list | 9, 10, 11, 12, 13 | F9-F13 | D9-D13 |
| Test infrastructure (not a SPEC item) | — | F14 | D14 |

### 0.3 Ground rules

- **Re-verify, don't re-fix.** F1/F6/F8 each state, in one sentence, what G19 already got right and is therefore untouched.
- **Build on G20, don't redo it.** No `title=`/`:title=` in a `.vue` file is revisited; no dropdown, context menu or tooltip that already went through `KuiPopoverPanel`/`KuiContextMenu`/`KuiTooltip` is re-migrated. F2's inventory is strictly the complement of G20's own.
- **`CONTRACT_VERSION` moves 23 → 24, once, for three related additions** (D8's `editor.openAllChanges`, D12's `fallbackSha`, D13's `pinned`) — all additive, no existing method's shape changes. Stated here so it is never discovered in a diff.
- **No Go changes.** Every item lands in `packages/git-core` (D3 only), `packages/git-ui`, `packages/kira-ui`, `packages/git-ipc`, `apps/kira-studio-vscode`. `internal/**`, the FlatBuffers schema and `go test ./...` are untouched.
- **`apps/kira-studio/frontend` is not migrated.** G19's own boundary ("don't turn this into a full design-system migration of either existing frontend") still holds; D2 adds primitives to `packages/kira-ui` and consumes them from `packages/git-ui` only.

---

## 1. Findings

### Git graph

#### F1 (item 1) — Re-verified: G19's HEAD ring is shipped and correct. One real gap remains: a merge commit at HEAD loses its merge ring

**What G19 shipped, confirmed present:**

- `packages/git-ui/src/graph/rowSvg.ts:53-57` — `RowSlice.isHead`.
- `rowSvg.ts:70-71` — `isHeadDecoration(ref)`, `ref.kind === 'head' || (ref.kind === 'branch' && ref.isHead)`, the single source of truth also imported by `components/columns.ts:23` for the row-bold indicator.
- `graph/graphColumn.ts:59` — `isHead: decoration.some(isHeadDecoration)`; `:44` correctly returns `false` for a row past `layout.rowCount`.
- `rowSvg.ts:186-208` — `planNode` appends `headRing` to whichever shapes the node kind already returns; `:229-237` — `buildNodeElement` gives it `class="kv-graph-head-ring"` with no lane class.
- `components/CommitGrid.vue:953-955` — `.kv-graph-head-ring { stroke: var(--kv-focus-border); }`.
- `graph/rowSvg.test.ts` covers the `planNode` HEAD case.

**Nothing here is re-fixed.** The item as G19 scoped it is done and correct.

**The real remaining gap**, found by reading the geometry rather than the plan: `graph/geometry.ts:10-19` defines `nodeRadius: 3.4`, `mergeRadius: 4.2`, `strokeWidth: 1.6`, and `planNode` draws **both** the merge ring (`rowSvg.ts:198-205`) and the HEAD ring (`:189`) at `r: GEOMETRY.mergeRadius` — the same centre, the same radius. For a merge commit that is also HEAD (an extremely common state: `main` right after a merge), the two circles are geometrically identical and the HEAD ring is appended last, so it paints over the merge ring exactly. The row still reads as HEAD, but **the merge indicator silently disappears** — one of the three node shapes §5.3 defines becomes unrenderable in the one state a user is most likely to be sitting in. This is a genuine defect in G19's own fix, not a re-report of the original item.

A second, smaller observation from the same numbers: the HEAD ring spans `4.2 ± 0.8` = `3.4…5.0`, and the ordinary filled dot has `r = 3.4` — the ring's inner edge lands exactly on the dot's edge, so on an ordinary HEAD commit the ring reads as a thick halo fused to the dot rather than as a ring around it.

#### F3 (item 3) — Root-caused: a converging branch's edge terminates in its own lane, in mid-air, one node short of the commit it converges into

This is the item's exact wording ("the beginning of it isn't properly connected to the origin — it hangs there disconnected"), and it is a real, reproducible geometry bug with a single root cause across two files.

**Where the lane is freed but the edge is not redirected.** `packages/git-core/src/graph/lanes.ts:164-171`, step 2:

```ts
// Step 2: every OTHER lane also expecting this row is a sibling child converging here —
// its edge was already emitted (kind decided at that edge's own creation time, see the
// module doc comment); all that remains is to free the lane for reuse.
for (let lane = 0; lane < state.laneCount; lane++) {
  if (lane !== claimedLane && state.openLanes[lane] === row) state.openLanes[lane] = LANE_EMPTY;
}
```

The lane is freed. The **edge that was pointing at this row from that lane is not touched** — it was appended at `lanes.ts:196-203` (parent-0, `EDGE_KIND_STRAIGHT`) with `fromLane === toLane === claimedLane-at-that-time`, i.e. the *branch's* lane, and nothing ever rewrites its `toLane`.

**Where that becomes visible pixels.** `packages/git-ui/src/graph/rowSvg.ts:127-131`:

```ts
const x = laneX(segment.toLane);
const isEnd = segment.toRow !== UNRESOLVED_ROW && row === segment.toRow;
const yTop = -overdraw;
const yBottom = isEnd ? rowHeight / 2 : rowHeight + overdraw;
return `M${fmt(x)},${fmt(yTop)} V${fmt(yBottom)}`;
```

At the convergence row, the segment is drawn as a vertical stub at **`laneX(segment.toLane)` — the branch's own lane** — ending at the row's vertical centre. The commit's node for that row, meanwhile, is drawn at `laneX(slice.lane)` = the *claimed* lane (`graphColumn.ts:51`, `rowSvg.ts:182`). The line and the node are one or more lane-widths apart. The branch's line stops beside the merge base instead of meeting it.

**Worked example** (the canonical `feature` off `main`): rows 0-… on lane 0 (`main`), rows for `feature` on lane 1; `feature`'s oldest commit at row 3 has parent row 5, so `openLanes[1] = 5` and an edge `(fromRow 3, toRow 5, fromLane 1, toLane 1)` is appended. `main`'s row 4 also has parent row 5, so `openLanes[0] = 5`. At row 5, `findExpectingLane` returns lane 0; lane 1 is freed by step 2. The edge from row 3 paints a vertical line at lane 1 all the way to row 5's centre, where nothing is. Exactly the reported symptom.

**`EDGE_KIND_MERGE_IN` already exists and has never been emitted.** `packages/git-core/src/graph/types.ts:45-48` declares `EdgeKind = 0 | 1 | 2` with `EDGE_KIND_MERGE_IN: EdgeKind = 2`; `lanes.ts`'s own module doc (lines 20-25) states plainly: *"`EdgeKind`'s `merge-in` value is not currently emitted by this pass … recorded as a deliberate simplification for a future refinement."* And `rowSvg.ts`'s `edgeCommand` never reads `segment.kind` at all — it branches only on `row === fromRow` vs. `isEnd`. So the data model already has the slot for the fix and the renderer already has the place to spend it; neither has ever been wired.

**Why the redirect cannot simply be decided at edge-creation time**, and why this must be a patch: `lanes.ts`'s own doc comment (lines 9-25) establishes that speculative convergence is *unsound under paging* — whether a shared target is "already known" depends on how much of the store has loaded, so the same topology would lay out differently page-by-page than in one pass. Convergence is discovered only at the target row's own processing. The redirect therefore has to travel the same route the existing `toRow` resolution already travels: `edges.ts`'s cross-chunk patch mechanism (`BuiltEdges.patches`, "`(globalEdgeIndex, toRow)` pairs patching an edge that belongs to an earlier chunk", `edges.ts:76-77`), applied by `layoutStore.ts:230`'s `#applyPatches`.

**A secondary case that is *not* a bug and is explicitly out of scope**: an edge whose parent has not been paged in yet keeps `toRow === UNRESOLVED_ROW` and, per `rowSvg.ts:106-109`, "runs to the bottom of its row and stops". That is the intended pagination affordance, not the reported defect.

#### F4 (item 4) — Ref badges are coloured by decoration *kind*, and have no access to the row's lane colour

`components/refBadges.ts:53-120`'s `badgeSpecFor` assigns `colorClass` from `ref.kind` alone — `kv-badge-local`, `kv-badge-remote`, `kv-badge-tag`, `kv-badge-stash`. There is no lane input anywhere in the module; its only import is `BADGE_ICONS`.

The lane colour for a row is `layout.colorOf(row)` (`graph/layoutStore.ts`), rendered as `.kv-lane-N` (`rowSvg.ts`'s `laneClass`). It reaches the graph column only because `columns.ts`'s own doc comment (lines 7-10) says the graph formatter *"is supplied by the caller (`CommitGrid.vue`) … because it needs a `LayoutStore` and a `CommitStore` closed over per grid instance, which this module … does not hold."* The **message** column's formatter (`columns.ts:70-99`), which is where `buildRefBadges(dataContext.decoration)` is called (`:75`), is built inside `columns.ts` and has no `LayoutStore` at all. So item 4 needs one new, small accessor threaded exactly the way `MessageSearchContext`/`DateFormatterContext`/`ShaCopyContext` are already threaded (`columns.ts:57-61`, `:108-111`, `:131-134`) — an established local pattern, not a new one.

Note also that `buildBadgeElement` sets `badge.title = spec.text` (`refBadges.ts:156`) and `buildOverflowBadge` sets `badge.title = overflow.title` (`:196`) — native browser tooltips. See F2.

#### F5 (item 5) — The SHA column is a real, load-bearing column with five distinct integration points; the details panel shows the sha twice, each with its own copy button

**The column itself**: `columns.ts:37` (`SHA_COLUMN_ID`), `:131-134` (`ShaCopyContext`), `:136-170` (`shaFormatter` — a `<button>` with `tabIndex = -1`, a native `title` at `:153`, a click handler that copies and flashes "Copied"), `:245-255` (the fifth column definition), `:249` (`width: widths.sha`).

**Everything downstream of it**, all confirmed by grep in `components/CommitGrid.vue`: `:45` (`clipboardEnabled` prop, which exists *only* for this button), `:69` (`copySha` emit), `:92`/`:112` (`MIN_COLUMN_WIDTH` and the comment "Positions of the three drag handles (message|author, author|date, date|sha)"), `:152-169` (`focusedShaButton` — a second real tab stop inside the row subtree), `:174` (total non-message width includes `widths.value.sha`), `:198` (the `ShaCopyContext` construction), `:482-518` (`applyAccessibility` promoting exactly the tabbable row's sha button back to `tabIndex 0`, with a long doc comment about the `Tab`-storm race it prevents), `:690-700` (a watch on `clipboardEnabled` to re-render once `app.init` resolves), `:786-798` (the third resize handle's ARIA slider markup), `:875-892` and `:1080-1096` (its CSS, including a selection-colour override). `App.vue:1169` wires `@copy-sha="handleCopySha"`; `App.vue:398`/`:428` are the ref-menu's own separate `copySha`, unrelated.

**The details panel**: `components/CommitMeta.vue:229-256` renders two `<dt>/<dd>` pairs — `SHA` with the full 40-char sha plus a `kv-copy-button`, and `Short SHA` with the 7-char sha plus a second `kv-copy-button`. `:174`/`:178` are their two handlers (`copyFullSha`, `copyShortSha`).

#### F6 (item 6) — Re-verified: G19's date-column fix is shipped and correct, and is **unreachable for every user who ran the app before G19**

**What G19 shipped, confirmed present:**

- `state/viewState.ts:65` — `DEFAULT_COLUMN_WIDTHS: ColumnWidths = { author: 140, date: 152, sha: 80 }` (was 120).
- `components/CommitGrid.vue:1072-1078` — `.kv-cell-date` now carries `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`.

**Nothing here is re-fixed.**

**The real remaining gap.** G19 D2 stated, deliberately and correctly for its own scope: *"MIN_COLUMN_WIDTH and every already-persisted `PersistedViewState` are untouched — this only changes a first-ever mount's seed value."* `PersistedViewState.version` is still `4` (`viewState.ts:30`, and `isPersistedViewStateShape`'s `record.version === 4` check at `viewState.ts:83-104`), and `parsePersistedViewState` accepts any v4 blob whole. So a user who had ever opened the graph panel before G19 landed still has `columnWidths: { author: 140, date: 120, sha: 80 }` in VS Code's `getState()`, and that value keeps winning on every mount, forever. **The default was widened for people who had never used the app; the fix is invisible to exactly the population that reported the bug.** That is the most probable explanation for item 6 reappearing verbatim, and it is a real defect, not a stale build.

**A second, forward-looking gap.** G14 item 5 made the type scale follow VS Code's own font settings rather than a fixed Kira Studio scale. A hard-coded `152` is therefore only correct at one font size: at `editor.fontSize: 16` with a wide UI font, `"2024-03-14 09:41"` (16 characters, `dateFormat.ts`'s `formatAbsoluteDate`) exceeds 152px and the ellipsis G19 added — correctly — hides the overflow rather than showing it. `.kv-cell-date` sets `font-variant-numeric: tabular-nums` but inherits the proportional `--kv-font-family`, so the width is genuinely font-dependent, not computable from a character count.

#### F2 (item 2) — What G20 left: 11 hand-rolled modal dialogs, 3 duplicated segmented toggles, 5 bare filter inputs, 3 native `<select>`s, ~90 raw `<button>`s, and 3 native `title` tooltips G20's own survey structurally could not see

G20's scope was *floating/positioned surfaces* and it closed them completely: 61 `title`/`:title` attributes migrated to `v-kui-tooltip` (`main.ts:73-74` registers the directive), 5 of the 7 anchored dropdowns onto `KuiPopoverPanel` with the other 2 given `computeFloatPosition` directly for stated interaction reasons, `KuiContextMenu`'s clamp replaced with real flip/shift, the force-delete popup positioned for the first time. **None of that is revisited.** What follows is strictly the complement.

**(a) Dialogs — the largest single pocket of duplication left in `packages/git-ui`.** Eleven components in `components/dialogs/` (`BranchDialog`, `CheckoutDialog`, `CherryPickDialog`, `ForcePushDialog`, `PullDialog`, `RenameRefDialog`, `RepoSettingsDialog`, `ResetDialog`, `RevertDialog`, `StashDialog`, `TagDialog`) each hand-build the identical shell:

```html
<div v-if="open" class="kv-modal-backdrop">
  <div ref="rootEl" class="kv-modal" role="dialog" aria-modal="true"
       aria-labelledby="…" @keydown="onKeydown" @keydown.escape="cancel">
    <h2 class="kv-modal-title">…</h2>
    …
    <div class="kv-modal-actions">
      <button class="kv-modal-button kv-modal-button--primary" …>…</button>
      <button class="kv-modal-button" @click="cancel">Cancel</button>
```
(`BranchDialog.vue:58-84`, and structurally identical in the other ten.)

The CSS for that shell is **redeclared globally in at least four files** — `.kv-modal-backdrop`/`.kv-modal` in `CheckoutDialog.vue:121,131`, `CherryPickDialog.vue:186,196`, `ForcePushDialog.vue:145,155`, `ResetDialog.vue:218,228`, and `.kv-modal-button` variants in `CheckoutDialog.vue:168-181`, `CherryPickDialog.vue:233-251`, `RevertDialog.vue:175-186`. These are non-scoped `<style>` blocks in a single bundle, so whichever file loads last wins; the seven dialogs that declare *no* modal CSS depend on one of the other four having been imported. This is the same class of drift `AppToolbar.vue`'s own comment admitted for `.kv-toolbar-button` and G19 D3a closed — it simply was not in G19's scope.

`components/dialogs/modalFocus.ts`'s `useModalFocus` (focus capture, `Tab` trap, focus return) is already the shared, correct half; it is local to `packages/git-ui` and belongs to the shell, not to eleven call sites.

**(b) Segmented toggles — three independent implementations of one control.** `.kv-mode-active` is styled separately in `FileTree.vue:578` (`.kv-file-tree-mode button.kv-mode-active`), `review/ReviewFilesPane.vue:187` (`.kv-review-files-diff-mode button.kv-mode-active`), and `review/ReviewView.vue:1162` (`.kv-review-toolbar-mode button.kv-mode-active`), with a fourth group (`.kv-review-pane-toggle`, `ReviewView.vue:709-741`) using the same class again. Four groups, four CSS blocks, one control.

**(c) Filter/search inputs.** `KuiTextInput` exists (G19 D3a) but is used in exactly **one** place (`ReviewView.vue`). Still raw `<input>`: `FileTree.vue:376-384` (the tree's own filter), `BranchPicker.vue` (×2), `review/BaseSelector.vue`, `SearchResults.vue`, and `SearchBox.vue`'s main query input. `SearchBox.vue` is a genuine exception G19 already reasoned about (a full ARIA combobox with `aria-activedescendant` and regex-error `aria-describedby` wiring bound directly to its own ref) and stays exempt.

**(d) Native `<select>`s, unstyled:** `FileTree.vue:369-373` (the merge-parent picker), `SearchBox.vue` (×2), `RepoSettingsDialog.vue` (×3).

**(e) Raw `<button>`s outside the five files G19 D3a migrated.** ~90 across 33 files (`grep -c '<button'`): `ReviewView.vue` 10, `BranchPicker.vue` 8, `DiffView.vue` 7, `StashDialog.vue` 6, `ReviewCommentsPane.vue` 5, `CommitMeta.vue` 5, `FileTree.vue` 5, `BaseSelector.vue` 4, `ConflictBanner.vue` 4, `App.vue` 4, and the rest 1-3 each. `.kv-copy-button` — used by `FileTree.vue` (×3) and `CommitMeta.vue` (×2) — is defined once, in `CommitMeta.vue:395-407`, i.e. a component-crossing dependency on one file's private style block.

**(f) Three native `title` tooltips G20 could not have found.** G20's F1 counted `title="|:title="` **in `.vue` files only**. Three DOM-builder assignments in `.ts` files were structurally invisible to that grep and are still real browser tooltips today:

- `components/refBadges.ts:156` — `badge.title = spec.text` (every ref badge in the graph).
- `components/refBadges.ts:196` — `badge.title = overflow.title` (the `+N` badge, which names all six decorations).
- `components/columns.ts:153` — `button.title = enabled ? 'Copy full SHA' : …` (removed anyway by D5).

`@kira/kira-ui`'s tooltip controller hit-tests a plain `data-kui-tip` attribute (`packages/kira-ui/src/tooltip.ts:31`, `:138`), not a Vue directive binding, so a DOM builder can participate by setting one attribute.

#### F7 (item 7) — `kiraVersion.statusBar.enabled` is the *only* property left in `contributes.configuration`, with exactly three code references

- `apps/kira-studio-vscode/src/extension.ts:75` — `const STATUS_BAR_SETTING = 'kiraVersion.statusBar.enabled';`, with a G10 D16 comment explaining it is deliberately host-only and outside `SETTINGS`/`SettingsSnapshot`.
- `extension.ts:227-231` — the gate at the top of `updateStatusBar`: `const enabled = …get<boolean>(STATUS_BAR_SETTING, true); if (!enabled) { item.hide(); return; }`.
- `extension.ts:562-563` — the `onDidChangeConfiguration` arm: `if (event.affectsConfiguration(STATUS_BAR_SETTING)) updateStatusBar(...)`.
- `apps/kira-studio-vscode/package.json:322-330` — `"configuration": { "properties": { "kiraVersion.statusBar.enabled": { … } } }`. **This is the block's only property**, because G18 D1/D15 already moved the other eight keys out; removing it leaves an empty `configuration` object, so the whole key goes.

It is **not** in G18 D11's legacy-migration list (that covers the eight per-repo/`git.path` keys via `LEGACY_GIT_PATH_KEY` and `SETTINGS`), so nothing in the migration path needs touching. It is not in `packages/git-core/src/settings/schema.ts` and never reaches the webview — confirmed by its own comment at `extension.ts:73-75`.

#### F8 (item 8) — Re-verified: G19's `{preview:false}` is shipped and correct. Three distinct remaining problems, one of which is that N tabs is not what the item's own words ask for

**What G19 shipped, confirmed present**, `apps/kira-studio-vscode/src/ports/editorIntegration.ts:90-103` — `openDiff` passes `{ preview: false } satisfies vscode.TextDocumentShowOptions` as `vscode.diff`'s fourth argument, with a nine-line comment root-causing the original bug. **This is correct and is not reverted, anywhere, by this phase.**

**Remaining problem (i) — every failure is silently swallowed.** `components/review/ReviewCommitRow.vue:111-135`:

```ts
const parentIndex = exp.detail.parentIndex.value;
for (const file of files) {
  void exp.actions.openInEditor({ … });
}
```

`void` with no `.catch`. `openInEditor` (`state/review.ts:402-410`) awaits an RPC whose extension-side handler *throws by design* for a path it cannot find: `proxyHandlers.ts:219-221` — `throw new Error(\`editor.openDiff: ${path} is not one of commit ${sha}'s changed files\`)`. Any rejection — that throw, a cancelled transport, a `commit.detail` failure — becomes an unhandled promise rejection inside a webview, with **no announcement, no error surface, and no partial-success reporting**. A run in which 1 of 14 opens succeeds and 13 reject looks, to the user, exactly like "it only shows one file's diff." G19's D8 could not have caught this; it was scoped to the `vscode.diff` options argument.

**Remaining problem (ii) — N unsequenced, concurrent opens.** The loop fires all N requests in the same tick. Each handler independently re-fetches `commit.detail` for the *same* sha (`proxyHandlers.ts:212-217`) — N round trips for one commit's file list — and each `vscode.diff` call takes focus, since no `preserveFocus` is passed.

**Remaining problem (iii) — the item's own wording describes a different artefact than N tabs.** "doesn't show **all files' hunks**" describes one scrollable review surface, not fourteen tabs one of which is on top. VS Code has shipped exactly that surface since 1.86 — the **multi-file diff editor**, reachable from the built-in `vscode.changes` command — and this extension's `engines.vscode` is `^1.134.0` (`apps/kira-studio-vscode/package.json:11-13`) with `@types/vscode@1.134.0`, so it is unconditionally available. `vscode.changes` is a built-in command and is therefore *not* declared in `@types/vscode/index.d.ts` (confirmed by grep — no `vscode.changes`, no `MultiDiff` symbol there), which is a real, if ordinary, risk this plan handles explicitly in D8 rather than assuming away.

### File tree / file list

#### F9 (item 9) — `fileIconFor` is a 7-branch coarse category map, and the codicon font's real per-file-type vocabulary is about twelve glyphs wide

`components/fileTreeModel.ts:333-343`:

```ts
export function fileIconFor(path: string): string {
  const ext = extensionOf(path);
  if (ext === 'json') return 'codicon-json';
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'codicon-markdown';
  if (ext === 'pdf') return 'codicon-file-pdf';
  if (MEDIA_EXTENSIONS.has(ext)) return 'codicon-file-media';
  if (ZIP_EXTENSIONS.has(ext)) return 'codicon-file-zip';
  if (BINARY_EXTENSIONS.has(ext)) return 'codicon-file-binary';
  if (CODE_EXTENSIONS.has(ext)) return 'codicon-file-code';
  return 'codicon-file';
}
```

Every `.ts`, `.go`, `.py`, `.rs`, `.java`, `.c`, `.vue` file gets the identical `codicon-file-code` glyph — precisely the "coarse category" the item objects to.

**The ceiling, measured not assumed.** `node_modules/@vscode/codicons/dist/codicon.css` defines **752** classes; filtering for anything a file could plausibly be typed by yields: `file`, `file-add`, `file-binary`, `file-code`, `file-directory`, `file-media`, `file-pdf`, `file-submodule`, `file-symlink-file`, `file-symlink-directory`, `file-text`, `file-zip`, `files`, `json`, `markdown`, `ruby`, `database`, `gear`/`settings-gear`, `book`, `note`, `notebook`, `package`, `law`, `key`, `lock`, `github`/`mark-github`/`github-action`, `terminal-bash`/`-cmd`/`-powershell`/`-debian`/`-ubuntu`/`-linux`, `beaker`, `graph`, `symbol-*` (a 40-glyph *language-symbol* set, not a file-type set), `code`, `vscode`. **There is no per-language file-icon vocabulary in codicons** — that is what Seti/Material file-icon *themes* are for, and VS Code exposes no API for a webview to read the active file-icon theme. `packages/git-ui/src/icons/codicon.css` vendors a curated subset of 38 classes today.

So the honest reading of item 9 — and the one its own words support ("their actual icons from codicons, based on the actual file extension") — is: key the lookup on the **actual extension and filename**, and give each one the most specific glyph that genuinely exists, instead of collapsing everything into six buckets.

#### F10 (item 10) — The status letter is a badge chip, and the chip's own background is what the item objects to

`components/FileTree.vue:450-455` renders `class="kv-file-tree-status kv-file-tree-status-chip"`, and `:648-661`:

```css
.kv-file-tree-status-chip {
  width: 1.3em; height: 1.3em;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 3px; font-size: 0.75em;
  background-color: var(--kv-badge-bg);
  color: var(--kv-badge-fg);
}
```

This is G19 D14's own demotion of the letter to a "small secondary chip" when the file-type icon took over the leading-glyph role. The `color: var(--kv-badge-fg)` is overridden by `.kv-status-added`/`-modified`/… (`:663-683`, later in the same stylesheet, equal specificity), so the letter *is* still coloured — the objection is precisely the chip box: the `background-color`, `border-radius`, fixed `1.3em` square, and 0.75em shrink. `fileTreeModel.ts:10-30` (`STATUS_LETTERS`, `STATUS_COLOR_CLASS`) is already exactly what the item asks for and needs no change.

#### F11 (item 11) — Re-investigated: `FileTree.vue` is **already** the one shared component. The real duplication is a `reviewStyled` fork and seven cross-file skin overrides

`grep -rn FileTree packages/git-ui/src --include=*.vue` finds exactly one implementation and four consumers: `DetailPane.vue:31,88` (graph panel), `StashDetailPane.vue:16,62` (stash), `review/ReviewFilesPane.vue:27,119` (review Files pane), `review/ReviewCommitRow.vue:22,225` (review Commits pane, one per expanded row). There is no second implementation to merge — G19's own F4 already recorded this.

**What is genuinely duplicated/forked:**

1. **`reviewStyled` (`FileTree.vue:49-55`)** — a prop whose entire purpose is to render *two different anatomies* from one component: it gates the flat-mode dimmed-directory suffix (`:465-468`), and it inverts the copy-path affordance (an inline button when unset, `:501-509`; a right-click `KuiContextMenu` when set, `:320-334`, `:522-530`). Its doc comment states the reason plainly — *"`DetailPane.vue`'s tree … leaves this unset and keeps today's appearance byte for byte (§0.3: no graph restyle)"*.
2. **Seven skin rules living in the wrong file.** `review/ReviewView.vue:1252-1275` restyles `FileTree`'s rows from outside the component, under a `.kv-skin-kira` ancestor, with an explicit comment saying why: *"FileTree.vue is shared with the graph panel's DetailPane, which must stay byte-identical (D14's own guarantee). So its row geometry is restyled here, from the review side … never by editing FileTree.vue's own base rules, which would apply the new scale to the graph panel too."*
3. **Three toolbars.** `FileTree.vue:376-407` (its own filter + tree/flat group, used by the graph and stash trees), `ReviewView.vue:702-760` (the panel-level toolbar that owns filter + list mode for both review panes, with `show-toolbar="false"` on the trees below), and `ReviewFilesPane.vue:90-114` (the since-review/full-range group).

The constraint that produced all three — "the graph panel must stay byte-identical" — is **precisely what items 9, 10, 12 and 13 dissolve**: they change the graph tree's icons, its status glyph, what a click does, and what a double-click does. Once the graph tree is being changed anyway, and changed to match what the review tree does, there is no longer a byte-identity guarantee to protect, and `reviewStyled` has nothing left to fork.

#### F12 (item 12) — The review panel already opens natively; the graph and stash panels still render an in-webview diff, and its one review-specific feature is already dead code

**Review panel: already correct.** `ReviewFilesPane.vue:8-11` — *"G12 D12: selecting a file no longer opens an in-webview `DiffView` — it opens VS Code's native diff editor"*; `reviewFiles.ts:126-131`'s `selectFile` calls `#openInEditor()` (`editor.openRangeDiff`). `ReviewCommitRow.vue:11-13` says the same for the Commits pane.

**Graph panel: still embedded.** `DetailPane.vue:69-79` renders `<DiffView v-if="detailState.mode.value === 'diff' && detail">`, driven by `DetailState.mode` (`state/detail.ts:35-38`, plus `diff`/`diffError` and a `commit.fileDiff` fetch). `App.vue` carries the surrounding layout: `:936-939` (`closeDetail`'s "if the diff is showing, go back to the tree" arm, for both detail and stash), `:1218-1222` (`.kv-detail-drawer--diff` at the overlay breakpoint), `:1482-1490` (the full-width-diff-overlay CSS).

**Stash: also embedded.** `StashDetailPane.vue:38-49`, over `StashState.mode`/`diff`/`diffError` (`state/stash.ts:45-51`).

**`DiffView.vue` is 568 lines and its review adornment is already unreachable.** Its `review?: ReviewDiffAdornment` prop (`DiffView.vue:19-43`) — G11 D16's range-marking UI — has **no caller**: `grep -rn ':review=' packages/git-ui/src --include=*.vue` returns only `:review-states`, `:review-files`, `:review-comments`. G12 D12 removed the one consumer and G15 rebuilt range marking against the *native* editor (`apps/kira-studio-vscode/src/reviewMarking.ts`). So the whole adornment path is dead weight already.

**One real technical wrinkle for the stash tree.** `state/stash.ts:155-210` documents and implements a fallback the native path does not have: a stash's `-u` untracked files live only in the stash's third parent (`entry.untrackedSha`), which has no `baseSha`, so `commit.fileDiff` is tried against `entry.sha` first and **retried against `entry.untrackedSha`** when the first throws. `proxyHandlers.ts`'s `editor.openDiff` handler has no equivalent retry and would throw `"… is not one of commit X's changed files"` for exactly those files.

#### F13 (item 13) — Five call sites, one of which is bulk; and the tree has no double-click affordance at all

Every path that reaches a native diff today, traced end to end:

| # | Origin | Client call | Handler | Nature |
|---|---|---|---|---|
| 1 | `ReviewCommitRow.vue:111-135` `openAllChanges` (button at `:205`) | `expansion.actions.openInEditor` ×N → `state/review.ts:402-410` | `editor.openDiff` | **bulk** |
| 2 | `ReviewCommitRow.vue:139-…` `onSelectFile` (a click in an expanded commit's tree) | same `openInEditor` | `editor.openDiff` | single, navigational |
| 3 | `ReviewFilesPane.vue:69-72` → `reviewFiles.selectFile(path)` (`state/reviewFiles.ts:126-131`) | `#openInEditor()` | `editor.openRangeDiff` | single, navigational |
| 4 | `ReviewView.vue:298-307` `filesActions.openInEditor` | `editor.openDiff` | wired but, per `:279-282`, never actually reached from `ReviewFilesPane` | single |
| 5 | `state/detailActions.ts:59-68` `createDetailActions.openInEditor` (graph panel) | `editor.openDiff` | currently only reachable from `CommitMeta`/`DiffView` headers; **becomes the graph tree's own click path under D12** | single, navigational |

`openDiff` (`editorIntegration.ts:90-103`) is shared by all five and unconditionally pins. The webview is the only place that knows which of the five it is, so the distinction must cross the wire — the host cannot infer it (`createProxyHandlers` is constructed **once** in `extension.ts:377` and serves both webviews).

On the interaction side, `FileTree.vue` has no double-click handling: `:428` is `@click="onRowClick(index)"`, `:209-218`'s `onRowClick` and `:201-207`'s `selectRow` both emit `selectFile` immediately, and `Enter` (`:256-263`) emits the same thing. There is nothing today to distinguish "I am browsing" from "I want to keep this open".

### Test infrastructure

#### F14 — `packages/git-core/src` has never been in `test:unit`'s scope, and its ten existing test files have never run

Root `package.json:38`: `"test:unit": "bun test apps/kira-studio/tests/unit packages/api-core/test packages/git-ipc/src apps/kira-studio-vscode/src packages/git-ui/src packages/kira-ui/src"` — **no `packages/git-core/src`**. Meanwhile `find packages/git-core -name '*.test.ts'` returns ten real files (`model/operation.test.ts`, `model/tag.test.ts`, `model/diff.test.ts`, `model/status.test.ts`, `model/review.test.ts`, `util/nulSplit.test.ts`, `undo/slot.test.ts`, `preflight/tag.test.ts`, `preflight/cherryPick.test.ts`, `preflight/reset.test.ts`), none of which any script executes. No script anywhere in `package.json` names `packages/git-core`; only `typecheck:git` does. And `packages/git-core/src/graph` — where D3's change lands — has **zero** test files.

This matters concretely: D3 is the only change in this phase to core graph math, the one place a regression would be invisible in a screenshot and catastrophic in a real repo.

---

## 2. Decisions

### Git graph

#### D1 (item 1) — Give the HEAD ring its own radius, so a merge commit at HEAD reads as both

Scoped to F1's single real gap. Everything G19 D1 shipped stays exactly as it is.

- `graph/geometry.ts` gains one constant: `headRingRadius: 5.6` (kept clear of the graph column's own lane-width envelope — `5.6 + strokeWidth(0.8) = 6.4 ≤ half the 13px lane width`, so the ring stays provably inside its lane band while clearing the merge ring by a full stroke, and clearing the ordinary dot by `strokeWidth` too, fixing the fused-halo look F1 also noted).
- `graph/rowSvg.ts:188-190` — the `headRing` plan uses `GEOMETRY.headRingRadius` instead of `GEOMETRY.mergeRadius`. One token change.
- `graph/rowSvg.test.ts` gains a case: a slice with `nodeKind: 'merge'` and `isHead: true` returns three shapes with three *distinct* radii, and the head ring's radius is strictly greater than the merge ring's.

Not touched: `isHeadDecoration`, `RowSlice.isHead`, `graphColumn.ts`, `.kv-graph-head-ring`'s colour, the row-bold indicator, the branch-badge dot, the detached-HEAD case (`refBadges.ts:102-118`).

#### D3 (item 3) — Emit `EDGE_KIND_MERGE_IN` for real: patch the converging edge's target lane at the row where convergence is discovered, and teach `edgeCommand` to bend at the end instead of the start

Three coordinated changes, all following mechanisms this codebase already has.

**D3a — track which edge owns each open lane.** `lanes.ts`'s `MutableState` (`:65-71`) gains `laneEdge: number[]`, parallel to `openLanes`/`laneColors`: the *global* edge index of the edge that last set `openLanes[lane]` to a real row. Written at both append sites (`:196-203` parent-0/straight, `:222-238` parent-N/branch-out) and at the pending-resolution site (`:142-150`, where a patched edge starts expecting a now-known row). Cleared to `-1` whenever a lane is freed or set `LANE_EMPTY`. It joins `LayoutFrontier` (`graph/types.ts`) alongside `openLanes`/`laneColors` so it survives a chunk boundary — the frontier is already structured-clone-safe plain arrays, so this is additive with no new serialization concern.

**D3b — patch at step 2.** `lanes.ts:164-171` becomes:

```ts
for (let lane = 0; lane < state.laneCount; lane++) {
  if (lane === claimedLane || state.openLanes[lane] !== row) continue;
  const edgeIndex = state.laneEdge[lane];
  if (edgeIndex >= 0) edgeBuffer.patchConvergence(edgeIndex, claimedLane);
  state.openLanes[lane] = LANE_EMPTY;
  state.laneEdge[lane] = -1;
}
```

`patchConvergence(globalEdgeIndex, toLane)` sets `EDGE_TO_LANE := toLane` and `EDGE_KIND := EDGE_KIND_MERGE_IN` on that edge — in this chunk's own buffer if it lives here, or as a cross-chunk patch record otherwise, using the mechanism `patchTarget` already uses. **The patch record widens from a 2-tuple to a 4-tuple**: `(globalEdgeIndex, toRow, toLane, kind)`, with a sentinel meaning "unchanged" for the fields a given patch does not set, so a `toRow`-only resolution and a `toLane`-only convergence share one record shape and one `#applyPatches` loop (`layoutStore.ts:230`). `BuiltEdges.patches`'s doc comment (`edges.ts:76-77`) is updated to match.

**Paging invariance is preserved by construction**, which is the property `lanes.ts`'s module doc exists to protect: the patch fires at step 2, at the shared target row's own processing, which depends only on row order — identical between a paged and a one-pass run. This is the *same* place and the *same* trigger the existing lane-freeing already uses; nothing new is decided speculatively at edge-creation time.

**D3c — render the bend at the correct end.** `rowSvg.ts`'s `edgeCommand` gains a `MERGE_IN` branch. Today it assumes the lane transition always happens in the edge's *first* row; for a merge-in it happens in the *last*:

| row | `STRAIGHT` / `BRANCH_OUT` (unchanged) | `MERGE_IN` (new) |
|---|---|---|
| `row === fromRow` | curve `fromLane` → `toLane`, centre → bottom | **vertical at `fromLane`, centre → bottom** |
| pass-through | vertical at `toLane` | **vertical at `fromLane`** |
| `row === toRow` | vertical at `toLane`, top → centre | **curve `fromLane` → `toLane`, top → centre**, mirroring the existing cubic (`:120-124`) reflected about the row's midline |

So a merge-in edge runs down its own lane for its whole length and bends into the target commit's lane in the final row, meeting the node. `coversRow` (`layoutStore.ts:79-84`) and `planEdgePaths` (`rowSvg.ts:145-155`) need no change — the segment's extent and colour grouping are unaffected.

**Colour**: the merge-in edge keeps its own lane's colour for its whole run including the bend, which is what makes the item's "connected to the origin" legible (you can see *which* branch merged in) and is consistent with D4's badge tinting.

#### D4 (item 4) — Tint each ref badge with its row's lane colour, on the border and icon, keeping shape and glyph as the non-colour signals

- `refBadges.ts`'s `buildRefBadges(decorations)` becomes `buildRefBadges(decorations, laneColor: number | undefined)`; `buildBadgeElement` appends `laneClass(laneColor)` (the existing `kv-lane-N` class from `rowSvg.ts`) alongside the existing `spec.colorClass` when a lane colour is known.
- `columns.ts` gains one accessor context, exactly matching the three already there:
  ```ts
  export interface LaneColorContext { readonly colorOf: (row: number) => number | undefined; }
  ```
  passed to `messageFormatter(searchCtx, laneCtx)` and defaulted to `{ colorOf: () => undefined }` so `columns.test.ts`'s existing call sites and any harness caller keep working unchanged (the same back-compat shape `searchCtx` already uses at `:197`). `buildColumns` takes it as a new optional last parameter.
- `CommitGrid.vue:198` (which already holds the `LayoutStore` and already builds the graph formatter from it) supplies `{ colorOf: (row) => row < layout.rowCount ? layout.colorOf(row) : undefined }`.
- **What the tint actually paints** (`CommitGrid.vue`'s badge CSS): the badge's `border-color` and its icon `color` come from `--kv-lane-N`; the label's foreground and the badge background keep `--kv-badge-*`. Rationale: `--kv-lane-N` is a saturated line colour picked for 1.6px strokes on a panel background, not for text contrast — using it as a fill or a label colour would fail legibility on several lanes in several themes, and §6.1's "no colour-only meaning" already requires the icon and the pill/square shape distinction to survive regardless. The tint is an *additional* signal tying badge to lane, not a replacement for the kind signal.
- A row with no layout yet (`row >= layout.rowCount`, the case `graphColumn.ts:35-46` already handles) gets no lane class and renders exactly as today — the badge never flickers colour as layout arrives; it only gains a border tint.

### Graph columns and detail panel

#### D5 (item 5) — Delete the SHA column outright; the details panel shows one short, click-to-copy SHA

**The column and its five integration points go**, per F5:

- `columns.ts`: delete `SHA_COLUMN_ID`, `ShaCopyContext`, `shaFormatter`, and the fifth column definition. `buildColumns`'s `shaCopyCtx` parameter is removed (a breaking signature change to a function with four call sites, all in this repo — `CommitGrid.vue` and `columns.test.ts`'s four cases).
- `CommitGrid.vue`: delete the `clipboardEnabled` prop (`:45`) and its watch (`:690-700`); the `copySha` emit (`:69`); the third drag handle and its ARIA slider markup (`:786-798`); `focusedShaButton` and the sha branch of the roving-tabindex/focus-restore machinery (`:152-169`, `:482-518`); `.kv-cell-sha`'s CSS (`:875-892`, `:1080-1096`); drop `widths.value.sha` from the fixed-width total (`:174`); the drag-handle comment at `:112` narrows to two handles.
- `App.vue:1169`: the `@copy-sha` binding and `handleCopySha` go. (`App.vue:398`/`:428`'s ref-menu `copySha` is a *different* action and stays.)
- `state/viewState.ts`: `ColumnWidths` loses `sha`; `DEFAULT_COLUMN_WIDTHS` loses it; `isColumnWidthsShape` (`:73-81`) drops the `record.sha` check.
- **`PersistedViewState.version` moves 4 → 5** (`:30` and `:88`). This is forced by the shape change and is also, deliberately, what makes D6 reachable — see below. Per `parsePersistedViewState`'s own documented policy (`:100-110`: *"A `version` that is not the current one is discarded whole, never partially applied"*), a stored v4 blob is dropped and the panel re-seeds from defaults. What a user loses is column widths, scroll row, selected sha and the search toggles for one session — the same cost every prior version bump in this file has already imposed, and the same cost the removal of a persisted column makes unavoidable.

**The details panel** (`CommitMeta.vue:229-256`) collapses two rows into one:

```html
<dt>SHA</dt>
<dd>
  <KuiButton variant="ghost" class="kv-meta-sha"
             v-kui-tooltip="'Click to copy the full SHA'"
             aria-label="Copy full SHA"
             @click="copyFullSha">{{ shortSha }}</KuiButton>
</dd>
```

The `Short SHA` row, both `kv-copy-button`s, and `copyShortSha` are deleted; `copyFullSha` (`:174`) is the sole handler and already copies `detail.sha` with the announcement "full SHA". When `actions.capabilities.clipboard` is false the sha renders as plain text (a non-interactive `<span class="kv-meta-mono">`), preserving the existing feature-detection behaviour rather than showing a dead button. A `~1.5s` "Copied" flash mirrors the affordance the deleted `shaFormatter` had, so nothing about the copy interaction is silently less discoverable than before.

#### D6 (item 6) — Make the widened default actually reachable, and derive it from measured text instead of a constant

Two parts, addressing F6's two gaps.

**D6a — reachability.** The `version` 4 → 5 bump D5 already forces is what delivers G19's fix to the users who reported it. This is stated explicitly as *part of item 6's fix*, not as a side effect of item 5, so the two are never separated during implementation: **if D5's version bump were dropped, item 6 would not be fixed.**

**D6b — a measured default and a measured minimum.** A new `components/dateFormat.ts` export:

```ts
/** The pixel width of the widest string formatAbsoluteDate can produce, in `font`. */
export function measureAbsoluteDateWidth(font: string): number
```

using a module-level `OffscreenCanvas`/`<canvas>` 2D context's `measureText` over a representative widest sample (`formatAbsoluteDate` of a timestamp yielding `"2024-12-30 22:48"` — fixed-width by construction given the format, and `tabular-nums` makes digit choice irrelevant). `CommitGrid.vue`, at mount and on the same `TokenReader` change signal it already uses for `--kv-row-height` (`theme/readTokens.ts`), resolves the grid's own computed `font` shorthand from a `.kv-cell-date` probe and computes:

```ts
const dateWidth = Math.ceil(measureAbsoluteDateWidth(font) + 2 * CELL_PADDING_PX);
```

- Used as the **seed** for `DEFAULT_COLUMN_WIDTHS.date` on a first-ever mount (`Math.max(152, dateWidth)` — 152 stays as the floor so the relative-format default never shrinks).
- Used as the date column's **minimum drag width** in `CommitGrid.vue`'s `clampWidth` (`:217`), instead of the global `MIN_COLUMN_WIDTH = 40`, so the column cannot be dragged back into the clipping state item 6 is about. Every other column keeps `MIN_COLUMN_WIDTH`.

`.kv-cell-date`'s `text-overflow: ellipsis` (G19 D2) stays — it is now a safety net for a user-narrowed relative-format column, not the primary mechanism.

### Component library

#### D2 (item 2) — Four new `packages/kira-ui` primitives, and a full migration of what G20 did not cover in `packages/git-ui`

Additive to G20's package, in the same `--kui-*`-token-only style, consumed only from `packages/git-ui` (both hosts' `kui-bridge.css` already exist and already carry the `--kui-z-*` ladder `17217d96` added).

**New in `packages/kira-ui/src`:**

| File | What it is |
|---|---|
| `KuiDialog.vue` | The modal shell: teleported backdrop (`--kui-z-modal`, a new rung above `--kui-z-popover`), a `role="dialog" aria-modal="true"` panel with `title`/`default`/`actions` slots, Escape-to-close, and the focus trap/return promoted from `packages/git-ui/src/components/dialogs/modalFocus.ts`. Props: `open`, `title`, `labelledBy?`, `width?`. Emits `close`. |
| `modalFocus.ts` | `useModalFocus`, moved **verbatim** from `packages/git-ui/src/components/dialogs/modalFocus.ts` (it imports nothing but `vue` and is already correct — this is a move, not a rewrite, exactly as G19 D3b moved `RowContextMenu`'s ARIA logic). |
| `KuiSegmented.vue` | A `role="group"` of icon (and optionally count-badged) toggle buttons over `{ id, icon, label, badge? }[]` + `modelValue`, with `aria-pressed` per button — one implementation of the four groups F2(b) found. |
| `KuiSearchInput.vue` | `KuiTextInput` plus a leading `codicon-search` and a trailing clear button, `aria-label` required. |
| `KuiSelect.vue` | A **styled native `<select>`** — `--kui-*` chrome, a `codicon-chevron-down` affordance, `modelValue`/`options`/`ariaLabel`. Deliberately not a custom listbox: the browser/host owns a `<select>`'s popup positioning and its accessibility for free, and G20's own F5 recorded the sibling app making the same call for the same reason. |

`KuiButton` gains one prop, `variant: 'ghost'`, for the transparent icon-only affordances (`.kv-copy-button` and friends) that G19's `default | primary | danger` did not cover.

**Migrated in `packages/git-ui`:**

1. **All eleven dialogs** wrap their bodies in `<KuiDialog>`; every `.kv-modal-backdrop` / `.kv-modal` / `.kv-modal-title` / `.kv-modal-actions` / `.kv-modal-button*` rule is **deleted from all four files that redeclare them** (`CheckoutDialog.vue`, `CherryPickDialog.vue`, `ForcePushDialog.vue`, `ResetDialog.vue`); action buttons become `<KuiButton variant="primary|danger|default">`. `components/dialogs/modalFocus.ts` is deleted (re-exported from `@kira/kira-ui` for any straggler import).
2. **The four segmented groups** — `FileTree.vue:385-406`, `ReviewFilesPane.vue:90-114`, `ReviewView.vue:709-741` (pane toggle) and its list-mode group — become `<KuiSegmented>`; `.kv-mode-active`, `.kv-file-tree-mode`, `.kv-review-files-diff-toggle`, `.kv-review-toolbar-mode`, `.kv-review-pane-toggle` CSS is deleted.
3. **Filter inputs** — `FileTree.vue:376-384`, `BranchPicker.vue` ×2, `BaseSelector.vue`, `SearchResults.vue` — become `<KuiSearchInput>`. `SearchBox.vue`'s combobox input stays raw, for G19's already-stated reason, restated in a code comment so it is not mistaken for an oversight.
4. **All six native `<select>`s** — `FileTree.vue:369-373`, `SearchBox.vue` ×2, `RepoSettingsDialog.vue` ×3 — become `<KuiSelect>`.
5. **Remaining raw `<button>`s** across `App.vue`, `BranchPicker.vue`, `TagList.vue`, `StashList.vue`, `RepoPicker.vue`, `SearchBox.vue`, `SearchResults.vue`, `LoadMoreButton.vue`, `ConflictBanner.vue`, `NoRepositoryPanel.vue`, `CommitMeta.vue`, `ReviewView.vue`, `ReviewCommentsPane.vue`, `ReviewFilesPane.vue`, `ReviewCommitRow.vue`, `FileTree.vue` become `<KuiButton>` (`variant="ghost"` for the icon-only ones). `.kv-copy-button`'s definition in `CommitMeta.vue:395-407` — a private style block two other components silently depend on — is deleted. **`DiffView.vue`'s 7 buttons are not migrated: D12 deletes the file.**
6. **The three native `title` leaks F2(f) found**: `refBadges.ts:156` and `:196` set `badge.setAttribute('data-kui-tip', …)` instead of `.title` (plus `aria-label` where the badge has no visible text — the `+N` badge). `columns.ts:153` disappears with D5.

**Explicitly out of scope for item 2**, so the boundary is a decision and not a gap: no component in `apps/kira-studio/frontend` is edited (G19's own boundary); `SearchBox.vue`'s combobox input and `SearchResults.vue`'s listbox keep their bespoke ARIA wiring (G20 already made and justified the same call); nothing G20 already migrated is touched.

### VS Code settings

#### D7 (item 7) — Remove the setting, the gate, the listener, and the whole `contributes.configuration` block

- `extension.ts:75` — delete `STATUS_BAR_SETTING`.
- `extension.ts:227-231` — delete the `enabled`/`item.hide()` gate; `updateStatusBar` always reaches its `item.show()` at `:296`. The comment at `:222-224` ("`item.hide()` survives for exactly one case: the user turned the item off themselves") is deleted with it, since that case no longer exists.
- `extension.ts:560-565` — delete the `affectsConfiguration(STATUS_BAR_SETTING)` arm of the `onDidChangeConfiguration` handler; if that leaves the listener with no remaining arms, the whole `onDidChangeConfiguration` registration goes (checked at implementation time — the other `SETTINGS` keys already left in G18).
- `apps/kira-studio-vscode/package.json:322-330` — delete the entire `"configuration"` key, since this is its only property (F7). Leaving `"configuration": { "properties": {} }` would advertise an empty Kira Version section in VS Code's settings UI.
- `apps/kira-studio-vscode/README.md` — remove any prose naming the setting (checked at implementation time).

A value a user already set in their own `settings.json` is left in place, unread — the same explicit non-goal G18 D11 already established for the eight keys it orphaned. No migration, no cleanup, no notification.

### Review bar

#### D8 (item 8) — One host action that prefers VS Code's own multi-file diff editor, with a sequenced, error-reporting fallback

G19's `{ preview: false }` in `openDiff` is **kept, unchanged**. What changes is above it.

**D8a — a new contract method, `editor.openAllChanges`** (`packages/git-ipc/src/contract.ts`, `validate.ts`'s method table alongside `editor.openDiff: true`):

```ts
'editor.openAllChanges': {
  params: { repoId: string; sha: string; parentIndex?: number };
  result: { opened: number; failed: number; mode: 'multiDiff' | 'tabs' };
};
```

The host composes the whole resource list from **one** `commit.detail` (collapsing today's N identical round trips into one) reusing the exact `DocumentRef` derivation `editor.openDiff`'s handler already performs (`proxyHandlers.ts:222-238`), factored into a small shared local helper so the two handlers can never disagree about which side is `empty` for an added/deleted file.

**D8b — the host prefers the multi-file diff editor.** `ports/editorIntegration.ts` gains:

```ts
async openAllChanges(req: { title: string; files: readonly { left: DocumentRef; right: DocumentRef; resource: string }[] }): Promise<{opened:number; failed:number; mode:'multiDiff'|'tabs'}>
```

- Probes once, memoized: `(await vscode.commands.getCommands(true)).includes('vscode.changes')`. This is a real capability check rather than a version assumption, and it is why item 8 does not depend on an API absent from `@types/vscode` (F8) being present — `vscode.changes` is invoked through `executeCommand`, which is untyped by nature, and the probe means an absent or renamed command degrades instead of throwing.
- When present: one call, `executeCommand('vscode.changes', title, resources)` where each entry is `[resourceUri, originalUri, modifiedUri]` — `resourceUri` is the real `file://` path (so labels and the tree grouping in the multi-diff editor read correctly even for deleted files), the other two the `kira-version:` virtual documents the existing `toUri` already mints. Result `{ mode: 'multiDiff', opened: files.length, failed: 0 }`.
- When absent, or when the call rejects: fall back to **today's behaviour, sequenced and error-aware** — `for … of files` with `await this.openDiff({…})`, `{ preview: false }` retained, `preserveFocus: true` on all but the last so focus lands once rather than N times, each failure caught and counted rather than thrown.

**D8c — the client stops swallowing failures.** `ReviewCommitRow.vue:111-135`'s loop is replaced by a single awaited call, with the outcome announced through the live region the row already has:

```ts
async function openAllChanges(event: MouseEvent): Promise<void> {
  event.stopPropagation();
  const exp = props.expansion; …
  try {
    const { opened, failed, mode } = await exp.actions.openAllChanges({ sha: props.sha, parentIndex });
    exp.actions.announce(failed === 0
      ? (mode === 'multiDiff' ? `Opened all ${opened} changed files` : `Opened ${opened} files`)
      : `Opened ${opened} of ${opened + failed} files — ${failed} couldn't be opened`);
  } catch (err) { exp.actions.announce(`Couldn't open the changes — ${message(err)}`); }
}
```

`DetailActions` (`state/detailActions.ts`) gains `openAllChanges`; both implementations (`createDetailActions`, `ReviewSessionState.#createRowActions`, `ReviewView.filesActions`) forward it. **No silent `void` remains on any diff-opening path.**

**Relationship to item 13, stated explicitly:** the bulk call site keeps pinned/multi-diff semantics in both branches. D13 changes only the four single-file navigational call sites. G19's D8 is therefore neither reverted nor globally flipped — it is scoped down to exactly the interaction it was written for.

### File tree / file list

#### D9 (item 9) — A real per-extension/per-filename table, mapped to the most specific codicon that genuinely exists

`fileTreeModel.ts`'s `fileIconFor` is rewritten as two lookups and one fallback chain:

1. `EXACT_FILENAME_ICONS` — `package.json`/`bun.lock`/`package-lock.json`/`go.sum`/`Cargo.lock` → `codicon-package`; `LICENSE`/`LICENCE`/`COPYING` → `codicon-law`; `Dockerfile`/`docker-compose.yml` → `codicon-vm`; `Makefile`/`CMakeLists.txt` → `codicon-tools`; `.gitignore`/`.gitattributes`/`.gitmodules` → `codicon-source-control`; `.editorconfig`/`.npmrc`/`tsconfig.json`/`biome.json` → `codicon-gear`.
2. `EXTENSION_ICONS` — a real per-extension map (~90 entries), each to its most specific available glyph: `json`/`jsonc`→`codicon-json`; `md`/`mdx`/`markdown`→`codicon-markdown`; `rb`/`erb`/`gemspec`→`codicon-ruby`; `sql`/`db`/`sqlite`→`codicon-database`; `yml`/`yaml`/`toml`/`ini`/`conf`/`cfg`/`env`→`codicon-gear`; `sh`/`bash`/`zsh`→`codicon-terminal-bash`; `ps1`→`codicon-terminal-powershell`; `bat`/`cmd`→`codicon-terminal-cmd`; `ipynb`→`codicon-notebook`; `pem`/`key`/`crt`→`codicon-key`; `txt`/`rst`/`adoc`→`codicon-file-text`; `pdf`→`codicon-file-pdf`; media/archive/binary extensions to their existing glyphs; and every genuine source extension (`ts`,`tsx`,`js`,`jsx`,`vue`,`go`,`rs`,`py`,`java`,`kt`,`swift`,`c`,`h`,`cpp`,`cs`,`php`,`scala`,`hs`,`ex`,`html`,`css`,`scss`,`less`,`proto`,`graphql`,…) to `codicon-file-code`.
3. A path-shape rule *before* the extension lookup: a path segment `.github/workflows/` → `codicon-github-action`; a filename matching `/\.(test|spec)\.[a-z]+$/` → `codicon-beaker`.
4. Fallback `codicon-file`.

`icons/codicon.css`'s vendored subset (38 classes today) is extended with the ~14 newly referenced names. The font file itself already ships every glyph; only the `content` declarations are added.

**The ceiling is stated in the module doc, not left implicit:** codicons contain no per-language file-icon vocabulary (F9's measured survey); a genuinely per-language icon set would require vendoring a file-icon theme font (Seti, Material) or reading VS Code's active file-icon theme, neither of which the icon set SPEC names supports and the latter of which has no webview-reachable API. This decision takes the map as far as the named icon set actually goes.

`fileTreeModel.test.ts` gains a table-driven case per bucket, including the two path-shape rules and the exact-filename precedence over extension (`package.json` → `codicon-package`, not `codicon-json`).

#### D10 (item 10) — The status glyph is a coloured letter and nothing else

`FileTree.vue`: drop `kv-file-tree-status-chip` from the row markup (`:451`) and delete the `.kv-file-tree-status-chip` rule (`:648-661`) entirely. `.kv-file-tree-status` keeps `font-family: var(--kv-mono-font-family); font-weight: 700; flex-shrink: 0` — a single monospace capital in the status colour, which is exactly "just a colored letter". `STATUS_LETTERS`/`STATUS_COLOR_CLASS` are untouched. A `min-width: 1ch` is added so the letters stay in a column and the file names line up (a coloured letter, not a chip, but still an aligned one).

`ReviewView.vue:1265-1268`'s `.kv-skin-kira .kv-file-tree-status` mono override becomes redundant and is deleted along with the rest of that block (D11).

#### D11 (item 11) — Keep the one component that already exists, and delete the fork: `reviewStyled` goes, and the review skin moves into the component

Per F11 there is nothing to merge; there is a fork to remove, and items 9/10/12/13 remove the constraint that created it.

- **`reviewStyled` is deleted** from `FileTree.vue`'s props and from every consumer (`ReviewFilesPane.vue:131`, `ReviewCommitRow.vue:225`). Its three effects become unconditional: the flat-mode dimmed-directory suffix (`:465-468`), the right-click "Copy path" `KuiContextMenu` (`:320-334`, `:522-530`), and the removal of the inline copy button (`:501-509`, deleted — the context menu is now the single copy affordance in every tree).
- **`ReviewView.vue:1252-1275`'s entire `.kv-skin-kira .kv-file-tree-*` block is deleted**, and its rules (row `gap`, `min-height: var(--kv-control-h)`, padding, and the `--kv-font-ui` assignments for directory names/stats/counts) move into `FileTree.vue`'s own `<style>` as its only appearance. The comment that justified the split is deleted with it, since the byte-identity guarantee it protected is dissolved by D12.
- **`showToolbar` stays.** It is not a fork of the component's anatomy — it is a real layout fact (the review panel owns one toolbar for two panes; the graph and stash panels each own exactly one tree, so the toolbar belongs to it). Its markup is nonetheless migrated onto D2's `KuiSearchInput`/`KuiSegmented`, so all three toolbars in the app share one implementation of each control even though they mount in different places.
- **`reviewStates` stays.** The reviewed checkbox and the changed-since-review dot are genuinely review-only *data*, absent for a commit's file list by construction — not a styling fork.
- **`StashDetailPane.vue`'s tree inherits the unified anatomy.** Stated plainly because it is a visible change to a G17 surface that no SPEC item names: the stash file list picks up per-extension icons, the plain status letter, the review row geometry, and the right-click copy-path menu. This is the point of item 11, and the alternative — a third variant flag to keep stash frozen — would reintroduce exactly the fork this decision removes.

The net is: **one component, one anatomy, one toolbar implementation, two genuine props left (`showToolbar`, `reviewStates`), zero cross-file skin overrides.**

#### D12 (item 12) — Every tree opens VS Code's own diff editor; `DiffView.vue` is deleted

- **Graph panel.** `DetailPane.vue:69-79`'s `<DiffView>` block is deleted. `FileTree`'s open event (D13) is wired to `props.actions.openInEditor({ sha, path, originalPath, parentIndex })`. `DetailState` loses `mode`, `diff`, `diffError`, `showTree()`, and its `commit.fileDiff` fetch and `#diffController`; `selectedFile` survives (it drives the row's selected highlight and the file cursor, both still meaningful). `DetailPane.vue`'s `fileTreeRef` refocus watch (`:54-61`) goes with the mode it watched.
- **Stash.** `StashDetailPane.vue:38-49` likewise; `StashState` loses `mode`/`diff`/`diffError`/`#requestFileDiff`/`#diffController`.
- **`App.vue`** loses the diff arms it kept for both: `:936-939`'s `closeDetail` branch (Escape now always closes the pane, never "goes back to the tree"), `:1221`'s `.kv-detail-drawer--diff` class binding, and `:1482-1490`'s full-width-diff-overlay CSS. `Alt+↑/↓` file-to-file navigation, which lived in `DiffView`, is not reimplemented — VS Code's own diff editor and its `workbench.action.compareEditor.*` navigation own that now.
- **`components/DiffView.vue` is deleted** (568 lines), together with `ReviewDiffAdornment`, which F12 confirmed has had no caller since G12 D12. `state/detail.ts`'s `FileDiffResult` type is kept only if `commit.fileDiff` still has a consumer after this pass; if not, the type alias goes too (checked at implementation time — the RPC itself stays on the wire, unused by this client).
- **The stash untracked case** (F12): `editor.openDiff`'s params gain `fallbackSha?: string`. `StashDetailPane`/`StashState` pass `entry.untrackedSha`. The handler (`proxyHandlers.ts:212-244`) retries its whole `commit.detail`-composition against `fallbackSha` when `path` is not among the primary sha's changed files, instead of throwing — a direct mirror of the retry `state/stash.ts:180-199` already implements for `commit.fileDiff`, moved to the one place that now needs it. When `fallbackSha` is absent the handler throws exactly as it does today.
- **No view-column or focus override.** Worth recording, because it is the obvious worry and it turns out not to apply: the graph webview lives in the **panel area**, not the editor area (`apps/kira-studio-vscode/package.json`'s `viewsContainers.panel[0] = kiraVersion`, with `views.kiraVersion[0].id = kiraVersion.graph`, type `webview`). Opening a diff in the editor group therefore does not cover or replace the graph — the two are visible simultaneously. The review view is in the activity bar, same story. So diffs open in the active editor group with default focus, exactly as the review panel's already do today.

#### D13 (item 13) — `pinned` on the wire, decided per call site; single click previews, double click and `Enter` pin

**Wire.** `editor.openDiff` and `editor.openRangeDiff` each gain `pinned?: boolean`. `ports/editorIntegration.ts`'s `openDiff` takes `pinned: boolean` and passes:

- `pinned === true` → `{ preview: false }` (today's behaviour, G19 D8's exact fix).
- `pinned === false` → **the fourth argument is omitted entirely**. Not `{ preview: true }`: omitting it is what actually "matches VS Code's own convention", because it lets VS Code's default *and the user's own `workbench.editor.enablePreview` setting* govern. A user who has turned preview tabs off globally gets pinned tabs from a single click, which is correct and which an explicit `preview: true` would fight.

**Call-site split**, exhaustive against F13's table:

| Call site | `pinned` | Why |
|---|---|---|
| `openAllChanges` (D8) | always pinned / multi-diff | item 8's original bug; never regressed |
| Review Commits-pane tree row, single click | `false` | navigational |
| Review Commits-pane tree row, double click / `Enter` | `true` | explicit "keep this" |
| Review Files-pane row (`openRangeDiff`), single click | `false` | navigational |
| Review Files-pane row, double click / `Enter` | `true` | |
| Graph tree row (new under D12), single click | `false` | navigational |
| Graph tree row, double click / `Enter` | `true` | |
| Stash tree row (new under D12) | same as graph | |
| `ReviewFilesState.setDiffMode`'s re-open (`reviewFiles.ts:138-145`) | `false` | a mode change re-showing the same file is navigational, not a new commitment |

**Interaction.** `FileTree.vue` gains one emit and one handler pair:

```ts
(e: 'openFile', fileIndex: number, pinned: boolean): void;
```

- `@click` → `onRowClick` keeps its existing directory-toggle/cursor behaviour and now emits `openFile(index, false)` for a file row. `selectFile` is retained as the *cursor/selection* emit and no longer implies opening anything.
- `@dblclick` → `openFile(index, true)`. Deliberately relies on the browser firing `click` first: a double click therefore opens the preview and then immediately re-opens the same diff pinned, and VS Code converts the existing preview tab into a permanent one rather than opening a second — which is exactly how VS Code's own Explorer behaves and is why no click-delay debounce is introduced (a debounce would add a visible lag to every single click to serve the rarer gesture).
- `Enter` (`:256-263`) → `openFile(index, true)`. Arrow keys keep moving the cursor and previewing via `selectRow`'s existing `selectFile`; `Enter` is the keyboard equivalent of the double click.

`DetailActions.openInEditor` gains `pinned: boolean`; `ReviewFilesState.selectFile(path, opts?: { pinned?: boolean })` likewise. Every implementation forwards it; no default is applied at the transport or handler level, so a caller that forgets it is a type error, not a silent pin.

### Test infrastructure

#### D14 — Put `packages/git-core/src` in `test:unit` (F14), and add the cases this phase's riskiest changes need

Root `package.json:38`'s glob gains `packages/git-core/src`. This immediately starts running ten existing, previously-dead test files; **if any of them fail on first run, that is triaged and fixed as part of this phase, not deferred** — a test that has never run is not a passing test.

New tests, all pure-function tiers:

- `packages/git-core/src/graph/lanes.test.ts` — **the first test in `src/graph`.** A hand-built `LayoutInput` for the canonical converge case (F3's worked example): assert the converging edge ends with `toLane === claimedLane` and `kind === EDGE_KIND_MERGE_IN`, and assert the **paged-equals-one-pass invariant** for the same topology (split at a chunk boundary that falls between the branch's last commit and the merge base, so the patch has to travel through `patches` — the exact path most likely to be wrong).
- `packages/git-ui/src/graph/rowSvg.test.ts` — D1's three-distinct-radii merge-at-HEAD case; D3c's three `MERGE_IN` row cases (first/pass-through/last) asserting the bend is in the last row and the run is in `fromLane`.
- `packages/git-ui/src/components/fileTreeModel.test.ts` — D9's table, including exact-filename precedence and the two path-shape rules.
- `packages/git-ui/src/state/viewState.test.ts` (new) — D5/D6a: a v4 blob (with `columnWidths.sha`) is rejected by `parsePersistedViewState`; a v5 blob without it round-trips.
- `packages/git-ui/src/components/dateFormat.test.ts` — D6b's `measureAbsoluteDateWidth` guarded behind a canvas-availability check (bun's test environment has no DOM; the assertion is on the pure formatter's own widest-output invariant, with the measurement itself covered by the Playwright tier below).
- `apps/kira-studio-vscode/src/proxyHandlers.test.ts` — D8a's `editor.openAllChanges` composing N resource triples from one `commit.detail`; D12's `fallbackSha` retry path; D13's `pinned` reaching the fake editor port as `{preview:false}` vs. an omitted options argument.

Playwright (`apps/kira-studio-vscode/tests/interaction/`), extending the fake-transport fixture G19 §4.2 built and G20 reused:

- `file-tree-open.spec.ts` — single click emits one preview open; double click emits a preview open followed by a pinned open; `Enter` emits one pinned open. Asserted against a recording fake of the `editor.*` methods, which is the level at which "which options argument was passed" is actually observable.
- `graph-columns.spec.ts` — the grid renders four columns, no `.kv-cell-sha` node exists anywhere, and the date cell's rendered width is `>=` the measured absolute-date width at the harness's font.

Not covered by any automated tier, and why: D8b's multi-file diff editor and D7's status-bar removal both need a real VS Code host; D4's badge tint and D3's rendered geometry are visual (the geometry math is covered above, the pixels are a Tier-3 check).

---

## 3. Implementation, file by file

### `packages/kira-ui/src` (additive)

| File | Change | Item(s) |
|---|---|---|
| `KuiDialog.vue` | **New** — modal shell + focus trap | D2 |
| `modalFocus.ts` | **New** — `useModalFocus`, moved verbatim from `git-ui` | D2 |
| `KuiSegmented.vue` | **New** — one implementation of four toggle groups | D2 |
| `KuiSearchInput.vue` | **New** — `KuiTextInput` + search icon + clear | D2 |
| `KuiSelect.vue` | **New** — styled native `<select>` | D2 |
| `KuiButton.vue` | `variant` gains `'ghost'` | D2 |
| `theme/controls.css` | Rules for the above; new `--kui-z-modal` rung | D2 |
| `index.ts` | Export the five new symbols | D2 |

### `packages/git-core/src/graph`

| File | Change | Item(s) |
|---|---|---|
| `lanes.ts` | `MutableState.laneEdge`; step 2 patches converging edges | D3a, D3b |
| `types.ts` | `LayoutFrontier.laneEdge`; patch-record stride widens to 4 | D3a, D3b |
| `edges.ts` | `patchConvergence`; `patches` becomes 4-wide | D3b |
| `lanes.test.ts` | **New** — F14's first `src/graph` test | D14 |

### `packages/git-ui/src`

| File | Change | Item(s) |
|---|---|---|
| `graph/geometry.ts` | `headRingRadius: 5.6` | D1 |
| `graph/rowSvg.ts` | HEAD ring uses the new radius; `edgeCommand` gains the `MERGE_IN` branch | D1, D3c |
| `graph/rowSvg.test.ts` | Merge-at-HEAD radii; three `MERGE_IN` row cases | D14 |
| `graph/layoutStore.ts` | `#applyPatches` reads the widened record | D3b |
| `components/refBadges.ts` | `laneColor` param; `data-kui-tip` instead of `.title` | D4, D2 |
| `components/columns.ts` | `LaneColorContext`; SHA column, `shaFormatter`, `ShaCopyContext` deleted | D4, D5 |
| `components/CommitGrid.vue` | Lane-colour context supplied; SHA column integration removed (prop, emit, handle, focus machinery, CSS); measured date width + minimum | D4, D5, D6b |
| `state/viewState.ts` | `ColumnWidths` loses `sha`; `version` 4 → 5 | D5, D6a |
| `state/viewState.test.ts` | **New** | D14 |
| `components/dateFormat.ts` | `measureAbsoluteDateWidth` | D6b |
| `components/CommitMeta.vue` | One click-to-copy short SHA; both copy buttons gone; `.kv-copy-button` CSS deleted | D5, D2 |
| `components/FileTree.vue` | `reviewStyled` deleted, review anatomy adopted; status chip → plain letter; `openFile(index, pinned)` + `@dblclick`; toolbar → `KuiSearchInput`/`KuiSegmented`; parent picker → `KuiSelect` | D9-D13, D2 |
| `components/fileTreeModel.ts` | Per-extension/per-filename icon tables | D9 |
| `components/fileTreeModel.test.ts` | D9's table | D14 |
| `components/DetailPane.vue` | `DiffView` block deleted; tree open → `actions.openInEditor` | D12, D13 |
| `components/StashDetailPane.vue` | Same, plus `fallbackSha: entry.untrackedSha` | D12 |
| `components/DiffView.vue` | **Deleted** | D12 |
| `state/detail.ts` | `mode`/`diff`/`diffError`/`showTree`/fileDiff fetch removed | D12 |
| `state/stash.ts` | Same | D12 |
| `state/detailActions.ts` | `openInEditor` gains `pinned`; new `openAllChanges` | D8, D13 |
| `state/review.ts` | `#createRowActions` forwards both | D8, D13 |
| `state/reviewFiles.ts` | `selectFile(path, {pinned})`; `#openInEditor` passes it | D13 |
| `components/review/ReviewCommitRow.vue` | `openAllChanges` awaited + announced; open path passes `pinned` | D8, D13 |
| `components/review/ReviewFilesPane.vue` | Diff-mode group → `KuiSegmented`; open passes `pinned` | D2, D13 |
| `components/review/ReviewView.vue` | Pane/list-mode groups → `KuiSegmented`; `.kv-skin-kira .kv-file-tree-*` block deleted | D2, D11 |
| `components/dialogs/*.vue` (×11) | `KuiDialog` + `KuiButton`; all duplicated modal CSS deleted | D2 |
| `components/dialogs/modalFocus.ts` | **Deleted** (moved to `kira-ui`) | D2 |
| `App.vue`, `BranchPicker.vue`, `TagList.vue`, `StashList.vue`, `RepoPicker.vue`, `SearchBox.vue`, `SearchResults.vue`, `LoadMoreButton.vue`, `ConflictBanner.vue`, `NoRepositoryPanel.vue`, `ReviewCommentsPane.vue`, `BaseSelector.vue` | Remaining raw buttons/inputs/selects → Kui primitives; `App.vue` also loses the diff-drawer arms and `@copy-sha` | D2, D5, D12 |
| `icons/codicon.css`, `icons/index.ts` | ~14 new glyphs | D9 |

### `packages/git-ipc/src`

| File | Change | Item(s) |
|---|---|---|
| `contract.ts` | `editor.openAllChanges`; `pinned?` on `openDiff`/`openRangeDiff`; `fallbackSha?` on `openDiff` | D8, D12, D13 |
| `validate.ts` | `CONTRACT_VERSION` 23 → 24; `'editor.openAllChanges': true` | D8 |

### `apps/kira-studio-vscode`

| File | Change | Item(s) |
|---|---|---|
| `src/ports/editorIntegration.ts` | `openDiff(…, pinned)`; new `openAllChanges` with the `vscode.changes` probe + sequenced fallback | D8, D13 |
| `src/proxyHandlers.ts` | `editor.openAllChanges` handler; shared `DocumentRef` composition helper; `fallbackSha` retry; `pinned` forwarded on both diff methods | D8, D12, D13 |
| `src/proxyHandlers.test.ts` | Three new cases | D14 |
| `src/extension.ts` | Status-bar setting, gate and config-listener arm deleted | D7 |
| `package.json` | Whole `contributes.configuration` key deleted | D7 |
| `README.md` | Prose for the removed setting | D7 |
| `tests/interaction/file-tree-open.spec.ts` | **New** | D14 |
| `tests/interaction/graph-columns.spec.ts` | **New** | D14 |

### Root

| File | Change | Item(s) |
|---|---|---|
| `package.json` | `test:unit` glob gains `packages/git-core/src` | D14 |

**Not touched anywhere in this phase:** any `internal/**` Go package, `internal/gitwire`'s FlatBuffers schema, `packages/api-core`, any file under `apps/kira-studio/frontend/src` (including its `kui-bridge.css`, which needs only the one new `--kui-z-modal` line and gets it), and anything G20 already migrated.

---

## 4. Test plan

**Tier 1 — `bun run test:unit`** (now including `packages/git-core/src`): D14's full list, plus the ten previously-dead `git-core` test files, which must all pass.

**Tier 2 — `bun run test:webview`**: the two new interaction specs, plus the existing `review-interaction`, `kui-floating-geometry`, `commit-meta-clamp` and `webview-layout` specs, which must still pass — `commit-meta-clamp` and `webview-layout` both touch surfaces D2/D5 change and are the early-warning signal for a broken migration.

**Tier 3 — a human, on a Mac, with VS Code and Kira Studio running:** merge-at-HEAD shows both rings; a branch's oldest commit's line bends into and meets its merge base; ref badges are tinted to their lane; there is no SHA column and the details panel's short SHA copies the full one on click; the date column shows a full absolute timestamp at both a small and a large `editor.fontSize`, **including for a profile that used the app before G19**; no Kira Version section appears in VS Code's settings UI and the status-bar item is always present; "Open all changes" on a 14-file commit opens one multi-file diff editor showing every file's hunks; file rows show per-extension icons and a bare coloured status letter; a single click on a file in *either* panel opens an italic preview tab that the next single click replaces, and a double click makes it permanent; the graph and stash panels never render an in-webview diff again.

---

## 5. Non-goals

- **No revert of G19's `{ preview: false }`.** It stays, scoped to bulk opens (D8/D13).
- **No re-fix of G19's D1 HEAD ring or D2 date widening.** D1 fixes a distinct overlap defect; D6 fixes reachability and font-fragility. Neither re-implements what G19 shipped.
- **No re-audit of anything G20 migrated.** Item 2 is strictly the complement.
- **No migration of `apps/kira-studio/frontend`** onto the new primitives.
- **No custom listbox for `<select>`**, and no migration of `SearchBox.vue`'s combobox input or `SearchResults.vue`'s listbox.
- **No file-icon theme font.** D9 goes as far as codicons genuinely go and says so.
- **No in-webview diff anywhere**, and no reimplementation of `DiffView`'s `Alt+↑/↓` navigation — VS Code's diff editor owns that surface now.
- **No cleanup of a user's orphaned `kiraVersion.statusBar.enabled` value**, matching G18 D11's own precedent.
- **No Go changes and no FlatBuffers change.** `go test ./...` should touch zero files this phase edits.

---

## 6. Implementation order

One sequential subagent. `git fetch` / `git status` / `git log` immediately before the closing commit as well as at the start.

1. **`packages/kira-ui`'s five new primitives** + the `modalFocus.ts` move, typechecked in isolation. Everything in item 2 depends on them.
2. **D14's glob wiring** (`packages/git-core/src` into `test:unit`) — done second, so the ten dead test files' status is known before any core change lands on top of them, not after.
3. **D3 (`packages/git-core` graph math) + its new test.** The riskiest change in the phase; landed alone, early, against a green baseline.
4. **D1, D4 (graph rendering)** — small, and they read naturally in the same commit as D3's own rendering half.
5. **D5 + D6 together.** They must not be separated: D6's fix is delivered by D5's version bump.
6. **D9, D10 (file-tree glyphs)** — independent, mechanical.
7. **D12, then D13, then D11**, in that order: remove the embedded diff first (which is what dissolves the byte-identity constraint), then add the preview/pin interaction to the one open path that now exists, then delete `reviewStyled` and fold the skin in once there is nothing left forking.
8. **D8** (contract + host + client) — after D13, since it shares the `CONTRACT_VERSION` 24 bump and the `DetailActions` shape.
9. **D7** — self-contained, landed on its own.
10. **D2's migration** last: it touches ~30 files superficially and would otherwise conflict with every step above. Dialogs first, then segmented groups, then inputs/selects, then the remaining buttons, then the `refBadges.ts` tooltip fix.
11. **Full check pass**: `bun run lint`, `bun run typecheck`, `bun run test:unit`, `bun run build:vscode`, `bun run test:webview`, `go test ./...`.

---

## 7. Exit criteria

### 7.1 Provable in this container

1. `bun run test:unit` passes, **including `packages/git-core/src`'s ten previously-unrun files** and every new case.
2. `bun run test:webview` passes, including the two new specs.
3. `bun run lint`, `bun run typecheck`, `bun run build:vscode` pass.
4. `CONTRACT_VERSION` is **24**; `git diff` on `contract.ts`/`validate.ts` shows one new method, three new optional params, and the version bump — nothing else changed shape.
5. `grep -rn 'statusBar' apps/kira-studio-vscode/src apps/kira-studio-vscode/package.json` returns only `statusBarItem.errorBackground` theme references.
6. `grep -rn 'reviewStyled\|kv-file-tree-status-chip\|kv-modal-backdrop\|kv-mode-active\|SHA_COLUMN_ID' packages/git-ui/src` returns nothing.
7. `grep -rn '\.title = ' packages/git-ui/src --include=*.ts` returns nothing.
8. `packages/git-ui/src/components/DiffView.vue` does not exist.
9. `go test ./...` touches zero files this phase changed.

### 7.2 Checklist

- [ ] G19's `{ preview: false }` still exists, on the bulk path only.
- [ ] A merge commit at HEAD renders three circles at three distinct radii.
- [ ] A converging edge carries `EDGE_KIND_MERGE_IN` and a patched `toLane`, and the paged run equals the one-pass run.
- [ ] `PersistedViewState.version` is 5 and a v4 blob is rejected whole.
- [ ] `contributes.configuration` no longer exists in the extension manifest.
- [ ] `FileTree.vue` has two props left beyond its data (`showToolbar`, `reviewStates`) and one appearance.
- [ ] Single click omits the `preview` option entirely; double click and `Enter` pass `{ preview: false }`.
- [ ] `packages/git-core/src` is in `test:unit` and `src/graph` has real tests.

---

## 8. Calls that want a human eye — with a recommendation for each

*This phase is being run autonomously; each recommendation below is the decision that will be taken unless a human overrides it, and is written as such.*

**1. How far item 2's "everything" actually goes.** Taken literally it is ~90 buttons across 33 files plus 11 dialogs — a multi-day migration that dwarfs the other twelve items. **Recommendation: the scope in D2 — four new primitives plus a complete migration of dialogs, segmented groups, filter inputs, `<select>`s and remaining buttons inside `packages/git-ui`, deleting every duplicated CSS block found in F2, and explicitly exempting `SearchBox.vue`'s combobox and `SearchResults.vue`'s listbox.** The duplication F2 documents (modal CSS redeclared in four files, four independent segmented toggles, one component depending on another's private `.kv-copy-button` block) is real drift that will keep costing, and item 2 is the only mandate this project will get to close it.

**2. D3's widened patch record vs. re-deriving convergence at read time.** The alternative is to leave `lanes.ts` alone and have `layoutStore.segmentsInRow` notice at read time that the target row's `laneOf` differs from the segment's `toLane`. **Recommendation: widen the patch record (D3b).** The read-time alternative is cheaper to write but puts topology logic in the hot per-row read path that `segmentsInRow`'s allocation-free contract exists to keep fast, and it would silently disagree with the layout worker's own frontier. The patch route is where `toRow` resolution already lives and is the only route that keeps the paged-equals-one-pass invariant checkable in one test.

**3. How far D4's lane tint goes on a badge.** Border+icon (recommended) vs. full lane-coloured fill. **Recommendation: border + icon only.** `--kv-lane-N` is tuned for 1.6px strokes, not for text backgrounds; a full fill would fail contrast on several lanes in several VS Code themes, and §6.1's no-colour-only-meaning rule means the icon and pill/square shape must carry the kind regardless. If a human wants the stronger look, the change is one CSS declaration.

**4. Discarding persisted view state via a version 4 → 5 bump.** Users lose column widths, scroll position, selected sha and search toggles once. **Recommendation: bump.** `ColumnWidths` genuinely changes shape when the SHA column goes, `parsePersistedViewState`'s own documented policy is all-or-nothing, and — decisively — the bump is what finally delivers G19's date-width fix to the people who reported it twice. A bespoke v4→v5 migrator would preserve four numbers at the cost of a migration path this file has never had.

**5. Measured vs. constant date-column width (D6b).** **Recommendation: measured.** G14 already made the type scale follow VS Code's own font settings, so any hard-coded pixel value is wrong at some font size, and the item has now been reported twice. ~20 lines, using the `TokenReader` re-read signal that already exists. If the canvas measurement proves unreliable in the webview, the `Math.max(152, …)` floor means the fallback is exactly today's behaviour.

**6. Using VS Code's multi-file diff editor for "Open all changes" (D8b).** `vscode.changes` is a built-in command with no entry in `@types/vscode`, so it cannot be typechecked and cannot be tested in this container. **Recommendation: use it, behind a `getCommands(true)` probe, with the sequenced per-file loop as the fallback.** It is literally what item 8's own words ask for ("all files' hunks"), it collapses N round trips and N focus steals into one, and the fallback path is strictly better than today's regardless (sequenced, error-reporting, `preserveFocus`). Worst case the probe fails and the user gets the improved fallback.

**7. D9's icon ceiling.** Codicons have no per-language file icons; the only way to real per-language icons is vendoring a Seti/Material icon font. **Recommendation: stay within codicons, with the ~90-entry per-extension/per-filename table, and state the ceiling in the module doc.** SPEC says "from codicons"; vendoring a second icon font is a licensing, bundle-size and theme-consistency decision well outside a polish batch, and a stated ceiling is a better artefact than a silently coarse map.

**8. Whether the stash detail pane joins item 12.** SPEC names "both diff file trees" (graph, review); stash is a third tree inside the graph webview. **Recommendation: include it, and delete `DiffView.vue` entirely.** Excluding it would keep a 568-line component alive for one caller, keep a second `mode: 'diff'` state machine and a second `commit.fileDiff` path, and — worst — force `FileTree.vue` to keep a variant flag for stash, reintroducing precisely the fork item 11 exists to remove. The one real technical obstacle (untracked stash files) has a two-line answer that mirrors machinery `state/stash.ts` already documents.

**9. `Enter` semantics in the file tree (D13).** Preview (matching arrow-key browsing) vs. pinned (matching double click). **Recommendation: pinned.** VS Code's own Explorer treats `Enter` as the keyboard equivalent of a double click, arrow keys already preview via the existing cursor path, and the alternative leaves keyboard users with no way at all to pin a tab from the tree.

**10. Deleting `reviewStyled` and unifying the three trees' anatomy (D11).** The graph and stash file lists visibly change appearance — row geometry, the copy affordance moving from an inline button to a right-click menu — and no SPEC item names the stash pane. **Recommendation: delete it and unify.** Item 11's whole content is "one component, not separate implementations", and items 9/10/12/13 already change the graph tree's appearance and behaviour, so the byte-identity guarantee the fork protected no longer has anything to protect. Keeping a third variant flag for stash alone would be the same mistake in a smaller shape.

**11. Adding `packages/git-core/src` to `test:unit` (D14).** This starts running ten test files that have never run; some may fail. **Recommendation: add it, and fix whatever fails as part of this phase.** D3 is the only change in this phase to core graph math and would otherwise land with no test tier at all under it. A test suite that has never executed is not evidence of anything, and discovering that now — while a human is reviewing this batch — is strictly better than discovering it during a later phase's unrelated change.

**12. Whether D8's multi-diff path makes the fallback's `{preview:false}` inconsistent.** In multi-diff mode there is one editor; in fallback mode there are N pinned tabs. **Recommendation: keep the fallback pinned.** Un-pinning it would recreate the exact original item-8 bug on the very path that exists to handle a host where the better option is unavailable, and the two modes are already distinguishable to the user (and reported in the announcement's own wording).
