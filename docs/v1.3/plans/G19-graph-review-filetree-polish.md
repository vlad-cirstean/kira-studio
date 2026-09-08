# G19 — Git graph, review panel, and file-tree polish batch

> **What this phase is.** SPEC's G19 row is fifteen distinct findings from real, hands-on use of the
> shipped extension, across three areas: the commit-graph panel (items 1-4), the branch-review
> sidebar (items 5-12), and the file-tree/file-list component the first two areas share (items
> 13-15). Two of the fifteen (8, 10) are real behavioural bugs with a single, mechanical root cause
> each — both confirmed here against the actual code, not assumed from the bug report's own
> phrasing. One (3) is a real component-library gap; another (11) is a real state-loss bug plus a
> "no way back" gap. Both were investigated once, planned once, then **revised after the user
> answered §8's original human-eye questions** — this document is that revision, described in full
> below rather than as a diff against the first pass, per this chapter's own convention (G12/G14/G15
> all record corrections in the plan itself, not a second document).
>
> **This revision changes one constraint stated flatly in the first pass.** The original plan said,
> four separate times, "no `CONTRACT_VERSION` bump, anywhere." That is no longer true: D11's revised
> persistence design (below) needs the webview to hand the extension host a small amount of state to
> write durably, and the only channel the webview has back to the extension host is `git-ipc`'s own
> RPC contract. **`CONTRACT_VERSION` moves from 21 to 22** — one new method, `review.session.save`,
> additive only (no existing method's shape changes). Every other item in this phase still needs no
> wire change; this is called out explicitly here, and again at every place the original plan
> asserted otherwise, so the reversal is never silently inconsistent with itself.
>
> **Three of the four §8 answers changed real design decisions, not just preferences:**
> 1. **§8.1 (shared component package)** — diverged from "not this phase" to "build it now." §2 D3
>    below designs and scopes a new `packages/kira-ui` package with a real token-injection contract.
> 2. **§8.2 (back button)** — the user's own wording narrowed and corrected the original framing:
>    not a browsing history, a single "I can't get back to branch selection at all" gap. F11 below
>    re-investigates `ReviewView.vue`'s actual state machine to confirm that reading, and D11 replaces
>    the original multi-entry history stack with a one-step "back to selection" affordance.
> 3. **§8.5 (persistence durability)** — diverged from "hide/reveal only" to "survive window
>    reload/restart too." D11 below designs the durable layer, including the staleness question the
>    original plan correctly flagged but left open — resolved here, not deferred again.
>
> §8.4 (the new Playwright fixture) was accepted as recommended and needs no change.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Originally authored against `claude/feature-v1-3-headless-git` at `c0339a11`, committed as `957a7bb4`.
This revision is authored against the branch as it stands after that commit, with G17 (stash) still
landing concurrently — confirmed again immediately before this revision's own commit
(`git fetch`/`git status`/`git log`), same discipline as the first pass. This revision touches no
file under active G17 development (`internal/gitclient`, `internal/gitops`, `StashList.vue`,
`StashDetailPane.vue`, `state/stash.ts`); D3's new shared context-menu primitive is specifically
designed (below) so that `StashList.vue` — a `RowContextMenu` consumer G17 is concurrently writing —
needs no change at all, not merely "no change in this pass."

### 0.2 Scope, and the 1:1 map every item below is traceable through

| Area | Items | Findings | Decisions |
|---|---|---|---|
| Git Graph | 1-4 | F1-F4 | D1-D4 |
| Review bar | 5-12 | F5-F12 | D5-D12 |
| File tree | 13-15 | F13-F15 | D13-D15 |
| Test infra (not its own SPEC item) | — | F16 | D16 |

Every one of the fifteen SPEC items still gets exactly one `F<N>`/`D<N>` pair, numbered to match
SPEC's own G19 row. F11/D11 are rewritten in full in this revision; every other pair is unchanged
from the first pass except where explicitly noted (D3's package wiring touches D3a/D3b's own file
list, and the `CONTRACT_VERSION` bump touches §3/§5/§7's bookkeeping everywhere it was mentioned).

### 0.3 Ground rules

- **Verify before fixing** — unchanged from the first pass; F11's re-investigation below is this
  rule applied to the user's own correction, not just to the original bug report.
- **No `packages/git-ui` behaviour changes to `DetailPane.vue`/`StashDetailPane.vue`** from the
  review-panel-scoped items — unchanged, still gated on the existing `reviewStyled` prop.
- **`CONTRACT_VERSION` moves 21 → 22, for exactly one reason.** Confirmed live in
  `packages/git-ipc/src/validate.ts:24` at both investigation passes. §2 D11 states the one new
  method; nothing else in this phase touches the contract.
- **The new shared package is additive, not a migration.** Per the user's own instruction ("don't
  turn this into a full design-system migration of either existing frontend"), `apps/kira-studio/
  frontend`'s own existing `AppButton.vue`/`IconButton.vue`/`ContextMenu.vue` are **not** deleted,
  rewritten, or had their call sites swapped in this phase — D3 states precisely what does and does
  not change there.
- **No G17 file is touched, and D3's own migration strategy is designed specifically so that
  remains true even though `RowContextMenu.vue` — which `StashList.vue` (a G17 file, actively being
  written) imports — changes internally.**

---

## 1. Findings

*(F1, F2, F4-F10, F12-F16 are unchanged from the first pass — restated here in full so this document
stands alone, per this chapter's own convention of not requiring a reader to cross-reference a
superseded version. F3 gains one migration-safety addendum, folded into D3 rather than renumbered,
per this revision's own brief. F11 is fully rewritten.)*

### Git Graph

#### F1 — A checked-out indicator already exists on the row and the branch badge, but nowhere in the graph column itself

Two real, already-shipped indicators for "this row is HEAD":

- `packages/git-ui/src/components/columns.ts:35-37,269-274` — `rowMetadata` adds a `kv-row-head`
  class to any row whose decorations include `head` or a `branch` with `isHead: true`;
  `CommitGrid.vue:910-912` renders that class as `font-weight: 600`.
- `packages/git-ui/src/components/refBadges.ts:53-65,178-188` — `badgeSpecFor`'s `branch` case sets
  `isCurrentBranch: ref.isHead`, which `buildBadgeElement` renders as a 5×5px `kv-badge-dot`
  (`CommitGrid.vue:1054-1059`, filled with `--kv-focus-border`) appended to that one branch pill.

Both are wired correctly end to end — `IsHead` is a real field threaded from
`gitclient/porcelain/refs.go:80` through `gitwire/DecorationRef.go:81-82` to
`@kira/git-core`'s `DecorationRef`, confirmed by `gitstore/encode_test.go:121`'s own assertion.
**Neither lives in "the graph"** in the sense the SPEC item and the SVG lane column itself mean it:
`packages/git-ui/src/graph/palette.ts:31` defines exactly three `NodeKind`s — `'commit' | 'merge' |
'stash'` — and `rowSvg.ts:161-184`'s `planNode` draws one of three shapes accordingly. There is no
fourth shape, and no HEAD-aware styling of any kind, in the graph column's own node/edge rendering.
The existing row-bold/badge-dot indicators are kept; this item's real, narrower gap is the graph
column itself.

`is-head` data is already known client-side at exactly the point `rowSvg.ts` needs it:
`graphColumn.ts:52`'s `readSlice` already calls `isStashRow(store.decorationAt(row))` for the same
row the graph formatter draws — `store.decorationAt(row).some(isHeadDecoration)` is the identical
shape, and `columns.ts:35-37`'s own `isHeadDecoration` is already the single source of truth (not
duplicated) for the row-bold indicator. No new state, no new RPC.

#### F2 — The date column's default width clips its own content, silently

`packages/git-ui/src/state/viewState.ts:62` — `DEFAULT_COLUMN_WIDTHS = { author: 140, date: 120,
sha: 80 }`. `formatAbsoluteDate` (`dateFormat.ts:47-52`) produces `"2024-03-14 09:41"` — 16
characters, rendered through `.kv-cell-date` (`CommitGrid.vue:1061-1065`), which sets
`font-variant-numeric: tabular-nums` but no monospace font-family (inherits the proportional
`--kv-font-family`) and, critically, **no `text-overflow: ellipsis`** — unlike
`.kv-message-subject`/`.kv-cell-author`, which both have one. An absolute-format date that overflows
120px is silently clipped by the cell's own `overflow: hidden`, not truncated-with-an-affordance.
Confirmed exactly as reported.

#### F3 — Toolbar and context menu are ad hoc; a real, richer design system exists but lives in a different app, on a different token system, with incompatible state ownership

`AppToolbar.vue` (buttons: lines 219-229, 240-274, 278-288, 298-311) and `RowContextMenu.vue`
(lines 157-195) are hand-built `<button>`/`<div role="menu">` markup styled directly against
`--kv-*` tokens — functional (real ARIA menu semantics, full keyboard roving focus, focus-return —
already genuinely correct), but visually ad hoc: menu items carry no icon at all, buttons mix
icon+text and icon-only inconsistently, and **the toolbar button CSS is already duplicated, not
shared**: `AppToolbar.vue:340-342`'s own comment admits `.kv-toolbar-button` "is shared with
`PullStrategyPicker.vue`'s own trigger buttons... defined identically in both places rather than one
importing the other's CSS."

A real, materially richer design system exists, entirely inside `apps/kira-studio/frontend` (Kira
Studio's own Wails UI, not this extension): `theme/primitives.css` (`.p-btn`/`.icon-box`/`.p-row`,
with a stated law that "icons never float unboxed next to text" — `AppButton.vue:6`),
`theme/primitives/AppButton.vue`/`IconButton.vue`, and `workbench/ContextMenu.vue` (a genuinely more
capable menu: per-row icon-box including a colour-swatch variant, submenus with flip-aware
floating-ui positioning, a `danger` visual variant, checked-state, inline keyboard shortcuts) backed
by `theme/tokens.css`'s own `--kira-*` palette and a page-global reactive singleton,
`state/contextMenu.ts`'s `contextMenuState`.

**This cannot be imported as-is**, for two independent reasons: (1) **token mismatch** — `--kira-*`
is Kira Studio's own fixed dark palette; `packages/git-ui`'s whole design is to disappear into VS
Code's own theme; (2) **state-ownership mismatch** — `ContextMenu.vue` assumes exactly one menu
instance for the whole page via a shared singleton, the opposite of `packages/git-ui`'s own
already-correct per-instance ownership (`App.vue`'s local `menuState`,
`ReviewCommitRow.vue:86-92`'s own local `ref`) — two separate webview documents (graph panel, review
sidebar) cannot share one singleton.

`packages/shared` (`@kira/shared`) — the one workspace package both apps already import — holds zero
Vue/UI code today (protocol/domain types only). It is not a component-library seam waiting to be
used; one does not exist. **This finding stands as the reason a new package is designed from
scratch in D3, not the reason to skip one** (the original plan's own conclusion; only the "skip it"
half changes per the user's §8.1 answer).

#### F4 — The graph's commit-detail message renders in full, with no truncation; the "tree of changes below it" already exists

`CommitMeta.vue:181` — `bodyParagraphs` renders into one unbounded `<p ref="bodyEl">`, no
`max-height`, no line-clamp, no expand affordance. Confirms the truncation half of the item exactly.
The second half — "the tree of changes... the same way the review panel already does" — is already
true: `DetailPane.vue:82-113` renders `<CommitMeta section="message">`, then `<FileTree>`, then
`<CommitMeta section="details">`, through the identical `FileTree.vue` the review panel uses.

### Review bar

#### F5 — The two compared branches sit on one line, with no swap

`ReviewView.vue:554-566`: one flex row — icon, `review.branch` (plain text), a static `↔`, then
`BaseSelector`'s trigger. No stacking, no invert control. Confirmed exactly as reported.

#### F6 — The review-panel filter is a permanent input, not a revealed one

`ReviewView.vue:613-620` — always-rendered `<input>`, unlike `BaseSelector.vue:129-136`'s own filter,
which already gates behind opening its dropdown. Confirmed.

#### F7 — Two genuine copy-icon affordances remain in `ReviewCommitRow.vue`, even though a working copy context-menu item already exists

`rowMenuModel.ts:91-96`'s `buildReviewRowMenu` already offers `copySha`/`copyMessage` as menu items.
`ReviewCommitRow.vue:189-197`/`214-222` independently duplicate that as two clickable copy
affordances. `FileTree.vue:454-462`'s "Copy file path" button has no context-menu equivalent —
`FileTree.vue` has no right-click handling at all today.

#### F8 — "Open all changes" really does loop every file; the bug is that VS Code's diff command reuses one preview tab across the loop

`ReviewCommitRow.vue:117-134`'s `openAllChanges` correctly iterates every file. The defect is
`ports/editorIntegration.ts:85-92`'s `openDiff`, which calls `vscode.commands.executeCommand
('vscode.diff', ..., req.title)` with **no fourth `TextDocumentShowOptions` argument** — no
`{ preview: false }`. Every sequential call reuses the same preview tab, so only the last file's
diff survives. Root-caused to one missing options argument on one line, not a data bug.

#### F9 — There is no marker at all for a virtual (non-existent-on-disk) document, and no mechanism exists to add one yet

Every diff shows `DocumentRef`s of kind `'empty'` (self-evidently blank) or `'virtual'`
(`kira-version:` scheme, resolved by `registerVirtualDocuments`). No `vscode.FileDecorationProvider`
is registered anywhere (`grep registerFileDecorationProvider apps/kira-studio-vscode/src` — zero
hits). `virtualKey.ts:12-21,33-43` already carries `{repoId, rev, path}` recoverable from any such
URI, and `repoId` is the worktree's absolute root, so a live-disk existence check is straightforward.

#### F10 — Confirmed: `FileTree.vue`'s row click never stops propagation, and `ReviewCommitRow.vue`'s outer wrapper's click handler unconditionally toggles

`FileTree.vue:398`'s `@click="onRowClick(index)"` has no `.stop`, and `onRowClick` never calls
`stopPropagation()`. `ReviewCommitRow.vue:163-173`'s **entire row** — header and, when expanded, body
(where `<FileTree>` mounts) — is one element carrying `@click="onRowClick"` (`:170`), and
`onRowClick` (`:58-61`) unconditionally emits `toggle`. A click on any file row bubbles straight up
and collapses the very commit it was clicked inside. Root-caused to two specific lines.

#### F11 — Re-investigated per the user's own correction: `ReviewView.vue` has exactly two steps today, and moving from the first to the second is a one-way transition with no control to reverse it

*(Rewritten for this revision. The original F11 established that state is lost on hide/reveal; that
finding stands, restated below alongside the new investigation the user's own §8.2 answer asked
for.)*

**The state-machine question, answered directly**: does `ReviewView.vue` already have an internal
notion of "picking branches" vs. "reviewing," and is moving between them one-way today? **Yes to
both**, confirmed by re-reading the template's own branching, not inferred:

- `ReviewView.vue:503-547` — `v-else-if="!review.branch.value"` — the **selection step**: a branch
  filter and two lists (Branches, Remote branches), rendered whenever `ReviewSessionState.branch` is
  unset. `pickBranch(name)` (`:293-297`) is the only way out of this step: it calls
  `applyTarget(id, name)` → `review.setTarget(repoId, branch)`.
- `ReviewView.vue:549-760` — the `v-else` branch — every other rendered state (`resolving`, `ask`,
  `unrelated`, `empty`, `listing`, `error`) — the **comparison step**, reached the instant `branch`
  becomes non-null.
- `ReviewSessionState.setTarget` (`state/review.ts:136-150`) sets `this.branch.value = branch` and
  never sets it back to `undefined` anywhere in the class. **No method on `ReviewSessionState`
  clears `branch` back to `undefined`** (confirmed by reading every method on the class — `setBase`,
  `loadMore`, `acknowledgeStaleReview`, `expand`/`collapse`/`toggle`, `#checkForChange` — none of
  them touch `branch.value`). Once `branch.value` is set, the template's own `v-else-if` guard
  (`:503`) can never be true again for the life of this `ReviewSessionState` instance.

**So the user's own, corrected report is exactly right, and is a narrower, simpler bug than the
original plan's framing**: this is not "no browsing history exists" (a feature gap the original plan
treated as needing a multi-entry stack), it is "the transition from step 1 to step 2 has no reverse
edge at all" (a single missing control in an otherwise-ordinary two-step flow). There has never been
any notion of "the previous branch I was comparing" to browse back through in the first place —
today, picking a second branch to review (via the toolbar's `SearchBox`, or any future entry point)
simply replaces the current comparison in place; there is no list of prior comparisons anywhere in
this class for a history stack to be built from. **The original D11's multi-entry `#history` stack
therefore was not just larger than needed — it was solving a problem this component does not
actually have.**

**The state-persistence half of the original F11 stands, restated**: `webview/main.ts:107-114`
constructs `NullViewStateStore` for the review branch; `state/viewState.ts:147-155`'s
`NullViewStateStore` discards everything by design (§6.8/D41); `reviewView.ts:57-61` carries no
`retainContextWhenHidden`, so VS Code destroys the webview's JS heap on every hide and
`resolveWebviewView` reruns from nothing on every reveal. `webview/main.ts:59-73`'s
`VsCodeApiViewStateStore` — the exact mechanism the graph panel already uses to survive this — sits
one `if`-branch away, unused for review.

**What's newly relevant to D11's durability half**: `VsCodeApiViewStateStore`'s own doc comment
(`main.ts:57-58`) is explicit that `getState()/setState()` is "the mechanism a hidden/recreated
webview view survives through" — VS Code's own documentation for this API (and this repo's own
`retainContextWhenHidden`-adjacent commentary elsewhere) does not claim it survives a full window
reload/restart for a `WebviewView` the way `context.workspaceState` is explicitly designed to. Since
the user's §8.5 answer requires window-reload/restart survival specifically, D11 below builds the
durable layer on `context.workspaceState` (a real extension-host API, already available to
`KiraReviewViewProvider` via a small, mechanical addition to its constructor deps) rather than
stretching `getState()/setState()` past the guarantee it actually documents.

### File tree / file list

#### F13 — File names render in the literal monospace editor font, but only under the review panel's own skin

`FileTree.vue` sets no font-family on `.kv-file-tree-name`; the graph panel's `DetailPane.vue`
instance (not wrapped in `.kv-skin-kira`) already inherits `--kv-font-ui` correctly. The review panel
overrides it: `ReviewView.vue:1103-1106` sets `.kv-skin-kira .kv-file-tree-status,
.kv-file-tree-name { font-family: var(--kv-font-data); }`, and `--kv-font-data` is literally
`--kv-mono-font-family` (`kira-structure.css:60`, `vscode-tokens.css:96`) — the VS Code editor font,
monospace on every real installation. A named design law ("LAW 08... Mono is for data") applied here
in an earlier phase, now overturned by real usage for file *names* specifically.

#### F14 — Confirmed generic status letters, and a real ceiling on what codicons alone can offer

`fileTreeModel.ts:11-19`'s `STATUS_LETTERS` is the only per-file glyph today. The real, installed
`@vscode/codicons@0.0.46-24` package ships a small file-type vocabulary — `file`, `file-code` (one
generic glyph, not per-language), `file-media`, `file-pdf`, `file-zip`, `file-binary`,
`file-submodule`, `file-symlink-file`/`-directory`, `json`, `markdown` — confirmed by grepping the
real installed package, not assumed. A rich per-extension icon theme is not achievable with codicons
alone; a coarse category map is what SPEC's own wording (codicons specifically) actually asked for.

#### F15 — Confirmed: raw numbers, unabbreviated, in the two places diff stats render

`FileTree.vue:409-410` (directory aggregate) and `:433-435` (per-file) both interpolate the raw
number with no formatting function. Both are the only two sites (`ReviewFilesPane.vue`/
`ReviewCommitRow.vue` render file lists exclusively through this same component).

### Test infrastructure

#### F16 — `packages/git-ui/src` has never been in `test:unit`'s scope, and carries zero test files today

Root `package.json`'s `test:unit` glob omits `packages/git-ui/src`; a repo-wide search for
`packages/git-ui/**/*.test.ts` returns zero files, despite several source files' own doc comments
describing a testing convention never actually carried into this port.

---

## 2. Decisions

### Git Graph

#### D1 (item 1) — A fourth graph-node marker: a HEAD ring, computed the same way the row-bold indicator already is

*(Unchanged from the first pass.)* `RowSlice` gains `isHead: boolean`; `planNode` adds an unfilled
ring at `GEOMETRY.mergeRadius` in `--kv-focus-border` (the same token the existing badge dot uses) to
whichever kind's own shapes it already returns — stash/merge precedence is untouched. `isHeadDecoration`
is promoted out of `columns.ts` into a shared location both it and `graphColumn.ts` import, mirroring
how `isStashRow` already crosses this exact boundary. No new RPC, no new store field. The existing
row-bold and badge-dot indicators are kept unchanged.

#### D2 (item 2) — Widen the date column's default width, and give it the same overflow safety net every other column already has

*(Unchanged.)* `DEFAULT_COLUMN_WIDTHS.date`: `120` → `152`. `.kv-cell-date` gains `overflow: hidden;
text-overflow: ellipsis; white-space: nowrap`. `MIN_COLUMN_WIDTH` and every already-persisted
`PersistedViewState` are untouched — this only changes a first-ever mount's seed value.

#### D3 (item 3) — **Revised**: extract `packages/kira-ui`, a small, host-agnostic component package, with colours supplied by whichever host imports it

The user's §8.1 answer replaces the original "match the visual language through `packages/git-ui`'s
own tokens, no new package" decision. This section designs the package for real: what it contains,
the exact token-injection contract, and — since the original F3 already found this package would
have real consumers to migrate — how the migration is scoped so it stays additive, not a rewrite.

**Why a new package, not an addition to `packages/shared`.** `@kira/shared` holds pure protocol/
domain TypeScript with zero Vue/CSS today (F3); dropping Vue components into it would blur a
package whose whole identity is "no UI, no framework" — a second, mismatched convention is worse than
a new, correctly-scoped package. **Why not `packages/ui`** as the name: SPEC's own "Relationship to
prior art" table records `packages/ui` as upstream's *original* name for what is now `packages/
git-ui` — reusing that string for something unrelated invites exactly the kind of confusion this
chapter's own naming has already been careful to avoid once. **`packages/kira-ui`** (package name
`@kira/kira-ui`) is unambiguous, reads naturally alongside `git-core`/`git-ipc`/`git-ui`, and names
what it is: Kira's own UI kit, not git's.

**The token-injection contract — the actual design the user asked for.** `packages/kira-ui`'s own
component CSS references **only** a small, new, semantic vocabulary it owns outright: `--kui-fg`,
`--kui-fg-muted`, `--kui-bg-panel`, `--kui-border`, `--kui-hover-bg`, `--kui-selected-bg`,
`--kui-selected-fg`, `--kui-danger-fg`, `--kui-focus-border`, `--kui-radius`, `--kui-control-h`,
`--kui-space-1` through `--kui-space-4`. **Not one component in this package ever reads `--kv-*` or
`--kira-*` directly** — that is the whole contract. Each host supplies a tiny, one-time "bridge"
stylesheet mapping its own existing tokens onto this vocabulary:

- `packages/git-ui/src/theme/kui-bridge.css` (new): `--kui-fg: var(--kv-app-fg); --kui-bg-panel:
  var(--kv-panel-bg); --kui-border: var(--kv-panel-border); --kui-hover-bg: var(--kv-row-hover-bg);
  --kui-selected-bg: var(--kv-row-selected-bg); --kui-selected-fg: var(--kv-row-selected-fg);
  --kui-danger-fg: var(--kv-diff-deleted-fg); --kui-focus-border: var(--kv-focus-border);
  --kui-radius: var(--kv-radius); --kui-control-h: 22px; --kui-space-*: var(--kv-space-*);` — every
  right-hand side an existing `--kv-*` token, no new colour invented.
- `apps/kira-studio/frontend/src/theme/kui-bridge.css` (new): the same left-hand vocabulary, mapped
  from `--kira-*` — `--kui-fg: var(--kira-fg); --kui-bg-panel: var(--kira-bg-elevated); --kui-border:
  var(--kira-border); --kui-hover-bg: var(--kira-hover); --kui-danger-fg: var(--kira-error);` and so
  on, following `primitives.css`'s own existing token names.

This is the same shape `packages/git-ui` already uses one layer down — `--kv-*` mapping from
`--vscode-*` (G16's own investigation confirmed this end to end) — applied one level higher for this
new shared layer, not a novel pattern invented for this decision. **Icons are plain codicon class
names, not a package-owned font.** Both hosts already load the full or a curated `@vscode/codicons`
stylesheet globally (`git-ui/src/icons/codicon.css`, `kira-studio/frontend/src/theme/base.css:2`) —
`packages/kira-ui`'s components accept `icon?: string` (e.g. `'codicon-git-branch'`) and render
`<span class="codicon" :class="icon" aria-hidden="true">`, taking no dependency on `@vscode/
codicons` itself and needing no icon-loading logic of its own.

**What the package actually contains — scoped to exactly what item 3 needs, per the user's own
instruction, nothing broader:**

- `KuiButton.vue` — generalises `AppButton.vue`'s shape: an icon-box, a default slot, an optional
  count badge, `variant: 'default' | 'primary' | 'danger'`, `active?: boolean`. No `kind:
  'toolbar' | 'dialog'` distinction (that was Kira-Studio-specific sizing this package's one
  consumer, `packages/git-ui`'s toolbar, does not need) — one size, driven by `--kui-control-h`.
- `KuiIconBox.vue` — the fixed-size flex wrapper implementing "icons never float unboxed" generically;
  used internally by `KuiButton`/`KuiContextMenu` and exported for direct use.
- `KuiTextInput.vue` — a thin wrapper (`modelValue`, `placeholder`, `ariaLabel`) around one styled
  `<input>`, scoped to **simple filter-style inputs only** (D5/D6's new stacked-header and
  revealed-filter, `BaseSelector.vue`'s own filter). `SearchBox.vue`'s own input is **not** migrated
  — it already carries heavy, input-specific logic (a listbox dropdown, `aria-activedescendant`
  wiring, regex-error `aria-describedby`) directly on its own ref, and wrapping it would add
  indirection for no visual gain this phase needs.
- `KuiContextMenu.vue` + `contextMenuModel.ts` — the ARIA-menu/keyboard-roving-focus logic **promoted
  out of `RowContextMenu.vue` verbatim** (its `onKeydown`/`enabledNeighbour`/focus-capture-and-return
  logic is already correct, per F3 — this is a move, not a rewrite), generalised to render an
  icon-box per row and a `danger` variant, plus the `MenuItem`/`MenuSection` interface itself
  (gaining `icon?: string`/`danger?: boolean`, both optional). **Owns no global singleton** — each
  instance is created and destroyed by its caller, exactly as `RowContextMenu.vue` already does
  today; this is git-ui's own already-correct model, kept, not Kira Studio's singleton adopted.
  **Submenus are explicitly not included** — nothing in `packages/git-ui`'s own menus needs one, and
  Kira Studio's own submenu machinery (flip-aware floating-ui positioning across window edges) stays
  local to its own `ContextMenu.vue`, which keeps using it for its one submenu (the row-colour
  picker) unmigrated.
- `theme/controls.css` — the actual CSS rules for the above, written once against `--kui-*` tokens
  only.
- `index.ts` — the package's public surface (`main`/`types` in `package.json`, matching every other
  workspace package's own `./src/index.ts` convention).

**Package wiring, matching `git-core`/`git-ipc`'s own convention exactly** (the user's own
instruction to use them as the model):

- `packages/kira-ui/package.json`: `{"name": "@kira/kira-ui", "version": "0.0.0", "private": true,
  "type": "module", "main": "./src/index.ts", "types": "./src/index.ts", "exports": {".":
  "./src/index.ts"}, "dependencies": {"vue": "3.5.42"}, "devDependencies": {"@vitejs/plugin-vue":
  "6.0.8", "vue-tsc": "3.3.11", "typescript": "6.0.3", "bun-types": "1.4.0"}}` — no dependency on
  `@vscode/codicons` (icons are plain class names, per above), no dependency on either host.
- `packages/kira-ui/tsconfig.json`: identical shape to `packages/git-ui/tsconfig.json` (it has
  `.vue` files too — `jsx: "preserve"`, DOM lib, `vite/client` types).
- Root `package.json`: `workspaces` gains `"packages/kira-ui"`; `typecheck:git` gains `&& vue-tsc
  --noEmit -p packages/kira-ui/tsconfig.json`; `test:unit`'s glob gains `packages/kira-ui/src`
  (its pure `contextMenuModel.ts` logic gets real tests — D16 extends to cover it, not only
  `packages/git-ui/src`).
- No `vite.config.ts` change anywhere — resolved as an ordinary workspace package exactly like
  `@kira/git-core` already is (bun's workspace symlinking, no build step of its own — source-only,
  same as every other internal package in this list).
- `packages/git-ui/package.json` gains `"@kira/kira-ui": "workspace:*"`.

**Migrating `packages/git-ui`'s own call sites — and how this stays safe against the concurrently-
landing G17 work.** `AppToolbar.vue`'s buttons (Fetch/Push/Stash/the force-push chevron),
`PullStrategyPicker.vue`'s trigger, `RefreshButton.vue`, and `UndoButton.vue` all switch to
`<KuiButton>`, and `.kv-toolbar-button`'s own duplicated CSS (the drift F3 found) is deleted from
both `AppToolbar.vue` and `PullStrategyPicker.vue` — closed at its source, not restyled around.

`RowContextMenu.vue` itself is **kept as a file**, but becomes a thin compatibility wrapper: its
`<script setup>` now imports `KuiContextMenu` from `@kira/kira-ui` and forwards its existing props
(`sections`, `x`, `y`, `label`, `title`) and emits (`select`, `close`) straight through, with its own
`<template>` reduced to one `<KuiContextMenu v-bind="$props" @select="..." @close="..." />`. **Its
external API — every prop and emit — is byte-identical to today.** This is deliberate: `grep
RowContextMenu packages/git-ui/src` found **8 files**, including `StashList.vue` — a file G17 is
actively writing on this same branch right now. Rewriting or deleting `RowContextMenu.vue` outright
would force either a coordinated edit to a concurrently-changing file or a real risk of breaking it
sight-unseen. Keeping the wrapper means **every one of those 8 consumers, `StashList.vue` included,
needs zero changes and automatically inherits the new icon-box/danger visual treatment** the moment
this phase's `rowMenuModel.ts` starts supplying `icon`/`danger` fields to the menus it already
builds — a `MenuItem` without those optional fields (which is exactly what any G17-authored menu-
building function looks like today, since it predates this phase) renders exactly as it does now,
just without an icon-box, which degrades gracefully rather than breaking.

`rowMenuModel.ts` imports `MenuItem`/`MenuSection` from `@kira/kira-ui` instead of defining its own
(the shapes are now identical by construction); `buildRowMenu`/`buildRefMenu`/`buildReviewRowMenu`
each gain `icon`/`danger` values per action (checkout → `codicon-check`, create branch →
`codicon-git-branch`, create tag → `codicon-tag`, revert/reset/cherry-pick → their own
history/step-back/cherry-pick glyphs, copy actions → `codicon-copy`, with `revertThisCommit`/
`resetToThisCommit` marked `danger: true`, matching `.kv-push-menu-item`'s own existing danger-colour
precedent). D7's new `buildFileRowMenu` (below) is written directly against this same shared type
from the start.

**What does not change in `apps/kira-studio/frontend` this phase**: no existing component there is
edited, deleted, or has a call site swapped to `@kira/kira-ui` — only the new `kui-bridge.css` file
is added (imported from `theme/base.css`, after `tokens.css`), proving the contract's other half is
real and satisfiable without requiring any of Kira Studio's own UI to change today. §8 item 1 records
this as resolved, with the follow-up (migrating Kira Studio's own frontend onto the new package) left
explicitly open for a future phase to pick up if it wants to.

#### D4 (item 4) — Truncate the commit message body to 4 lines with a click-to-expand toggle

*(Unchanged.)* `CommitMeta.vue` gains a `bodyExpanded` ref (scoped to the `'message'` section only),
CSS `line-clamp: 4` on `.kv-meta-body` while collapsed, and a "Show more"/"Show less" toggle rendered
only when the content actually overflows (measured via `scrollHeight`/`clientHeight` inside the
existing `nextTick`-scheduled `renderBody` pass). No change to `DetailPane.vue`'s ordering or to
`FileTree.vue` — the second half of this item is already correct (F4).

### Review bar

#### D5 (item 5) — Stack the two sides vertically; add a swap action that re-targets the session through the two RPCs it already has

*(Unchanged, styled with D3's new primitives rather than the original plan's own bespoke CSS.)*
`ReviewView.vue`'s summary line splits into two stacked rows inside `.kv-review-compare`, with a new
`codicon-arrow-swap` `KuiButton` between them. `ReviewSessionState.swapBaseAndBranch()`: when
`resolution.value?.range.kind === 'ready'`, calls `setTarget(repoId, oldBase)` then
`setBase(oldBranch)` — the same two-round-trip sequence a manual re-pick-then-override would already
produce. No new RPC.

#### D6 (item 6) — A search icon button gates the filter input

*(Unchanged, styled with D3's `KuiButton`/`KuiIconBox` rather than a bespoke button.)* The always-
rendered filter input is replaced by a `codicon-search` `KuiButton` toggling a `filterVisible` ref;
revealed, the existing `<input>` (now a `KuiTextInput`, per D3's own scoping) renders and receives
focus; the button carries an active state whenever `filter.value` is non-empty or the input is
revealed, so an applied-but-collapsed filter still visibly signals itself.

#### D7 (item 7) — Remove the two redundant copy affordances from `ReviewCommitRow.vue`; add a right-click "Copy path" menu to `FileTree.vue`, scoped to `reviewStyled` instances only

*(Unchanged.)* `ReviewCommitRow.vue`'s clickable-sha-button and hover "Copy SHA" icon are removed
(the sha renders as plain text; the existing `copySha` menu item already covers this). `FileTree.vue`
gains a `KuiContextMenu` instance, gated on `props.reviewStyled`, with a new `buildFileRowMenu
(clipboardEnabled: boolean): MenuSection[]` (built directly against `@kira/kira-ui`'s `MenuItem`
type, per D3) offering `copyPath` alone. `.kv-file-tree-copy`'s inline button is hidden only when
`reviewStyled` is true — `DetailPane.vue`/`StashDetailPane.vue` render byte-identically.

#### D8 (item 8) — `VsCodeEditorIntegration.openDiff` always opens a non-preview (pinned) tab

*(Unchanged.)* `ports/editorIntegration.ts:85-92`'s `openDiff` passes `{ preview: false }` as its
fourth argument to `vscode.commands.executeCommand('vscode.diff', ...)`. No contract change — purely
inside the extension host's own call to a VS Code API. §8 item 6 (renumbered from the original §8
item — see §8's own note) still flags the deliberate single-click behaviour change.

#### D9 (item 9) — A `vscode.FileDecorationProvider` for the `kira-version` scheme, badging only virtual documents whose path has no live counterpart on disk

*(Unchanged.)* New `virtualFileDecoration.ts`, registered at activation. Checks `vscode.workspace.fs
.stat` against the live worktree path recovered from the virtual key; badges `🔒` only when the stat
fails (path no longer exists); `'empty'`-kind placeholders are skipped. No contract change.

#### D10 (item 10) — Move the row's own click-to-toggle listener off the whole row and onto its header only

*(Unchanged.)* `ReviewCommitRow.vue:170`'s `@click="onRowClick"` moves from `.kv-review-row` to
`.kv-review-row-header` alone — the surgical fix, touching no shared component.

#### D11 (items 11) — **Fully revised**: a single "back to branch selection" control, and durable review-session persistence through a new, small RPC into `context.workspaceState`, with staleness handled by re-resolving through the mechanism that already exists for exactly that

**D11a — Back to selection.** Per F11's re-investigation, this needs exactly one new method and one
new button, not a history stack.

- `ReviewSessionState.clearTarget(): void` (new, synchronous — no RPC): mirrors `setTarget`'s own
  reset lines (`#abortAll()`, `#clearExpansions()`, `#packed.reset()`, `resolution.value =
  undefined`, `resolveError.value = undefined`, `staleReview.value = false`, `#pendingResolution =
  undefined`, `pane.value = 'commits'`) but sets `phase.value = 'idle'` and, critically,
  `branch.value = undefined` — the one field `setTarget` never clears (F11) and the one flip that
  makes the template's own `v-else-if="!review.branch.value"` (`:503`) true again, returning to the
  branch-picker screen. `repoId.value` is **left as-is** — the user is still browsing the same repo,
  just picking a different (or the same) branch to compare; the picker screen already reads
  `refsState`, which is already scoped to `repoId`.
- `ReviewView.vue`'s header gains one new icon button, `codicon-chevron-left`
  (`ACTION_ICONS.back`, already defined for exactly this glyph — `icons/index.ts:7`), rendered
  whenever `review.branch.value` is set (i.e., inside the `v-else` branch, `:549` onward), calling
  `review.clearTarget()`. No disabled state to compute — unlike the original stack-based design,
  there is nothing to be empty; the button is either shown (branch selected) or not (already on the
  picker).
- **Explicitly not built**: any notion of "the branch I was reviewing before this one" surviving a
  `clearTarget()` call. The user's own report ("I can't go back to the previous panel... that's
  all") is answered completely by a single reverse edge on an otherwise two-step flow; inventing a
  browsing history for a flow that has never had more than "current" and "none" would be solving a
  problem this component does not have, per F11's own close reading of the class.

**D11b — Durable persistence, and its staleness story.**

*What's persisted, and where.* Not commit data, not diff content — only the **identifiers** needed to
re-ask the exact same question `setTarget`/`setBase` already ask fresh every time: `{branch:
string, baseOverride: string | null, pane: ReviewPane, listMode: FileListMode, filter: string,
diffMode: 'sinceReview' | 'range', savedAt: number}`, keyed by `repoId` in one new
`context.workspaceState` entry, `kiraVersion.review.session` → `Record<string, ReviewSessionSnapshot
| undefined>` (a plain map, since one VS Code window/workspace can, over time, connect to more than
one repo via `RepoPicker.vue`). `context.workspaceState` — not `globalState` — because this is a
per-window, per-workspace "what was I looking at" fact, matching the scope every other piece of
per-window state in this extension already keeps (`KiraReviewViewProvider`'s own `#pendingTarget`,
one instance per window).

*Why `context.workspaceState` and not a deeper reuse of G11's `review.db`.* Considered and rejected:
`review.db` (G11) exists to solve a *materially harder* problem — a blob-snapshot of actual file
*content* at last-review time, needed because a rewritten history can leave nothing left to diff
against. This item persists no content at all, only which branch/base/pane the user was looking at —
reusing `review.db`'s SQLite-with-compressed-blobs machinery for four small strings and a timestamp
would import complexity this decision does not need, and would put UI-preference state in the one
file whose whole design (TTL purge, PR-close reaper) is tuned for a different, heavier kind of data.
`context.workspaceState` is the right-sized tool: a real, durable (survives reload and restart, per
VS Code's own documented guarantee — F11), per-workspace key-value store, already exactly how
`vscode.ExtensionContext` is meant to be used for this. `KiraReviewViewProviderDeps` gains one new
field, `context: vscode.ExtensionContext` (already held by `extension.ts`'s own `activate()`
function — a small, mechanical threading change, not new state).

*Getting it into the extension host: one new, additive RPC.* The webview has exactly one channel back
to the extension host — `git-ipc`'s contract. New method, added to `packages/git-ipc/src/
contract.ts`:

```ts
'review.session.save': {
  params: {
    repoId: string;
    /** null clears the stored session for this repo — sent by clearTarget() itself (D11a), so
     *  an explicit "go back" never leaves a stale resume-point the very next cold boot would
     *  silently jump back into. */
    session: {
      branch: string;
      baseOverride: string | null;
      pane: 'commits' | 'files' | 'comments';
      listMode: 'tree' | 'flat';
      filter: string;
      diffMode: 'sinceReview' | 'range';
    } | null;
  };
  result: Record<string, never>;
};
```

matching `editor.openDiff`'s own `result: Record<string, never>` shape for a request with nothing
meaningful to return. Registered in `validate.ts`'s method table the same way every other
extension-answered-only method already is (`editor.openDiff: true`, alongside it).
`CONTRACT_VERSION` moves **21 → 22** — the one wire change this whole phase makes, called out
explicitly rather than left to be discovered in a diff. `proxyHandlers.ts` implements it as a pure,
local write: `context.workspaceState.update('kiraVersion.review.session', { ...current, [repoId]:
session === null ? undefined : { ...session, savedAt: Date.now() } })` — **never reaches the Go
backend at all**, exactly like `editor.openDiff` itself already never does for its own local
concerns.

`ReviewView.vue` calls `review.session.save` from one `watch()` over the same fields D11's snapshot
lists (debounced trivially — a `queueMicrotask`/next-tick coalesce is enough; this is not a hot
path), and once more, with `session: null`, from `clearTarget()`'s own call site — so "go back" also
clears the durable resume point, not just the in-memory one.

*Getting it back out: a second, small, additive method — not the bootstrap island.* The bootstrap
island (`renderHtml({..., target: this.#pendingTarget})`, same-process, no RPC) is where
`props.target` already comes from, and it would be the cheaper path if it could carry the restored
session too — but it can't: `resolveWebviewView` runs before the webview has told the extension host
*which repo* it's even looking at (a cold review-view reveal with no `#pendingTarget` learns its
`repoId` only from the webview's own later `repo.list` call, `ReviewView.vue:105-110`), so the
extension host has no `repoId` to key the `workspaceState` lookup by at the one point the bootstrap
island is built. So the read genuinely needs its own round trip, made once `bootstrap()` has a real
`repoId` in hand (right after `repo.list` resolves, alongside the existing `props.target`/
`review.target` arbitration). `CONTRACT_VERSION` 22 therefore carries two methods, not one:

```ts
'review.session.load': {
  params: { repoId: string };
  result: { session: ReviewSessionSnapshot | null };
};
```

(same additive bump, same one number — both methods land in the same `CONTRACT_VERSION` step, not
two). `proxyHandlers.ts` answers it from `context.workspaceState`, applying the TTL below before
returning anything.

*Staleness — the real, stated decision.* Three options were on the table (per the brief); the one
taken is **"detect and silently re-resolve," justified by how `setTarget`/`setBase` already work,
not asserted as a policy choice made in a vacuum**:

- **No commit or diff data is ever restored** — only `{branch, baseOverride, pane, listMode, filter,
  diffMode}`. `bootstrap()`'s resume path (after `props.target`/`review.target` — an explicit
  instruction — both still win, unchanged priority from the original design) calls exactly
  `setTarget(repoId, session.branch)`, then, once resolved, `setBase(session.baseOverride)` if it is
  non-null, then `setPane`/`listMode.value`/`filter.value`/`diffMode` restoration. **`setTarget`
  always calls `review.resolveBase` fresh** (`state/review.ts:136-150`, unchanged) — there is no
  cached resolution or commit list to go stale in the first place; every resume is, by construction,
  a live re-ask of git's own current state. This is *why* "silently re-resolve" is the correct
  answer and not a compromise: the mechanism that would need building for it already exists and
  already runs unconditionally on every `setTarget` call, restored session or not.
- **If the restored branch no longer exists** (deleted since the session was saved), `resolveBase`
  fails and `ReviewSessionState` lands in its own already-built `phase: 'error'` state
  (`state/review.ts:272-279`), rendering "Couldn't compare — {{ message }}" (`ReviewView.vue:
  650-652`) — **and now, for the first time, with D11a's own "Back to branch selection" button
  visible right there**, since that button renders whenever `branch.value` is set, error phase
  included. A resumed session pointing at a deleted branch was, before this phase, a dead end with
  no `error` UI's exit; it now has exactly the same one the collapse-into-selection fix already
  built for an entirely different reason — the two halves of this one item reinforce each other by
  construction, not by coincidence.
- **If the restored base override no longer exists**, the same path handles it: `setBase` fails the
  same way `setTarget` would, same `error` phase, same recovery button.
- **A TTL, matching G11's own already-established lifecycle shape** (`review.db`'s 14-day idle
  purge — "returning after that window starts clean, by design, not an error case," per SPEC's own
  "Review state" section) — reused here for consistency rather than re-derived: `review.session.load`
  treats a stored snapshot older than **14 days** (`savedAt`) as expired and returns `{session:
  null}}`, falling back to today's ordinary "no branch" picker rather than resuming into a
  months-old comparison the user has likely forgotten even existed. This is a UI-preference-weight
  decision reusing a heavier precedent's own number for consistency, not a claim that the two kinds
  of staleness are otherwise alike.

---

### File tree / file list

#### D13 (item 13) — Drop `.kv-file-tree-name` from the `.kv-skin-kira` mono-font override

*(Unchanged.)* `ReviewView.vue:1103-1106`'s selector shrinks to `.kv-skin-kira .kv-file-tree-status`
alone. LAW 08 itself is not rewritten; this is a narrower, found-by-real-usage exception for file
*names* specifically.

#### D14 (item 14) — A coarse extension→codicon category map, real icon primary + small secondary status chip

*(Unchanged.)* New `fileIconFor(path: string): string` in `fileTreeModel.ts`; the vendored codicon
subset (`icons/codicon.css`) is extended to include the newly-referenced glyphs; the file icon
becomes the row's primary leading glyph, with the existing status letter demoted to a small,
secondary chip beside it — kept, not removed, per SPEC's own wording.

#### D15 (item 15) — A small K/M/B formatter, applied at both diff-stat render sites

*(Unchanged.)* New `packages/git-ui/src/components/countFormat.ts`, `formatChangeCount(n: number):
string`, applied at `FileTree.vue:409-410` and `:433-435`.

### Test infrastructure

#### D16 (supporting infrastructure) — Wire `packages/git-ui/src` **and `packages/kira-ui/src`** into `test:unit`, and add real unit tests for this phase's new pure functions

*(Extended from the first pass to cover the new package.)* Root `test:unit` glob gains both
`packages/git-ui/src` and `packages/kira-ui/src`. New tests: `fileTreeModel.test.ts` (D14's
`fileIconFor`), `countFormat.test.ts` (D15), `rowSvg.test.ts` (D1's HEAD-ring `planNode` case), and,
in `packages/kira-ui/src`, `contextMenuModel.test.ts` — the promoted keyboard-navigation logic
(`enabledNeighbour`/`stepIndex`-equivalent), exercised directly now that it lives in its own,
framework-agnostic module rather than embedded in one `.vue` file's `<script setup>`. No Vue-
component-mount tier is added, for the same reason as the first pass (F16: no jsdom/happy-dom wired
into `bun:test` anywhere in this repo).

---

## 3. Implementation, file by file

### `packages/kira-ui` — **new package**

| File | Content | Item(s) |
|---|---|---|
| `package.json` | `@kira/kira-ui`, no deps beyond `vue` | D3 |
| `tsconfig.json` | Mirrors `git-ui`'s own shape | D3 |
| `src/index.ts` | Public exports | D3 |
| `src/KuiButton.vue` | Icon-box + slot + count badge + variant | D3a |
| `src/KuiIconBox.vue` | Fixed-size icon wrapper | D3a, D3b |
| `src/KuiTextInput.vue` | Thin styled input wrapper | D3a, D6 |
| `src/KuiContextMenu.vue` | Promoted from `RowContextMenu.vue`, generalised | D3b |
| `src/contextMenuModel.ts` | `MenuItem`/`MenuSection` + keyboard-nav helpers, promoted | D3b |
| `src/theme/controls.css` | The actual `--kui-*`-token CSS | D3a, D3b |

### `packages/git-ui/src`

| File | Change | Item(s) |
|---|---|---|
| `package.json` | `+ "@kira/kira-ui": "workspace:*"` | D3 |
| `theme/kui-bridge.css` | **New** — `--kv-*` → `--kui-*` mapping | D3 |
| `main.ts` | Imports `kui-bridge.css` | D3 |
| `graph/palette.ts` | No `NodeKind` change | D1 |
| `components/refBadges.ts` (or shared module) | `isHeadDecoration` promoted for reuse | D1 |
| `graph/rowSvg.ts` | `RowSlice.isHead`; HEAD-ring shape | D1 |
| `graph/graphColumn.ts` | `readSlice` computes `isHead` | D1 |
| `components/CommitGrid.vue` | `.kv-node-head` styling; `.kv-cell-date` ellipsis | D1, D2 |
| `state/viewState.ts` | `DEFAULT_COLUMN_WIDTHS.date` → `152` | D2 |
| `components/AppToolbar.vue` | Buttons → `KuiButton`; own `.kv-toolbar-button` CSS deleted | D3a |
| `components/PullStrategyPicker.vue` | Trigger → `KuiButton`; own duplicated CSS deleted | D3a |
| `components/UndoButton.vue`, `RefreshButton.vue` | Buttons → `KuiButton` | D3a |
| `components/rowMenuModel.ts` | `MenuItem`/`MenuSection` imported from `@kira/kira-ui`; icons/danger added; new `buildFileRowMenu` | D3b, D7 |
| `components/RowContextMenu.vue` | Becomes a thin wrapper over `KuiContextMenu` — API unchanged | D3b |
| `components/CommitMeta.vue` | Message-body line-clamp + expand toggle | D4 |
| `components/review/ReviewView.vue` | Stacked compare header + swap button; filter behind search button; back-to-selection button; session save/restore wiring; `.kv-file-tree-name` dropped from mono override | D5, D6, D11a, D11b, D13 |
| `state/review.ts` | `swapBaseAndBranch()`; `clearTarget()`; session snapshot read/write plumbing | D5, D11a, D11b |
| `components/review/ReviewCommitRow.vue` | Drop the two copy affordances; `@click` moved to the header only | D7, D10 |
| `components/FileTree.vue` | `KuiContextMenu` (gated `reviewStyled`); copy button hidden when `reviewStyled`; file-icon + demoted status chip; `formatChangeCount` applied | D7, D14, D15 |
| `components/fileTreeModel.ts` | New `fileIconFor` | D14 |
| `components/countFormat.ts` | **New** — `formatChangeCount` | D15 |
| `icons/index.ts` | New icon constants (`arrowSwap`, file-type set) | D5, D14 |
| `icons/codicon.css` | Extended subset | D5, D14 |

### `packages/git-ipc/src`

| File | Change | Item(s) |
|---|---|---|
| `contract.ts` | New `review.session.save`/`review.session.load` methods | D11b |
| `validate.ts` | `CONTRACT_VERSION` 21 → 22; both new methods registered | D11b |

### `apps/kira-studio-vscode/src`

| File | Change | Item(s) |
|---|---|---|
| `ports/editorIntegration.ts` | `openDiff` passes `{ preview: false }` | D8 |
| `virtualFileDecoration.ts` | **New** — `FileDecorationProvider` for `kira-version` scheme | D9 |
| `extension.ts` | Registers the decoration provider; threads `context` into `KiraReviewViewProviderDeps` | D9, D11b |
| `reviewView.ts` | `KiraReviewViewProviderDeps.context`; answers `review.session.load`'s repo-scoped lookup at the deps layer (handler itself lives in `proxyHandlers.ts`) | D11b |
| `proxyHandlers.ts` | Implements `review.session.save`/`.load` against `context.workspaceState`, with the 14-day TTL | D11b |
| `webview/main.ts` | Review branch uses `VsCodeApiViewStateStore`... **superseded by D11b's durable layer** — see note below | D11b |
| `reviewMarking.ts` | One string update ("Branch Review" → "Kira Version") | D12 |

**Note on `webview/main.ts`**: the original plan's D11 reused `VsCodeApiViewStateStore` for the
review branch. This revision's D11b supersedes that — the durable `context.workspaceState`/RPC path
covers everything `getState()/setState()` would have (ordinary hide/reveal) *and* the
reload/restart case it does not, so `webview/main.ts`'s review branch is **left constructing
`NullViewStateStore`** (its own webview-local `viewState` prop genuinely has nothing left to persist
— every field that would have gone there now round-trips through `review.session.save`/`.load`
instead). This is a deliberate simplification worth stating plainly: one persistence mechanism for
the review view, not two doing overlapping jobs.

### `apps/kira-studio-vscode` (non-`src`)

| File | Change | Item(s) |
|---|---|---|
| `package.json` | Two title/name strings → "Kira Version" | D12 |
| `README.md` | Prose update | D12 |
| `resources/review-icon.svg` | `<title>` update | D12 |

### Root

| File | Change | Item(s) |
|---|---|---|
| `package.json` | `workspaces` gains `packages/kira-ui`; `typecheck:git` gains its `vue-tsc` call; `test:unit` glob gains `packages/git-ui/src` and `packages/kira-ui/src` | D3, D16 |

### `apps/kira-studio/frontend` — the one file this revision adds outside `packages/`

| File | Change | Item(s) |
|---|---|---|
| `src/theme/kui-bridge.css` | **New** — `--kira-*` → `--kui-*` mapping, proving the contract | D3 |
| `src/theme/base.css` | `+ @import "./kui-bridge.css";` (after `tokens.css`) | D3 |

**Not touched, anywhere in this phase**: any `apps/kira-studio/internal/**` Go package, `internal/
gitwire`'s FlatBuffers schema, `packages/git-core`, any existing component under `apps/kira-studio/
frontend/src/theme/primitives/` or `workbench/ContextMenu.vue` itself (added-to, not edited), and
every `internal/gitclient`/`internal/gitops`/`StashList.vue`/`StashDetailPane.vue`/`state/stash.ts`
file G17 is concurrently landing — `RowContextMenu.vue`'s wrapper strategy (D3) is specifically what
keeps `StashList.vue` off this list despite importing it.

---

## 4. Test plan

### 4.1 Unit tests (`bun run test:unit`, now including `packages/git-ui/src` and `packages/kira-ui/src` — D16)

- `fileTreeModel.test.ts`, `countFormat.test.ts`, `rowSvg.test.ts` — unchanged from the first pass
  (D14, D15, D1).
- `contextMenuModel.test.ts` (**new location**, `packages/kira-ui/src`) — the promoted keyboard-nav
  logic: `Escape`/`ArrowUp`/`ArrowDown`/`Home`/`End`/`Enter` behaviour against a fixture `MenuSection[]`
  with a mix of enabled/disabled items, asserting the same neighbour-skipping this logic already
  correctly implements inside `RowContextMenu.vue` today — a straight port of coverage, not new
  behaviour to specify.
- `apps/kira-studio-vscode/src` (already in the glob) gains a `proxyHandlers.test.ts` (or an
  addition to an existing one, if `editor.openDiff`'s own handler already has a home) case for
  `review.session.save`/`.load`: a fake `vscode.ExtensionContext.workspaceState` (a plain in-memory
  `Map`-backed stub, matching whatever fake-`vscode` convention this file's neighbours already use —
  `virtualKey.test.ts`'s own doc comment confirms this repo deliberately keeps testable modules
  `vscode`-free, so this handler's *logic* is tested with a stub context object satisfying only the
  `workspaceState.get`/`.update` shape, not a real `vscode` import), asserting: a save then a load
  round-trips exactly; a load past the 14-day TTL returns `{session: null}`; `session: null` clears
  a previously-saved entry.

### 4.2 The `test:webview` geometry/interaction tier — unchanged in shape from the first pass, one new case added

The two cases from the first pass (D4's message-clamp geometry, D10's click-bubbling regression)
are unchanged, including §8's accepted answer to build the fake-transport fixture narrowly (four
hand-written fake responses, not a general mock RPC layer).

**One case added**: `review-interaction.spec.ts` gains a third scenario for D11a — using the same
fake transport, reach the `listing` phase, click the new back button, and assert the DOM returns to
`[data-testid="review-no-branch"]` (the existing test id on the branch-picker screen,
`ReviewView.vue:504`) rather than merely asserting on `ReviewSessionState`'s own internal `branch`
ref, which a unit test could already do just as well were one to exist — this is exactly the DOM-
level regression (does the *rendered* screen actually change) worth the browser tier, matching the
tier's own stated bar from G16.

**D11b's durable persistence is explicitly not covered by this tier** — `context.workspaceState`
is a real VS Code extension-host API with no meaningful stand-in inside the static-server harness
`test:webview` runs against (which serves the built webview bundle over plain HTTP, with no
extension host in the loop at all). §5.3 (Tier 3) is where this gets a real check.

### 4.3 Not covered by any automated tier, and why

*(D9, D8 unchanged from the first pass — see §5.3.)* **D11b's window-reload/restart survival** joins
this list for the same class of reason as D9: it needs a real VS Code host across an actual reload,
which nothing in this repo's automated tiers can drive.

---

## 5. Non-goals

- **No migration of `apps/kira-studio/frontend`'s existing components onto `@kira/kira-ui`.** The
  new package is built and proven consumable from both hosts (D3's bridge CSS on both sides); only
  `packages/git-ui`'s own call sites actually switch to it this phase, per the user's own explicit
  "don't turn this into a full design-system migration" boundary.
- **No submenu support in `KuiContextMenu`.** Not needed by anything this phase touches; Kira
  Studio's own richer `ContextMenu.vue` keeps its submenu machinery locally, unmigrated.
- **No multi-entry review-navigation history.** F11's re-investigation found the user's own report
  describes, and the component's own state machine actually has, exactly one missing reverse edge —
  not a browsing history. Building one anyway would be solving an unreported problem at real
  complexity cost.
- **No reuse of G11's `review.db` for session-identifier persistence.** A real, considered
  rejection (D11b) — the two problems (content-snapshot staleness vs. UI-preference resumption) are
  different enough in shape and weight that sharing the mechanism would cost more than it would
  save.
- **No per-language file-type icon theme** (D14) — unchanged from the first pass.
- **No `CONTRACT_VERSION` bump beyond the one this revision adds.** 21 → 22, for
  `review.session.save`/`.load` alone — every other item in this phase, including every part of D3's
  new package, still needs none.
- **No touch to any G17 (stash) file** — restated, and now backed by D3's own wrapper-strategy design
  rather than merely asserted.

---

## 6. Implementation order

One sequential subagent, same as the first pass. `git status`/`git log`/`git fetch` +
`git pull --rebase` (if the branch has moved) checked immediately before the closing commit, not
merely at the start — G17 is still landing concurrently.

1. **`packages/kira-ui`** — the new package, built and typechecked in isolation first (its own
   `package.json`/`tsconfig.json`, `KuiButton`/`KuiIconBox`/`KuiTextInput`/`KuiContextMenu`/
   `contextMenuModel.ts`, and its unit tests) — everything else in this phase that touches visuals
   depends on it existing.
2. **D16's glob wiring** — both new package globs added to `test:unit`, so every test written from
   here on has somewhere to run the same day.
3. **File tree (D13, D14, D15)** — independent of the package work, finished early as before.
4. **Bridge CSS on both hosts (D3's `kui-bridge.css` files)** — small, mechanical, unblocks step 5.
5. **`packages/git-ui`'s own migration (D3a's buttons, D3b's `RowContextMenu.vue` wrapper +
   `rowMenuModel.ts` icons)** — done as one pass across the toolbar/menu files together, since they
   share the new primitives and a reviewer should see them land coherently.
6. **Git Graph's remaining items (D1, D2, D4)**.
7. **Review bar (D5, D6, D7, D10, D11a, D11b, D12)** in that order — D10 before D7 (both touch
   `ReviewCommitRow.vue`'s click surface); D11a before D11b (the simple back button first, then the
   durable layer that makes "go back" also clear the stored resume point); D12 last within this
   group since it touches no shared logic.
8. **Extension host (D8, D9, D11b's Go-free TypeScript half)** — `review.session.save`/`.load`'s
   handler and the `CONTRACT_VERSION` bump land together with D11a/D11b's client-side wiring from
   step 7, not before it (the RPC exists to serve that client code, not the reverse).
9. **Full check pass**: `bun run lint`, `bun run typecheck` (now covering `packages/kira-ui` too),
   `bun run test:unit`, `bun run build:vscode`, `bun run test:webview`, `go test ./...` (still
   expected to be a no-op for this phase's own changes).

---

## 7. Exit criteria

### 7.1 Tier 1 — fully provable in this container

1. `bun run test:unit` passes, including `packages/kira-ui/src`'s new tests and the
   `review.session.save`/`.load` handler test.
2. `bun run test:webview` passes, including the new D11a back-button case; the D10 case still fails
   against a pre-fix tree (checked by hand once).
3. `bun run lint`, `bun run typecheck` (now including `vue-tsc` over `packages/kira-ui`),
   `bun run build:vscode` all pass.
4. **`CONTRACT_VERSION` is 22** (`grep` — inverted from the first pass's own check, deliberately);
   `git diff --stat -- packages/git-ipc/src/contract.ts packages/git-ipc/src/validate.ts` shows
   exactly the two new method additions and the version bump, nothing else changed shape.
5. `go test ./...` touches zero files this phase changed.
6. `DetailPane.vue`/`StashDetailPane.vue` still render byte-identically (spot-checked).
7. `git diff --stat` shows zero changes under `apps/kira-studio/frontend/src/theme/primitives*`,
   `apps/kira-studio/frontend/src/workbench/ContextMenu.vue`, or any G17-owned path.

### 7.2 Tier 3 — needs a human, on a Mac, with VS Code and Kira Studio both running

8-16. *(Items 1-10, 12-15's real-world checks, unchanged in substance from the first pass.)*
17. **Item 11, the corrected scope**: from inside a real, resolved comparison, the back button
    returns to the branch/base picker screen — confirmed as the specific gap reported, not a
    superset feature.
18. **Item 11's durability**: start a review, reload the VS Code window (or fully quit and reopen),
    reveal the review sidebar again — the same branch/base/pane/filter resumes automatically. Delete
    the branch that was being reviewed (in a terminal, outside VS Code) before reloading — the resume
    lands in the `error` phase with a working "Back to branch selection" button, not a crash or a
    silent stale render.
19. `apps/kira-studio/frontend` still looks and behaves exactly as it did before this phase, with
    `kui-bridge.css` loaded but nothing visibly different (proving it is inert until something
    actually imports `@kira/kira-ui` there).

### 7.3 The checklist

- [ ] `packages/kira-ui` exists, builds, typechecks, and is imported by `packages/git-ui` for its
      toolbar buttons and context menu.
- [ ] `RowContextMenu.vue`'s external API (props/emits) is unchanged; `StashList.vue` and every
      other of its 8 original consumers needed zero edits.
- [ ] `CONTRACT_VERSION` is 22; exactly two new methods exist in `contract.ts`/`validate.ts`.
- [ ] `ReviewSessionState.clearTarget()` exists and is the only new navigation method — no history
      stack.
- [ ] A resumed review session never replays cached commit/diff data — every resume re-runs
      `setTarget`/`setBase` for real.
- [ ] `test:unit` covers `packages/git-ui/src` and `packages/kira-ui/src`; `test:webview` includes
      the D4/D10/D11a cases.
- [ ] No `internal/git*` Go file, no `packages/git-core` file, no G17-owned file appears in
      `git diff --stat`.

---

## 8. Calls that want a human eye

*(Items 1, 2, and 5 below are marked resolved — the user's own §8 answers, applied. Items 3, 4, 6
carry over from the first pass, renumbered to keep this section's own list contiguous; §8.4's
original wording is preserved since it was accepted as recommended.)*

### 1. Should a real shared component package be extracted from Kira Studio's design system? — **Resolved 2026-09-08, per the user's own instruction**

**Answer taken: yes, now.** `packages/kira-ui` (D3) is built and scoped in this phase — a real
token-injection contract (`--kui-*`, bridged from each host's own tokens), covering exactly buttons,
a text-input wrapper, and the context-menu primitive, with `packages/git-ui`'s toolbar and context
menu actually consuming it. **What is deliberately still left for a later phase, stated plainly
rather than silently dropped**: migrating `apps/kira-studio/frontend`'s own existing `AppButton.vue`/
`IconButton.vue`/`ContextMenu.vue` call sites onto the new package — the user's own instruction
("don't turn this into a full design-system migration of either existing frontend") draws that line
explicitly, and this decision honours it rather than reinterpreting "extract a shared package" as
"also rewrite everything that could use it."

### 2. Is branch-level history the right scope for item 11's "back" button? — **Resolved 2026-09-08, per the user's own correction — the original framing was wrong, not merely a preference among options**

**Answer taken: a single back-to-selection control, no history at all.** F11's re-investigation
confirms the user's own report precisely: `ReviewView.vue` has exactly two steps (pick a branch;
review the comparison), and today there is no control anywhere that reverses the second back to the
first. D11a builds exactly that — one new synchronous method (`clearTarget()`), one new button,
no stack, no depth, no "how many steps back" question to answer, because the component this item is
about has never had more than one step to go back to in the first place.

### 3. Should D15's abbreviated counts carry an exact-number tooltip?

*(Unchanged from the first pass.)* Recommendation: add it (`title="1,234 additions"` on the existing
`fileTitle` path) — left as an open call at implementation time rather than folded into D15 itself,
since it is genuinely optional.

### 4. The fake-transport test fixture for `test:webview` (§4.2) — **Resolved, per the user's own acceptance of the original recommendation**

Build it narrowly-scoped, as originally recommended — four hand-written fake responses, not a
general-purpose mock RPC layer. No change from the first pass; restated here only so this section's
own numbering stays contiguous and legible against §8's original four items.

### 5. Cross-session review-panel persistence — **Resolved 2026-09-08, per the user's own instruction, including its staleness design**

**Answer taken: yes, durable across window reload/restart, via `context.workspaceState` and a new,
additive `CONTRACT_VERSION` 22 RPC pair** (D11b) — not the `getState()/setState()` mechanism the
first pass's D11 proposed reusing (which does not carry the same durability guarantee). **The
staleness question the first pass correctly flagged and left open is now answered**: nothing but
branch/base/pane/filter identifiers are ever persisted, so every resume is a live, fresh
`resolveBase` call — there is no stale commit/diff data to detect in the first place, only a
possibly-gone branch/base, which the existing `error` phase (now paired with D11a's own back button)
already renders correctly. A 14-day TTL, reusing G11's own established number for a "session-level
resumption" concept rather than re-deriving one from nothing, discards a session old enough that
resuming into it silently would likely surprise the user more than starting fresh would.

### 6. Item 1's indicator: checked-out vs. HEAD-points-to

*(Unchanged from the first pass, renumbered.)* Recommendation: keep the new graph-column ring
matched exactly to the existing row-bold/badge-dot indicators' own already-settled notion of
"checked out," including the detached-HEAD case `refBadges.ts` already handles. Nothing in this
revision's own investigation changed that reasoning.
