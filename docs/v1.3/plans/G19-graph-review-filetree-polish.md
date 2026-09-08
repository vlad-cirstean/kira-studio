# G19 — Git graph, review panel, and file-tree polish batch

> **What this phase is.** SPEC's G19 row is fifteen distinct findings from real, hands-on use of the
> shipped extension, across three areas: the commit-graph panel (items 1-4), the branch-review
> sidebar (items 5-12), and the file-tree/file-list component the first two areas share (items
> 13-15). Two of the fifteen (8, 10) are real behavioural bugs with a single, mechanical root cause
> each — both confirmed here against the actual code, not assumed from the bug report's own
> phrasing. One (3) is a real component-library gap, scoped honestly below rather than either
> ballooning into a cross-app extraction or being quietly reduced to a CSS tweak. The rest are
> UX/consistency polish, each verified against the current implementation before a fix is proposed.
>
> **Nothing here touches Go.** Every one of the fifteen items lives in `packages/git-ui` (Vue/CSS),
> `apps/kira-studio-vscode/src` (the extension host, TypeScript), or `apps/kira-studio-vscode/package.json`
> (view/panel titles). `CONTRACT_VERSION` stays at **21** — every fix below is answerable with RPCs,
> events, and bootstrap-island fields that already exist; §2's decisions say explicitly, per item,
> why no wire change is needed even for the two that touch the extension host (8, 9) and the one that
> looked most likely to need one (11).
>
> **One quietly load-bearing finding that isn't one of the fifteen: `packages/git-ui/src` carries no
> unit tests at all.** `bun run test:unit`'s glob (root `package.json`) is
> `apps/kira-studio/tests/unit packages/api-core/test packages/git-ipc/src apps/kira-studio-vscode/src`
> — `packages/git-ui/src` is not in it, and a repo-wide search for `*.test.ts` under that package
> returns zero files, despite several source files' own doc comments (`refBadges.ts`, `columns.ts`,
> `rowSvg.ts`) describing a `tests/unit/ui/*.test.ts` convention that was evidently never carried
> into this port. This phase adds several genuinely pure, testable functions (a HEAD node shape, a
> file-type icon mapper, a K/M/B number formatter) with nowhere to put a regression test today — D16
> below fixes the glob and adds real tests for them, rather than adding untestable pure functions to
> a package that has apparently never had a test run against it.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against `claude/feature-v1-3-headless-git` at `c0339a11` (SPEC's own G19-insertion commit,
on top of G1-G18). Working tree clean at investigation time. G17 (stash) is landing concurrently on
this same branch per this task's own briefing — this plan touches no file G17's own SPEC scope
(`internal/gitclient`, `internal/gitops`, `StashList.vue`, `StashDetailPane.vue`,
`state/stash.ts`) owns, and `git status`/`git pull --rebase` is checked immediately before the
closing commit (§6).

### 0.2 Scope, and the 1:1 map every item below is traceable through

| Area | Items | Findings | Decisions |
|---|---|---|---|
| Git Graph | 1-4 | F1-F4 | D1-D4 |
| Review bar | 5-12 | F5-F12 | D5-D12 |
| File tree | 13-15 | F13-F15 | D13-D15 |
| (test infra, not a SPEC item but load-bearing for several above) | — | F16 | D16 |

Every one of the fifteen SPEC items gets exactly one `F<N>`/`D<N>` pair below, numbered to match the
item number in SPEC's own G19 row — no item is folded into another's prose or silently dropped.

### 0.3 Ground rules

- **Verify before fixing.** Every finding below is checked against source read in this container,
  file:line. Two items (1, 4) turn out to be *partially* already implemented, in a way the bug
  report's own wording does not capture — the findings say exactly what already works and what does
  not, rather than treating the SPEC prose as a literal spec of the current state.
- **No `packages/git-ui` behaviour changes to `DetailPane.vue`/`StashDetailPane.vue` (the graph's
  own file trees) from the review-panel-scoped items (5-12).** `FileTree.vue` is shared; every
  review-only change below is gated on the `reviewStyled` prop that already exists for exactly this
  purpose (G12 D14's own convention, re-used here rather than re-invented).
- **No `CONTRACT_VERSION` bump.** Confirmed live in `packages/git-ipc/src/validate.ts:24` (`= 21`)
  at investigation time; §2 states per-item why each fix reuses an existing RPC/event/bootstrap
  field rather than needing a new one.
- **Fix causes, not symptoms**, for the two real bugs (8, 10) — each finding traces the actual
  mechanism, not merely a plausible-sounding one.

---

## 1. Findings

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
'stash'` — and `rowSvg.ts:161-184`'s `planNode` draws one of three shapes accordingly. **There is no
fourth shape, and no HEAD-aware styling of any kind, in the graph column's own node/edge rendering.**
Every commit dot, current-branch tip or not, is visually identical there. A user scanning the lane
column itself — which is what "the graph" most naturally means, as distinct from the message column
next to it — sees nothing marking which dot is checked out. This is a real, narrower gap than the
SPEC prose implies (it is not that no indicator exists anywhere; it is that the graph column
specifically has none), and the existing row-bold/badge-dot indicators are independently worth
keeping (they answer "is HEAD" even when the row scrolls the graph node itself out of view under a
narrow panel — unlikely given the column's own fixed width, but not the point).

#is-head data is already known client-side at exactly the point `rowSvg.ts` needs it:
`graphColumn.ts:52`'s `readSlice` already calls `isStashRow(store.decorationAt(row))` for the same
row the graph formatter draws — `store.decorationAt(row).some(isHeadDecoration)` is the identical
shape, and `columns.ts:35-37`'s own `isHeadDecoration` is already the single source of truth (not
duplicated) for the row-bold indicator. No new state, no new RPC.

#### F2 — The date column's default width clips its own content, silently

`packages/git-ui/src/state/viewState.ts:62` — `DEFAULT_COLUMN_WIDTHS = { author: 140, date: 120,
sha: 80 }`. `formatAbsoluteDate` (`dateFormat.ts:47-52`) produces `"2024-03-14 09:41"` — 16
characters, in `--kv-mono-font-family`... no: `columns.ts:113-122`'s `dateFormatter` renders through
`textCell(text, 'kv-cell-date')`, and `.kv-cell-date` (`CommitGrid.vue:1061-1065`) sets
`font-variant-numeric: tabular-nums` but **no monospace font-family** — it inherits
`--kv-font-family` from `.kv-commit-grid` (a proportional UI font), so 16 characters plus the
column's own `padding: 0 var(--kv-space-2)` (`.kv-commit-grid .slick-cell`, line 924) routinely
exceeds 120px. Critically, **`.kv-cell-date` has no `text-overflow: ellipsis`** — unlike
`.kv-message-subject` and `.kv-cell-author`, which both do (lines 958-963, 973-977) — so an
absolute-format date that overflows its cell is not truncated-with-an-affordance, it is silently
clipped by the cell's own `overflow: hidden` (`.kv-commit-grid .slick-cell`, line 927), which reads
as a rendering bug rather than a deliberate truncation. Confirmed: this is exactly "the timestamp
column is narrower than a normal timestamp needs to display."

#### F3 — Toolbar and context menu are ad hoc; a real, richer design system exists but lives in a different app, on a different token system, with incompatible state ownership

`AppToolbar.vue` (buttons: lines 219-229, 240-274, 278-288, 298-311) and `RowContextMenu.vue`
(lines 157-195) are hand-built `<button>`/`<div role="menu">` markup styled directly against
`--kv-*` tokens — functional (real ARIA menu semantics, full keyboard roving focus, focus-return —
`RowContextMenu.vue:73-154` is genuinely solid), but visually ad hoc: menu items carry no icon at
all (`kv-row-menu-item` template, lines 170-191, is a bare `<span>{{ item.label }}</span>`), buttons
mix icon+text and icon-only inconsistently, and **the toolbar button CSS is already duplicated, not
shared**: `AppToolbar.vue:340-342`'s own comment admits `.kv-toolbar-button` "is shared with
`PullStrategyPicker.vue`'s own trigger buttons... defined identically in both places rather than one
importing the other's CSS" — a second copy of the same rule, already drifting by construction.

A real, materially richer design system exists, entirely inside `apps/kira-studio/frontend` (Kira
Studio's own Wails UI, not this extension):

- `apps/kira-studio/frontend/src/theme/primitives.css` — `.p-btn`/`.icon-box`/`.p-row` primitives,
  with a stated law ("icons never float unboxed next to text" — `AppButton.vue:6`).
- `apps/kira-studio/frontend/src/theme/primitives/AppButton.vue`, `IconButton.vue` — the button
  components built on those primitives.
- `apps/kira-studio/frontend/src/workbench/ContextMenu.vue` (333-438 lines) — a genuinely more
  capable menu than `RowContextMenu.vue`: per-row icon-box (including a colour swatch variant),
  submenus with flip-aware floating-ui positioning (`theme/floatingPosition.ts`), a `danger` visual
  variant, checked-state, keyboard shortcuts rendered inline, roving keyboard focus matching
  `RowContextMenu.vue`'s own (independently arrived at the same ARIA pattern).
- Backed by `apps/kira-studio/frontend/src/theme/tokens.css` (a `--kira-*` token set — Kira Studio's
  own bespoke palette) and a page-global reactive singleton, `state/contextMenu.ts`'s
  `contextMenuState` (one context menu instance for the whole app, opened/closed by mutating shared
  state — `ContextMenu.vue:12`, `closeContextMenu`).

**This cannot be imported as-is**, for two independent reasons, not one:

1. **Token mismatch.** `--kira-*` is Kira Studio's own fixed dark palette; `packages/git-ui`'s whole
   design is to *disappear into VS Code's own theme* (`--kv-*` tokens map to `--vscode-*`
   variables — G16 F1's own investigation confirmed this end to end). Literally importing
   `AppButton.vue` would render Kira-Studio-branded buttons inside a VS Code webview, which looks
   wrong in a *different* way than today's ad hoc-but-VS-Code-toned buttons do.
2. **State-ownership mismatch.** `ContextMenu.vue` assumes exactly one menu instance exists for the
   whole page, opened by mutating a shared singleton (`contextMenuState`) — the opposite of
   `packages/git-ui`'s own convention (`App.vue` owns `RowContextMenu.vue`'s instance via
   `menuState`, `ReviewCommitRow.vue:86-92` the same, each a local `ref`). Adopting the singleton
   would be a real regression against a pattern this package already gets right — no single global
   menu can serve both the graph panel and the review sidebar, which are two separate webview
   documents with two separate JS heaps.

Also: `packages/shared` (`@kira/shared`) — the one workspace package that *is* imported by both
`apps/kira-studio/frontend` and could in principle be imported by `packages/git-ui` — holds zero
Vue/UI code today (protocol/domain types only, confirmed by listing its full contents). It is not a
component-library seam waiting to be used; one does not exist.

**So: no shared component package exists that `packages/git-ui` can import from today.** §2 D3
scopes the fix accordingly — matching the *design language* (icon-box convention, per-item
icons, danger styling, one shared button primitive instead of two drifting copies), expressed
through `packages/git-ui`'s own `--kv-*` tokens and its own per-component menu-instance ownership,
not a literal import.

#### F4 — The graph's commit-detail message renders in full, with no truncation; the "tree of changes below it" already exists

`CommitMeta.vue:181` — `bodyParagraphs` (every blank-line-separated paragraph of the commit body)
renders into one unbounded `<p ref="bodyEl">`, no `max-height`, no line-clamp, no expand affordance
of any kind. A long commit message (a squashed PR body, a generated changelog entry) pushes the rest
of the pane down indefinitely. This confirms the SPEC item's message-truncation half exactly.

The **second half — "below/after it show the tree of changes... the same way the review panel
already does" — is already true**, and has been since P5/W11: `DetailPane.vue:82-113` renders
`<CommitMeta section="message">`, then `<FileTree>`, then `<CommitMeta section="details">` — the
exact "message, then files, then details" order, through the identical `FileTree.vue` component the
review panel's `ReviewCommitRow.vue:240-254` and `ReviewFilesPane.vue:119-134` also use. There is no
second implementation to reconcile. **F4's real, actionable gap is the message truncation alone.**

### Review bar

#### F5 — The two compared branches sit on one line, with no swap

`ReviewView.vue:554-566` (`kv-review-summary-line`): one flex row — a git-branch icon, the plain-text
`review.branch` name, a static `↔` arrow, then `BaseSelector`'s own trigger. No stacking, and no
control anywhere that inverts which side is the subject (`review.branch`, fixed for the life of a
`ReviewSessionState`, set only by `setTarget`) and which is the base (`review.resolution.value.base`,
changeable via `setBase`). Confirmed exactly as reported.

#### F6 — The review-panel filter is a permanent input, not a revealed one

`ReviewView.vue:613-620` (`kv-review-toolbar-filter`): an always-rendered `<input>` inside the
panel-level toolbar (`kv-review-toolbar`, `575-643`) — no icon-button gate, unlike this same file's
own `BaseSelector.vue:129-136`, which *does* already gate its own (smaller) filter behind opening the
dropdown. Confirmed.

#### F7 — Two genuine copy-icon affordances remain in `ReviewCommitRow.vue`, even though a working copy context-menu item already exists

`rowMenuModel.ts:91-96`'s `buildReviewRowMenu` already offers `copySha`/`copyMessage` as menu items,
wired live in `ReviewCommitRow.vue:98-105`'s `onMenuSelect`. Independently, the same row also renders
**two** always-or-hover-visible copy buttons that duplicate exactly that functionality:
`ReviewCommitRow.vue:189-197` (the sha rendered as a clickable `<button class="kv-review-row-sha">`
that copies on click) and `:214-222` (a dedicated hover-revealed "Copy SHA" icon button). Separately,
`FileTree.vue:454-462`'s `.kv-file-tree-copy` "Copy file path" button has **no** context-menu
equivalent at all today — `FileTree.vue` has no right-click handling whatsoever. Confirmed and
refined: this is not "no context-menu path exists," it is "the commit-row copy path already exists
in the menu and is redundant on the button; the file-row copy path exists only as a button and needs
a menu built for it."

#### F8 — "Open all changes" really does loop every file; the bug is that VS Code's diff command reuses one preview tab across the loop, so only the last survives

`ReviewCommitRow.vue:117-134`'s `openAllChanges` is correct as written — it iterates every file in
`exp.detail.detail.value.files` and calls `exp.actions.openInEditor(...)` for each, which is
`ReviewSessionState.#createRowActions`'s `openInEditor`
(`state/review.ts:368-376`) → the `editor.openDiff` RPC → `proxyHandlers.ts:190-223`, which composes
the two-revision diff and calls `editor.openDiff({left, right, title})` once per file — **exactly
one file is not silently dropped from the loop.**

The actual defect is in `apps/kira-studio-vscode/src/ports/editorIntegration.ts:85-92`:

```ts
async openDiff(req: { left: DocumentRef; right: DocumentRef; title: string }): Promise<void> {
  await vscode.commands.executeCommand('vscode.diff', toUri(req.left), toUri(req.right), req.title);
}
```

`vscode.diff` is called with **no fourth `TextDocumentShowOptions` argument** — no `{ preview: false
}`. VS Code's default editor-preview behaviour means each of these N sequential `vscode.diff` calls
opens into the *same* preview tab, replacing whatever the previous call opened, rather than opening
N separate tabs. By the time the extension host has processed all N requests from the tight
(un-awaited, `void`-fired) loop in `openAllChanges`, only the diff from the **last** file is still on
screen — every earlier one was silently superseded. This precisely matches "only picks up the last
file in the commit": not a data bug, a tab-reuse bug, traced to one missing options argument on one
line. Every other caller of `editor.openDiff` (a single-file click) is unaffected in *symptom* — a
lone diff replacing an empty/no-longer-relevant preview tab looks correct — but is using the exact
same reuse-prone code path.

#### F9 — There is no marker at all for a virtual (non-existent-on-disk) document, and no mechanism exists to add one yet

Every diff `editor.openDiff`/`editor.openRangeDiff` open shows two `DocumentRef`s, each either
`{kind: 'empty'}` (an add/delete placeholder, already visually blank — self-evident) or `{kind:
'virtual', key: virtualKey(repoId, rev, path)}` (a `kira-version:` scheme URI resolved by
`VsCodeEditorIntegration.registerVirtualDocuments` — `editorIntegration.ts:62-83` — reading historical
content via `file.read`-style resolution, never touching the working tree). **Every diff's content is
virtual** in this sense — a diff is definitionally never "the live file." The distinction the SPEC
item actually wants (confirmed by its own wording, "doesn't really exist... at that point") is
narrower: whether the path the virtual document represents **currently has a live counterpart on
disk at all** — a file still present but merely diffed against an old revision is ordinary and
expected; a file that was deleted or renamed away since, so there is no live file to "go to," is
where a lock icon adds real information. **No such distinction is made anywhere today** —
`toUri`/`registerVirtualDocuments` treat every virtual document identically, and no
`vscode.FileDecorationProvider` is registered anywhere in this extension (`grep
registerFileDecorationProvider apps/kira-studio-vscode/src` — zero hits). This is a real, confirmed
gap, not a misreported one: nothing marks these tabs today, for any reason.

`virtualKey.ts:12-21`/`33-43` already carries everything a decoration provider needs:
`parseVirtualKey`/`decodeKey` recover `{repoId, rev, path}` from any `kira-version:` URI's first path
segment, and `repoId` is documented (`virtualKey.ts:47`) as the worktree's absolute root — so
`path.join(repoId, path)` is the live-disk path to check.

#### F10 — Confirmed: `FileTree.vue`'s row click never stops propagation, and `ReviewCommitRow.vue`'s outer wrapper's click handler unconditionally toggles

`FileTree.vue:398` — `<div class="kv-file-tree-row" ... @click="onRowClick(index)">` — no `.stop`
modifier, and `onRowClick` (`FileTree.vue:205-214`) itself never calls `stopPropagation()`.
`ReviewCommitRow.vue:163-173` — the **entire row**, header *and* body, is one element:
`<div class="kv-review-row" ... @click="onRowClick" ...>`, wrapping both `.kv-review-row-header`
(174-234) and, when expanded, `.kv-review-row-body` (236-256) — which is exactly where the row's own
`<FileTree>` (240-254) mounts. `onRowClick` (`:58-61`) is unconditional:

```ts
function onRowClick(): void {
  emit('focus-row');
  emit('toggle');
}
```

So a click on any file row inside the expanded commit bubbles, untouched, straight up to this
handler, which calls `toggle()` regardless of where the click actually landed — collapsing the very
commit the user just clicked into. Confirmed exactly as reported, root-caused to two specific lines:
the missing stop at the origin (`FileTree.vue:398`) and the over-wide listener at the destination
(`ReviewCommitRow.vue:170`). Either one fixed independently would close the bug; §2 D10 picks one and
says why.

#### F11 — State loss is not a bug, it is `NullViewStateStore`'s stated, deliberate design (§6.8/D41) — and the exact mechanism the graph panel already uses to avoid it is sitting unused one file away

`webview/main.ts:107-114`:

```ts
if (bootstrap.view === 'review') {
  mount(container, { transport, viewState: new NullViewStateStore(), host: bootstrap.host,
                      view: 'review', target: bootstrap.target });
}
```

`state/viewState.ts:147-155`'s `NullViewStateStore` — `read()` always `null`, `write()` always
discards — with its own doc comment stating this is a deliberate P7-era design decision ("this view
persists nothing at all"). `reviewView.ts:57-61`'s `webviewView.webview.options` carries no
`retainContextWhenHidden`, so — exactly like the graph panel (`panelView.ts`'s own comment, quoted
in G16 F1) — VS Code destroys the webview's JS heap on every hide and `resolveWebviewView` reruns
from nothing on every reveal. Combined, every hide/reveal of the review sidebar (collapsing the
Activity Bar view is the ordinary, frequent case — not merely closing VS Code) throws away branch,
base override, pane (commits/files/comments), filter text, list mode, diff mode, and every expanded
commit. This is exactly "closing the review panel currently loses all state, forcing a restart from
the beginning."

**The fix already exists, unused, one file away**: `webview/main.ts:59-73`'s
`VsCodeApiViewStateStore` (`acquireVsCodeApi().getState()/setState()`) is precisely VS Code's own
mechanism for surviving this exact destroy/recreate cycle, and it is *already wired up for the graph
panel* (`webview/main.ts:116-148`) — its own doc comment at line 57-58 says so explicitly: "the
mechanism a hidden/recreated webview view survives through, since `retainContextWhenHidden` is
deliberately left off." The review branch of the same `if` (lines 107-114) simply never uses it.
There is no back/forward navigation-stack mechanism of any kind today, on either branch.

#### F12 — Every user-visible occurrence of the panel's current name, found by grep

`apps/kira-studio-vscode/package.json:47-48` (`viewsContainers.activitybar[0].title`, "Branch
Review"), `:63-64` (`views.kiraVersionReview[0].name`, also "Branch Review") — the two strings VS
Code actually renders (Activity Bar hover label and the view's own section header).
`apps/kira-studio-vscode/README.md:26` ("**Branch Review** — the second activity-bar view...").
`apps/kira-studio-vscode/src/reviewMarking.ts:494` (a live diagnostic message: "...reopen the file
from the **Branch Review** sidebar to mark it."). `apps/kira-studio-vscode/resources/review-icon.svg:2`
(`<title>Branch Review</title>` — the SVG's own accessible name, shown as a tooltip on some
platforms). **Not** in scope, and left alone, on purpose: `commands.ts:131`'s command title "Review
Branch Changes" (a verb-phrase command label, not the panel's name — same for
`package.json:87-89`'s matching `contributes.commands` entry) — SPEC's own wording asks to rename
"the panel itself," not every command that mentions review. Also notable and already correct:
`AppToolbar.vue:205`'s `aria-label="Kira Version toolbar"` — the **graph** panel's own toolbar
already calls itself "Kira Version" internally; only the **review** panel's user-visible name needs
the rename SPEC asks for.

### File tree / file list

#### F13 — File names render in the literal monospace editor font, but only under the review panel's own skin — by an explicit, named design law this phase now overturns

`FileTree.vue` itself sets no font-family on `.kv-file-tree-name` (`616-619`) — it inherits
`--kv-font-ui` from its ancestor, which is what the graph's `DetailPane.vue` instance (not wrapped in
`.kv-skin-kira`) actually renders with today: **the graph panel's file tree already matches the rest
of the UI, and is not the bug.** The review panel is: `ReviewView.vue:1103-1106`:

```css
.kv-skin-kira .kv-file-tree-status,
.kv-skin-kira .kv-file-tree-name {
  font-family: var(--kv-font-data); /* LAW 08: a file path is data. */
}
```

`--kv-font-data` is not a distinct "data-styled" font — `kira-structure.css:60`: `--kv-font-data:
var(--kv-mono-font-family)`, and `vscode-tokens.css:96`: `--kv-mono-font-family: var(--vscode-editor-
font-family, ui-monospace, monospace)` — the literal VS Code editor font, monospace by convention on
every real installation. So file *names* in the review panel's file tree render in the code-editor
font, by a named design rule ("LAW 08... Mono is for data") applied here in an earlier phase. That
rule is coherent for a sha or a branch name (both genuinely fixed-width, copy-pasted tokens) but,
found by real usage, reads as visually inconsistent for an ordinary file *name* sitting in a list —
exactly "it currently appears to use a monospaced font instead of matching the rest of the UI."
Confirmed as real, and precisely scoped to one rule in one file.

#### F14 — Confirmed generic status letters, and a real ceiling on what codicons alone can offer

`fileTreeModel.ts:11-19`'s `STATUS_LETTERS` (A/M/D/R/C/T/U) is the *only* per-file glyph rendered
today (`FileTree.vue:414-419`, `.kv-file-tree-status`) — no icon of any kind names the file's type.
Checked the actual vendored icon set this package depends on
(`@vscode/codicons@0.0.46-24`, confirmed a real dependency in `packages/git-ui/package.json`):
codicons ships a genuinely small file-type vocabulary — `file`, `file-code` (one generic "this is
source code" glyph, **not** per-language — there is no `codicon-typescript`/`-python`/`-vue`/`-rust`
etc.), `file-media`, `file-pdf`, `file-zip`, `file-binary`, `file-submodule`, `file-symlink-file`,
`file-symlink-directory`, `json`, `markdown`. That is the complete list (grepped the real installed
package, not the 24-icon subset this repo currently vendors into its own `icons/codicon.css`, which
is smaller still and would need extending). **A rich, per-extension icon theme (Material Icon Theme,
Seti) is not achievable with codicons alone** — SPEC's own wording asks for codicons specifically
("already a `packages/git-ui` dependency"), so the honestly-scoped fix is a coarse
extension→category mapping (json/markdown/media/archive/binary/pdf get their own codicon; everything
else — the large majority: `.ts`, `.go`, `.vue`, `.rs`, `.css`, `.py`, ...) — collapses to the one
generic `file-code`/`file` glyph, which is still a real improvement over today's status-letter-only
scheme and is what SPEC literally asked for, not a promise of per-language icons it did not ask for.

#### F15 — Confirmed: raw numbers, unabbreviated, in the two places diff stats render

`FileTree.vue:409-410` (directory aggregate: `+{{ row.node.additions }}`/`-{{ row.node.deletions
}}`) and `:433-435` (per-file: `+{{ row.node.change.additions ?? 0 }}`/`-{{ ...deletions ?? 0 }}`) —
both plain template interpolation, no formatting function of any kind. A large generated/vendored
file's diff (thousands of added lines) renders as `+12483`, not `+12.5K`. Confirmed exactly as
reported; no other call site renders these particular numbers (`ReviewFilesPane.vue` and
`ReviewCommitRow.vue` both render file lists exclusively through this same `FileTree.vue`, so one fix
reaches every occurrence).

### Test infrastructure

#### F16 — `packages/git-ui/src` has never been in `test:unit`'s scope, and carries zero test files today

Root `package.json:37`: `"test:unit": "bun test apps/kira-studio/tests/unit packages/api-core/test
packages/git-ipc/src apps/kira-studio-vscode/src"` — `packages/git-ui/src` is absent. A repo-wide
`find packages/git-ui -iname "*.test.ts"` returns zero files. Several source files in this exact
package (`refBadges.ts:16-20`, `columns.ts` module doc, `rowSvg.ts:10-13`) describe a
`tests/unit/ui/*.test.ts` convention — from `docs/plans/P4.md`, upstream's own plan — that was never
actually created in this repo's port. This phase adds three new pure, testable functions (D1's HEAD
node-shape helper, D14's file-icon mapper, D15's number formatter) that have, today, no test tier to
land in.

---

## 2. Decisions

### Git Graph

#### D1 (item 1) — A fourth graph-node marker: a HEAD ring, computed the same way the row-bold indicator already is

`graph/palette.ts`'s `NodeKind` gains no new variant (stash/merge precedence stays exactly as F1
found it — a stash commit is still drawn as a stash regardless of HEAD). Instead, `RowSlice`
(`rowSvg.ts:45-53`) gains one new field, `isHead: boolean`, and `planNode` (`rowSvg.ts:161-184`)
adds one more shape to whichever kind's own shapes it already returns: an unfilled ring at
`GEOMETRY.mergeRadius` (reusing the existing merge-ring radius constant rather than inventing a new
one) drawn in a *fixed*, theme-token colour (`--kv-focus-border` — the same token the existing badge
dot already uses, so the two indicators agree visually) rather than the row's own lane colour, so it
reads as "this is HEAD" rather than "this is another lane". `graphColumn.ts:29-56`'s `readSlice`
computes `isHead` the identical way `columns.ts:35-37`'s `isHeadDecoration` already does —
`store.decorationAt(row).some(isHeadDecoration)` — moved to a small shared export (`isHeadDecoration`
promoted out of `columns.ts` into a location both files can import, e.g. `refBadges.ts` alongside
`isStashRow`'s own sibling `isStashDecoration`, mirroring how `isStashRow` already crosses this same
module boundary) rather than a second, drifting copy of the same three-line predicate. No new RPC,
no new store field — `decorationAt` already carries everything needed.

The existing row-bold (`kv-row-head`) and badge-dot indicators are **kept, unchanged** — they answer
a related but distinct question ("which named branch is this," for the dot) and remain useful; this
adds the one indicator that was actually missing from the graph column itself.

#### D2 (item 2) — Widen the date column's default width, and give it the same overflow safety net every other column already has

`viewState.ts:62`'s `DEFAULT_COLUMN_WIDTHS.date` moves from `120` to `152` — sized against
`formatAbsoluteDate`'s actual 16-character output (`"2024-03-14 09:41"`) plus the cell's own
horizontal padding, measured against `--kv-font-family`'s typical proportional-font character width
rather than guessed; the relative format (`"2h"`, `"3mo"`) is far shorter and never the constraint.
`CommitGrid.vue:1061-1065`'s `.kv-cell-date` gains `overflow: hidden; text-overflow: ellipsis;
white-space: nowrap` — bringing it to parity with `.kv-message-subject`/`.kv-cell-author`, so a
future date format (or a locale-driven width this repo does not currently vary) degrades to a
familiar ellipsis rather than a silent, unindicated clip. **`MIN_COLUMN_WIDTH`
(`CommitGrid.vue:92`, `= 40`) is unchanged** — a user is still free to drag the column narrower than
this new default; the ellipsis addition is what makes that a legible choice rather than a rendering
bug either way.

Existing persisted `PersistedViewState`s (VS Code's `getState()`, real users' saved column widths)
are untouched by this — `DEFAULT_COLUMN_WIDTHS` only seeds a *first-ever* mount (`webview/main.ts:123-140`'s
own guard, `if (bootstrap.repo && !viewState.read())`); a user who already dragged their date column
keeps whatever width they chose.

#### D3 (item 3) — Match the design system's *language* through `packages/git-ui`'s own tokens and menu-instance ownership; no cross-app import, no new shared package

Per F3's scoping: this is a visual-and-icon-vocabulary alignment, not a component swap.

**D3a — Toolbar.** One new stylesheet, `packages/git-ui/src/theme/controls.css`, holding two shared
primitives — `.kv-btn` (the icon-box-plus-label button shape, generalising `.kv-toolbar-button`) and
`.kv-icon-box` (a fixed-size flex box every button's codicon sits inside, matching
`primitives.css`'s own stated law that "icons never float unboxed next to text") — expressed purely
in `--kv-*` tokens already defined (`--kv-panel-border`, `--kv-row-hover-bg`, `--kv-radius`, and
similar; no new token invented). `AppToolbar.vue`'s own `.kv-toolbar-button` rule (317-364) and
`PullStrategyPicker.vue`'s duplicate of it (per F3's own citation of that duplication) are both
replaced by importing this one shared rule — closing the drift F3 found, not merely restyling around
it. `UndoButton.vue`'s and `RefreshButton.vue`'s own buttons adopt the same class for the same
reason. No behavioural change to any of these buttons — click handlers, disabled logic, and gating
are all untouched; this is a CSS-and-markup-class pass.

**D3b — Context menu.** `rowMenuModel.ts`'s `MenuItem` (`10-17`) gains two new optional fields:
`icon?: string` (a codicon class, following `ACTION_ICONS`'/`BADGE_ICONS`'s existing naming
convention) and `danger?: boolean`. `buildRowMenu`/`buildRefMenu`/`buildReviewRowMenu`/
`buildStashMenu` (wherever they live today) each supply an icon per action they already build a
label for (checkout → `codicon-check`, create branch → `codicon-git-branch`, create tag →
`codicon-tag`, revert/reset/cherry-pick → `codicon-history`/`codicon-debug-step-back`/
`codicon-git-cherry-pick` as appropriate, copy actions → `codicon-copy`) and mark the destructive
ones (`revertThisCommit`, `resetToThisCommit`, and F7's new `deleteRemoteBranch`-family items where
applicable) `danger: true`. `RowContextMenu.vue`'s template (`170-191`) grows an icon-box span per
row (rendering nothing when an item carries no icon, so a menu built before this phase's own
call sites are updated degrades to exactly today's layout rather than a ragged gap) and a
`kv-row-menu-item--danger` class using the same `--kv-diff-deleted-fg`/`--kv-error-fg` token the
existing `.kv-push-menu-item` rule (`AppToolbar.vue:397-409`) already established as this app's own
danger-styling precedent — not a new colour choice. **The menu's existing keyboard/focus/ARIA
behaviour (`onKeydown`, `enabledNeighbour`, focus-return) is untouched** — F3 found it already
correct; this only changes what each row visually carries.

**Explicitly not done, and why**: no new workspace package, no import from
`apps/kira-studio/frontend`, no adoption of its `contextMenuState` singleton. §8 item 1 carries the
broader "should a real shared component package exist" question to a human, since this phase's own
answer (visual-language parity through this package's own tokens) is a real fix but a smaller one
than a literal shared-library reuse.

#### D4 (item 4) — Truncate the commit message body to 4 lines with a click-to-expand toggle; the file tree beneath it is unchanged

`CommitMeta.vue` gains one new `ref(false)` (`bodyExpanded`), scoped to the `section === 'message'`
instance only (the `'details'` section never renders a body at all, so this is a no-op there by
construction). `.kv-meta-body` (`279-282`) gains a CSS `line-clamp: 4` (with the standard
`-webkit-line-clamp`/`display: -webkit-box`/`-webkit-box-orient: vertical` fallback triad this repo's
target Chromium/WebKit both support natively) applied only while `!bodyExpanded`, and a "Show
more"/"Show less" text button appended after `bodyEl`, visible only when the un-clamped content
actually overflows 4 lines (measured via `bodyEl.value.scrollHeight > bodyEl.value.clientHeight`
inside `renderBody`'s own existing `nextTick`-scheduled pass, so no separate `ResizeObserver` is
needed — the message is static per commit, it only needs measuring once per render). Clicking
toggles `bodyExpanded`; the FileTree/second `CommitMeta` section below it reflow accordingly, exactly
as any collapsed-then-expanded block would. **No change to `DetailPane.vue`'s ordering** (F4's
second half needs none) and **no change to `FileTree.vue`** — the "tree of changes... the same way
the review panel already does" half of this item is already true, confirmed in F4, not touched here.

### Review bar

#### D5 (item 5) — Stack the two sides vertically; add a swap action that re-targets the session through the two RPCs it already has

`ReviewView.vue`'s `.kv-review-summary-line` (`554-566`) is restructured into two stacked rows
inside a new `.kv-review-compare` wrapper: row 1 names the branch under review (unchanged, plain
text — it is not interactive today and stays that way), row 2 is `BaseSelector`'s existing trigger
(unchanged internally). Between them, one new icon button (`codicon-arrow-swap`, confirmed present in
the real `@vscode/codicons` package) — "Swap base and compared branch."

The swap itself needs no new RPC: `ReviewSessionState` already exposes `setTarget(repoId, branch)`
and `setBase(base)`, and F5 confirms `resolveBase` already accepts an override. A new
`ReviewSessionState.swapBaseAndBranch(): Promise<void>` reads the current `branch.value` and
`resolution.value?.base`, and — only when both are known (`resolution.value?.range.kind === 'ready'`,
mirroring the guard `setBase` itself already has) — calls `setTarget(repoId, oldBase)` followed
immediately by `setBase(oldBranch)`, the same two-round-trip sequence a user picking a different
branch and then overriding its base by hand would already produce, just automated into one click.
**No swap is offered while `resolution.value` has no `base` yet** (the `ask` phase) — there is
nothing to swap into.

#### D6 (item 6) — A search icon button gates the filter input, matching this file's own existing reveal-on-click precedent

`ReviewView.vue`'s `.kv-review-toolbar` (`575-643`) replaces the always-rendered
`kv-review-toolbar-filter` input with a `codicon-search` icon button (styled with D3a's new
`.kv-icon-box`/toolbar-button primitives, so this lands consistently with item 3's own fix rather
than as a third styling convention) plus a new `filterVisible` ref. Clicking the button toggles
`filterVisible`; when `true`, the existing `<input>` renders (unchanged props/behaviour) and receives
focus (`nextTick` + `.focus()`, the same pattern `BaseSelector.vue`'s own filter already uses when
its panel opens). The button itself carries `kv-mode-active` (the same class this toolbar's other
toggles already use, `ReviewView.vue:1000-1004`) whenever `filter.value` is non-empty **or**
`filterVisible` is true — so a filter left active-but-collapsed still visibly signals "a filter is
applied," rather than silently hiding that fact. Pressing `Escape` inside the (now-revealed) input
clears `filterVisible` back to `false` without clearing `filter.value` itself if it is non-empty —
the same two-stage discipline `SearchBox.vue`'s own doc comment (`28-37`) already establishes for
this app's other search-adjacent Escape handling, reused rather than reinvented.

#### D7 (item 7) — Remove the two redundant copy affordances from `ReviewCommitRow.vue`; add a right-click "Copy path" menu to `FileTree.vue`, scoped to `reviewStyled` instances only

`ReviewCommitRow.vue`: the sha meta-line loses its `<button class="kv-review-row-sha">` wrapper
(`189-197`) in favour of a plain `<span>` — the sha is still visible, just no longer independently
clickable — and the hover-revealed "Copy SHA" action (`214-222`) is removed outright. Both are
already fully covered by the existing `copySha` context-menu item (F7); no functionality is lost,
the click surface just stops duplicating a menu action right next to the menu that offers it.

`FileTree.vue` gains a `RowContextMenu` instance (mirroring `ReviewCommitRow.vue`'s own existing
`menuState`/`onContextMenu`/`onMenuSelect` shape, not a new pattern), wired to a new
`@contextmenu.prevent` on `.kv-file-tree-row` (line 398's existing element), **gated on `props.
reviewStyled`** — F7's own scoping ("this panel") and this repo's own established convention (G12
D14: "`FileTree.vue` is shared with the graph panel's `DetailPane`, which must stay byte-identical")
both point the same way: `DetailPane.vue`/`StashDetailPane.vue` (where `reviewStyled` is unset)
render byte-identically to today, copy button included; `ReviewCommitRow.vue`/`ReviewFilesPane.vue`
(where it is already `true`) get the new menu instead. A small new `buildFileRowMenu(clipboardEnabled:
boolean): MenuSection[]` in `rowMenuModel.ts`, following `buildReviewRowMenu`'s own shape exactly,
offers `copyPath` alone. `.kv-file-tree-copy`'s inline button (`FileTree.vue:454-462`) is removed
**only when `reviewStyled` is true** (a `v-if="!reviewStyled"` guard added to the existing button,
not a second markup branch) — again preserving `DetailPane.vue`'s pane byte-for-byte.

#### D8 (item 8) — `VsCodeEditorIntegration.openDiff` always opens a non-preview (pinned) tab

`ports/editorIntegration.ts:85-92`'s `openDiff` gains one argument to its existing
`vscode.commands.executeCommand` call: `{ preview: false }` as the fourth (options) parameter. This
is the whole fix — every `editor.openDiff`/`editor.openRangeDiff` call already routes through this
one function (`proxyHandlers.ts:217`, `:260`), so `openAllChanges`'s loop now opens N real, separate,
persistent tabs instead of N calls fighting over one preview slot. **This also changes ordinary
single-file click behaviour**: a diff opened by clicking one file, then another, now opens two tabs
instead of one tab being reused — flagged explicitly in §8 as a deliberate, recommended trade-off
(pinned tabs are the correct behaviour for "N files I asked to see," and the single-click case is a
strict subset of the same code path, not a separate one worth special-casing). No contract change —
this is entirely inside the extension host's own call to a VS Code API.

#### D9 (item 9) — A `vscode.FileDecorationProvider` for the `kira-version` scheme, badging only virtual documents whose path has no live counterpart on disk

New `apps/kira-studio-vscode/src/virtualFileDecoration.ts`, registered once at activation
(`extension.ts`, alongside the existing `registerVirtualDocuments` call) via
`vscode.window.registerFileDecorationProvider`. `provideFileDecoration(uri)`:

1. Only acts on `uri.scheme === SCHEME` (`'kira-version'`, the existing constant from
   `editorIntegration.ts:32`) whose first path segment is not `EMPTY_SEGMENT` (F9's own
   distinction: an `'empty'`-kind placeholder is already visually blank and gets no decoration).
2. `decodeKey`/`parseVirtualKey` (existing, `virtualKey.ts`) recover `{repoId, path}`.
3. `vscode.workspace.fs.stat(vscode.Uri.file(path.join(repoId, path)))` — if it throws
   (`FileSystemError` with code `FileNotFound`), the path has no live counterpart: return `{ badge:
   '🔒', tooltip: 'This file no longer exists in the working tree — showing historical content' }`.
   If it resolves (the file still exists, merely being diffed against an old revision — F9's own
   "ordinary and expected" case), return `undefined` — no decoration.
4. No `onDidChangeFileDecorations` emitter — mirrors `registerVirtualDocuments`'s own existing
   rationale (`editorIntegration.ts:9-10`: "immutable... fires no `onDidChange`"): whether a path
   currently exists on disk can in principle change mid-session, but re-evaluating it live is not
   worth the complexity for a decoration on a historical-diff tab a user is unlikely to leave open
   across an edit that resurrects the exact same deleted path.

Covers both `editor.openDiff` (single-commit diffs) and `editor.openRangeDiff` (review-branch diffs)
for free — both mint `kira-version:` URIs through the same `toUri`, so one provider, registered
once, reaches every tab either call opens. No contract/RPC change: `FileDecorationProvider` is a
pure VS Code extension API, entirely inside the extension host process.

#### D10 (item 10) — Move the row's own click-to-toggle listener off the whole row and onto its header only

`ReviewCommitRow.vue:170`'s `@click="onRowClick"` moves from `.kv-review-row` (the outer wrapper
that also contains the file tree body) to `.kv-review-row-header` (`174`, the chevron+subject+meta
strip alone) — the only element that should ever mean "toggle this commit." This is the surgical
fix: it needs no change to `FileTree.vue` at all (which is shared and used in three other contexts —
`DetailPane.vue`, `StashDetailPane.vue`, `ReviewFilesPane.vue` — none of which have or need this
bubbling concern, since none of them nest inside a second element with its own click-to-collapse
semantics), and it makes the fix legible at the point of the actual defect (an over-wide listener)
rather than at the point a completely unrelated, widely-shared component happens to be used inside
it. `@keydown`/`@contextmenu` stay on the outer `.kv-review-row` (unchanged — `Escape`/arrow-key
expand-collapse and the row's own context menu are legitimately row-scoped, not header-scoped, and
neither one has this bug: `onKeydown`, `140.kv-review-row-body}`'s only interactive descendants
(`FileTree`'s rows) already have their own `@keydown` handling that does not bubble the same way).

#### D11 (item 11) — Reuse `VsCodeApiViewStateStore` for the review view exactly as the graph panel already does; a small branch-navigation history stack for the back button

**Persistence.** `webview/main.ts:107-114`'s review branch stops constructing `NullViewStateStore`
and instead builds a `VsCodeApiViewStateStore` (the existing class, unchanged) the same way the graph
branch already does. A new, small, versioned `ReviewPersistedState` (parallel to `PersistedViewState`,
same discard-on-version-mismatch discipline `parsePersistedViewState` already establishes) holds:
`repoId`, `branch`, `baseOverride` (`string | null` — only set once the user has actually picked one
via `BaseSelector`, never the *resolved* default, so a re-resolve on the next mount still runs
`resolveBase`'s own detection rather than replaying a stale guess), `pane`, `listMode`, `filter`,
`diffMode` (from `ReviewFilesState`), and `history` (D11's navigation stack, below, capped at a small
constant — e.g. 20 entries — so it cannot grow unbounded across a very long session). `ReviewView.vue`
reads it once at `bootstrap()` (after the existing `props.target`/`review.target` arbitration — a
cold-bootstrap target or a live push both still win over restored state, matching D40's existing
priority order in spirit: an explicit "go review this branch" instruction is a stronger signal than
"resume where I left off") and writes it on every meaningful change via `watch()`s mirroring the
graph panel's own established pattern in `App.vue` for writing `PersistedViewState`. This needs
**zero contract/RPC changes** — `getState()/setState()` is a pure webview-local mechanism, entirely
inside `apps/kira-studio-vscode/src` and `packages/git-ui`, never touching `git-ipc`'s wire contract.
It naturally survives exactly the case F11 found broken (an ordinary hide/reveal of the sidebar,
which is what "closing the review panel" means for the overwhelming majority of real users) — the
same case `VsCodeApiViewStateStore`'s own doc comment already documents itself as solving.

**Back button.** A small navigation stack, `ReviewSessionState.#history: {repoId; branch; base:
string | null}[]`, pushed to (capped, oldest dropped) every time `setTarget` is called with a
genuinely different `(repoId, branch)` pair than the one already active — **not** on every
pane/filter/base change, which would make "back" fire on nearly every interaction and defeat its own
purpose. A new `back(): Promise<void>` pops the stack (no-op, and the button disabled, when empty)
and re-runs `setTarget`/`setBase` against the popped entry. `ReviewView.vue`'s header gains one new
icon button (`codicon-chevron-left`, reusing `ACTION_ICONS.back`, which already exists for exactly
this glyph — `icons/index.ts:7`), disabled when the history stack is empty, placed before the branch
name. §8 item 2 flags the scope of "back" here (branch-level navigation only, not a deeper per-pane
undo) as the judgment call it is, with this plan's own recommendation.

#### D12 (item 12) — Rename every user-visible occurrence found in F12; leave the command title alone

`package.json:48` and `:64` both change from `"Branch Review"` to `"Kira Version"`.
`README.md:26`'s prose updates to match. `reviewMarking.ts:494`'s live diagnostic message updates its
one mention of "the Branch Review sidebar" to "the Kira Version sidebar." `resources/review-icon.svg`'s
`<title>` element updates for consistency (low-risk, single-line SVG edit). `commands.ts:131` /
`package.json`'s matching `contributes.commands` entry for `kiraVersion.reviewBranch` (`"Review
Branch Changes"`) are **left unchanged** — F12's own reasoning: a command's verb-phrase title is not
"the panel's name," and SPEC's own wording scopes this to the panel itself.

### File tree / file list

#### D13 (item 13) — Drop `.kv-file-tree-name` from the `.kv-skin-kira` mono-font override

`ReviewView.vue:1103-1106`'s selector list shrinks from `.kv-skin-kira .kv-file-tree-status,
.kv-file-tree-name` to `.kv-skin-kira .kv-file-tree-status` alone — file *names* fall back to the
inherited `--kv-font-ui`, exactly matching the graph panel's own `DetailPane.vue` instance (F13's own
finding that this instance was never affected). `.kv-file-tree-status` (the single-letter status
glyph) is **deliberately left on `--kv-font-data`** for this phase — it is superseded by D14's real
icon anyway, and touching its font is moot work about to be replaced. LAW 08 itself (`kira-structure.
css:51-59`) is not rewritten or weakened — a sha/branch/path *is* still data by that rule; this
decision is narrower: a file's display *name* in a list row reads, in practice, as a UI label a user
scans rather than a token they copy-paste, which the "found by real usage" signal this phase exists
to act on outweighs the original design law's clean generality for this one specific case.

#### D14 (item 14) — A coarse extension→codicon category map, real icon primary + small secondary status chip

New pure function in `fileTreeModel.ts` (alongside `STATUS_LETTERS`/`STATUS_COLOR_CLASS`, the exact
same "table + one lookup function" shape those already use): `fileIconFor(path: string): string`,
matching a fixed, ordered list of extension groups against `path`'s own lowercased suffix —
`.json`/`.jsonc` → `codicon-json`, `.md`/`.markdown` → `codicon-markdown`, common image extensions
(`.png .jpg .jpeg .gif .svg .webp .ico .bmp`) → `codicon-file-media`, common archive extensions
(`.zip .tar .gz .tgz .rar .7z`) → `codicon-file-zip`, `.pdf` → `codicon-file-pdf`, a small known
binary set (`.exe .dll .so .dylib .bin`) → `codicon-file-binary`, and — the fallback covering the
large majority of real diffs (`.ts`, `.js`, `.go`, `.py`, `.vue`, `.rs`, `.css`, `.html`, and
everything else not matched above) — `codicon-file-code`. A directory row keeps its own existing
`codicon-chevron-*` glyph unchanged (D14 is scoped to file rows; F14 never found a directory-icon
complaint).

`.vscode/git-ui`'s own vendored `icons/codicon.css` subset (24 rules today, F14) is extended to
include the newly-referenced icon glyphs — this repo curates its own codicon subset rather than
shipping the full font, so every new class this mapping can produce must be added to that file's own
generation/list, not merely referenced and left to render as a missing-glyph box.

**Layout** (`FileTree.vue`'s file-row template, `413-436`): the real file icon becomes the row's
primary leading glyph (replacing `.kv-file-tree-status`'s current position), sized to match the
existing `.kv-file-tree-chevron`'s `12px`/`--kv-icon-box` convention already used elsewhere in this
same file (D14 introduces no new sizing token). The existing status letter (`STATUS_LETTERS`,
unchanged — the letter itself, its `STATUS_COLOR_CLASS` colouring, and its `title` tooltip all stay
exactly as they are) moves to a small secondary chip immediately after the file icon, styled smaller
(`font-size: 0.75em`, reduced from the row's own base size) and slightly reduced-opacity, matching
SPEC's own explicit instruction to keep the existing status indicators but demote them visually next
to the new, real file icon — not remove them.

#### D15 (item 15) — A small K/M/B formatter, applied at both diff-stat render sites

New `packages/git-ui/src/components/countFormat.ts` (mirroring `dateFormat.ts`'s own established
"one small pure-function file per formatting concern" shape, not folded into `fileTreeModel.ts`,
since this formatter is generic — nothing about it is file-tree-specific, and a future caller
elsewhere in this package should not have to import file-tree code to reach it):

```ts
export function formatChangeCount(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1000) return String(n);
  const [divisor, suffix] =
    abs >= 1_000_000_000 ? [1_000_000_000, 'B'] :
    abs >= 1_000_000 ? [1_000_000, 'M'] : [1_000, 'K'];
  const scaled = n / divisor;
  // One decimal place, trimmed when it would render as ".0" (1000 -> "1K", not "1.0K").
  const rounded = Math.round(scaled * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}${suffix}`;
}
```

Applied at `FileTree.vue:409-410` and `:433-435` (both the directory-aggregate and per-file spans),
replacing the raw `{{ ... }}` interpolation. The underlying number is never lost — every occurrence
keeps its existing `title`/tooltip attribute path (`fileTitle`, `:417`/`:420`) as the natural home for
the exact figure if a later phase wants to surface it there; §8 item 3 flags whether this phase
should add that tooltip itself now rather than leaving it implicit.

### Test infrastructure

#### D16 (supporting infrastructure, not its own SPEC item) — Wire `packages/git-ui/src` into `test:unit`, and add real unit tests for this phase's new pure functions

Root `package.json:37`'s `test:unit` script gains `packages/git-ui/src` to its glob:
`"bun test apps/kira-studio/tests/unit packages/api-core/test packages/git-ipc/src
apps/kira-studio-vscode/src packages/git-ui/src"`. New test files, colocated with their source
(`bun test`'s own convention, matching every other package already in this glob): `fileTreeModel.
test.ts` (D14's `fileIconFor` — one case per category, plus the fallback; D15's `formatChangeCount`
moved here would misplace it — see below), `countFormat.test.ts` (D15 — boundary cases at 999/1000,
999999/1000000, negative counts, the ".0" trim), and `rowSvg.test.ts` (D1 — `planNode` with
`isHead: true` on each of the three existing `NodeKind`s, asserting the ring is present and does not
replace the kind's own existing shapes). `refBadges.ts`'s own doc comment already describes exactly
this "pure half tested directly, DOM half left to Playwright" split (F16) — these tests follow that
established convention, which existed in prose but, per F16, in no actual file until now.

**Not added**: a Vue-component-level test tier for `packages/git-ui` (mounting `ReviewCommitRow.vue`
et al.) — this repo has no Vue Test Utils/happy-dom wiring anywhere (`columns.ts`'s own doc comment:
"this repo has no jsdom/happy-dom wired into `bun:test`, confirmed, not assumed"), and standing one
up is a real, separate investment out of proportion to this phase's own pure-function additions;
§4's Playwright extension is where the DOM-level regressions (D10's bubbling fix, in particular) get
real coverage instead.

---

## 3. Implementation, file by file

### `packages/git-ui/src`

| File | Change | Item(s) |
|---|---|---|
| `graph/palette.ts` | No `NodeKind` change (kept at 3) | D1 |
| `components/refBadges.ts` or a shared module | `isHeadDecoration` promoted so both `columns.ts` and `graphColumn.ts` share one definition | D1 |
| `graph/rowSvg.ts` | `RowSlice.isHead`; `planNode` draws the HEAD ring | D1 |
| `graph/graphColumn.ts` | `readSlice` computes `isHead` | D1 |
| `components/CommitGrid.vue` | New `.kv-node-head` ring styling; `.kv-cell-date` gains ellipsis | D1, D2 |
| `state/viewState.ts` | `DEFAULT_COLUMN_WIDTHS.date` → `152`; new `ReviewPersistedState` type + parser | D2, D11 |
| `theme/controls.css` | **New** — `.kv-btn`/`.kv-icon-box` shared primitives | D3a |
| `components/AppToolbar.vue` | Adopts `.kv-btn`; drops its own duplicated button CSS | D3a |
| `components/PullStrategyPicker.vue` | Adopts `.kv-btn`; drops its own duplicated button CSS | D3a |
| `components/UndoButton.vue`, `RefreshButton.vue` | Adopt `.kv-btn`/`.kv-icon-box` | D3a |
| `components/rowMenuModel.ts` | `MenuItem.icon`/`.danger`; icons on every existing item; new `buildFileRowMenu` | D3b, D7 |
| `components/RowContextMenu.vue` | Renders icon-box + danger styling per item | D3b |
| `components/CommitMeta.vue` | Message-body line-clamp + expand toggle | D4 |
| `components/review/ReviewView.vue` | Stacked compare header + swap button; filter behind search button; back button + history wiring; persistence read/write | D5, D6, D11, D12 (aria-label context only) |
| `state/review.ts` | `swapBaseAndBranch()`; `#history` stack + `back()` | D5, D11 |
| `components/review/ReviewCommitRow.vue` | Drop the two copy affordances; move `@click` to the header only | D7, D10 |
| `components/FileTree.vue` | Right-click menu (gated `reviewStyled`); copy button hidden when `reviewStyled`; new file-icon + demoted status chip; `formatChangeCount` applied | D7, D14, D15 |
| `components/fileTreeModel.ts` | New `fileIconFor` | D14 |
| `components/countFormat.ts` | **New** — `formatChangeCount` | D15 |
| `icons/index.ts` | New icon constants (`arrowSwap`, file-type set) added to the existing tables | D5, D14 |
| `icons/codicon.css` | Extended subset for the new glyphs D14/D5 reference | D5, D14 |
| `components/review/ReviewView.vue` (again) | `.kv-skin-kira .kv-file-tree-name` dropped from the mono-font selector | D13 |

### `apps/kira-studio-vscode/src`

| File | Change | Item(s) |
|---|---|---|
| `ports/editorIntegration.ts` | `openDiff` passes `{ preview: false }` | D8 |
| `virtualFileDecoration.ts` | **New** — `FileDecorationProvider` for the `kira-version` scheme | D9 |
| `extension.ts` | Registers the new decoration provider at activation | D9 |
| `webview/main.ts` | Review branch uses `VsCodeApiViewStateStore`, not `NullViewStateStore` | D11 |
| `reviewMarking.ts` | One string update ("Branch Review" → "Kira Version") | D12 |

### `apps/kira-studio-vscode` (non-`src`)

| File | Change | Item(s) |
|---|---|---|
| `package.json` | Two title/name strings → "Kira Version" | D12 |
| `README.md` | Prose update | D12 |
| `resources/review-icon.svg` | `<title>` update | D12 |

### Root

| File | Change | Item(s) |
|---|---|---|
| `package.json` | `test:unit` glob gains `packages/git-ui/src` | D16 |

**Not touched, anywhere in this phase**: any `apps/kira-studio/internal/**` Go package, `internal/
gitwire`'s FlatBuffers schema, `packages/git-ipc/src/contract.ts` or `validate.ts` (`CONTRACT_VERSION`
stays 21), `packages/git-core`, `apps/kira-studio/frontend/**` (Kira Studio's own Wails UI is read
for D3's reference only — nothing in it is edited), any `internal/gitsession`/`gitclient` file G17 is
concurrently touching.

---

## 4. Test plan

### 4.1 Unit tests (`bun run test:unit`, now including `packages/git-ui/src` — D16)

- `fileTreeModel.test.ts` — `fileIconFor`: one assertion per category (json/markdown/media/archive/
  pdf/binary/fallback), including a path with no extension and a path whose extension is uppercase
  (`.PNG`) to confirm the lowercasing.
- `countFormat.test.ts` — `formatChangeCount`: `0`, `999`, `1000` (→ `"1K"`, not `"1.0K"`), `1234`
  (→ `"1.2K"`), `999_999`, `1_000_000` (→ `"1M"`), `1_500_000_000` (→ `"1.5B"`), and a negative input
  (a deletion count is always rendered with its own leading `-` by the caller, but the formatter
  itself should not choke on a negative magnitude if ever handed one directly).
- `rowSvg.test.ts` — `planNode` with `isHead: true` against each of the three existing `nodeKind`s,
  asserting the new ring shape is present *in addition to* each kind's existing shapes (a stash row
  that is also HEAD — a real, reachable state — must show both the stash ring and the HEAD ring, not
  one replacing the other).

### 4.2 The `test:webview` geometry tier (G16's own Tier-1 Playwright harness) — extended, not replaced

G16 built `apps/kira-studio-vscode/tests/layout/webview-layout.spec.ts` specifically to catch a class
of bug DOM-shape assertions miss. Two of this phase's fifteen items are exactly that shape again:

- **D10 (item 10) needs a real click-through test, not a unit test.** The bug is DOM event bubbling
  across a component boundary — invisible to any pure-function test, and `columns.ts`'s own
  established convention (confirmed in F16) is that this repo has no Vue component-mount tier at
  all. The existing `test:webview` harness already boots the real bundle in a real Chromium page
  under the real CSP (G16 D10) — this phase adds one more spec file,
  `apps/kira-studio-vscode/tests/layout/review-interaction.spec.ts`, using the same static-server/
  `buildWebviewDocument` harness G16 built, but this time **with a minimal fake transport** (a new,
  small addition — G16's own harness deliberately used *no* transport, "a dead transport... is all
  the geometry assertions need"; this test needs enough of a live one to reach the `listing` phase)
  rather than the dead one G16's own geometry assertions use. Concretely: fake `bridge.request`
  responses for `repo.list`/`review.resolveBase`/`graph.stream`/`commit.detail` sufficient to reach
  one expanded commit row with a file inside it, click that file row, and assert
  `[data-testid="review-row-<sha>"]`'s `aria-expanded` is still `"true"` afterward. This is new
  scope for the harness (a fake transport is a real addition beyond what G16 built), flagged
  explicitly in §8 item 4 as the one piece of this test plan that is not simply "reuse what already
  exists."
- **D4's message-truncation-then-tree layout** is exactly the shape G16's own closing prose called
  out as a DOM-test blind spot ("the truncated-message-then-tree layout... exactly the shape of bug
  DOM-only tests miss"). A geometry assertion belongs in the same new spec file: with a commit
  carrying an intentionally long, multi-paragraph body, assert `.kv-meta-body`'s
  `getBoundingClientRect().height` is bounded (the clamp is working) before the "Show more" click,
  and grows after it — a pixel assertion, not a DOM-shape one, matching G16's own stated bar for
  this test tier.

Both new cases share the one new fake-transport fixture rather than each hand-rolling its own —
built once, in `apps/kira-studio-vscode/tests/layout/support/fakeReviewTransport.ts`.

### 4.3 Not covered by any automated tier, and why

- **D9's `FileDecorationProvider`** — genuinely needs a real VS Code host to observe a rendered
  badge on a real editor tab; `vscode.window.registerFileDecorationProvider` has no meaningful
  headless/Playwright equivalent in this repo's stack. §5.3 (Tier 3) covers it.
- **D8's tab-pinning fix** — same reason: `vscode.commands.executeCommand('vscode.diff', ...)`'s
  actual tab-reuse behaviour is a real VS Code editor-group behaviour, not something the webview
  layer (which is all `test:webview` can reach) observes.
- **D3's visual/icon-vocabulary changes** — no pixel-perfect visual-regression tier exists in this
  repo (G16 confirmed no Playwright screenshot-diff tooling is wired up); a human eye is the actual
  check here, per §5.3.

---

## 5. Non-goals

- **No extraction of a shared, cross-app Vue component package.** F3/D3 found the honest answer:
  one does not exist today, and building one is a materially larger, separate investment (real
  token-abstraction work across two apps with genuinely different theming sources) than this
  phase's own budget — flagged to a human at §8 item 1 rather than either half-built here or
  silently ignored.
- **No per-language file-type icon theme.** D14 is a coarse, codicon-only category map, exactly what
  SPEC's own wording asked for (codicons specifically) — not a Material-Icon-Theme-style per-
  extension icon set, which codicons cannot provide (F14).
- **No cross-session (VS-Code-restart-durable) review-panel persistence.** D11's fix survives every
  ordinary hide/reveal of the sidebar (the case F11 actually found broken, and by far the common
  real-world "closing the panel" case) through `getState()/setState()`, which is scoped to the
  webview's own serialized state and does not survive a full VS Code window reload. A durable
  `context.workspaceState`-backed version is a larger, separable feature — flagged at §8 item 5.
- **No redesign of `BaseSelector.vue`'s own dropdown**, beyond D5's stacking of the header it sits
  in — its internal filter/suggested-list behaviour (F5 confirmed it already gates its own filter
  behind opening) is untouched.
- **No change to `AppToolbar.vue`'s functional gating logic** (fetch/pull/push disabled states, the
  force-push submenu's own open/close) — D3a is a CSS/markup-class pass only.
- **No `CONTRACT_VERSION` bump, anywhere** — restated from §0.3 because it is worth a second, final
  confirmation: every one of the fifteen decisions above was checked against this constraint
  specifically, not assumed compatible.
- **No touch to any G17 (stash) file** — `StashList.vue`, `StashDetailPane.vue`, `state/stash.ts`,
  and every `internal/gitclient`/`internal/gitops` file are outside this phase's scope entirely,
  even though `StashDetailPane.vue` is a third consumer of `FileTree.vue` (D7/D13/D14/D15 all reach
  it automatically, for free, as a shared component — not because this phase edited it).

---

## 6. Implementation order

One sequential subagent (the work is small-grained but touches many files with real ordering
dependencies within a few of the fifteen items). `git status`/`git log` checked, and
`git pull --rebase origin claude/feature-v1-3-headless-git` run if the branch has moved (G17 landing
concurrently), **before** the closing commit — not merely at the start, since this is a multi-hour
implementation pass.

1. **D16** first — the test-infra wiring, so every subsequent pure function added below has
   somewhere to land a test the same day it is written, not as an afterthought.
2. **File tree (D13, D14, D15)** — one shared component, touched once, unblocks nothing else but is
   cleanly independent and worth finishing before the two areas that consume it.
3. **Git Graph (D1, D2, D3a, D4)** — D3a's new `theme/controls.css` primitives are built here and
   then reused by D6's search-button styling in the next group, so this group goes first among the
   two UI-heavy areas.
4. **Review bar (D5, D6, D7, D10, D11, D12)** in that order — D10 (the collapse-on-click bug) before
   D7 (which also touches `ReviewCommitRow.vue`'s click surface) so the two `git diff`s against that
   file don't fight each other; D11 last within this group since it is the largest single item and
   benefits from the rest of the panel's markup already being settled.
5. **D3b** (context-menu icons) — after D7's new `buildFileRowMenu` exists, so every menu-building
   function in `rowMenuModel.ts` gets its icon/danger fields added in one pass rather than two.
6. **Extension host (D8, D9)** — independent of everything in `packages/git-ui`; can run in parallel
   with steps 2-5 if this were split across agents, but stays sequential here per this phase's own
   single-subagent choice.
7. **Full check pass**: `bun run lint`, `bun run typecheck`, `bun run test:unit` (now covering
   `packages/git-ui/src`), `bun run build:vscode`, `bun run test:webview` (including the two new
   D4/D10 cases), `go test ./...` (expected to be a no-op for this phase's own changes — confirms
   nothing here accidentally touched a Go file).

Commits land incrementally, Conventional Commits, roughly one per numbered step or finer.

---

## 7. Exit criteria

### 7.1 Tier 1 — fully provable in this container

1. `bun run test:unit` passes, including the three new `packages/git-ui/src` test files (D16).
2. `bun run test:webview` passes, including `review-interaction.spec.ts`'s two new cases (D4, D10) —
   and the D10 case fails against the pre-fix tree (checked by hand once, mirroring G16's own §6 step
   3 discipline: a guard that never fails on the broken tree is worse than no guard).
3. `bun run lint`, `bun run typecheck`, `bun run build:vscode` all pass.
4. `CONTRACT_VERSION` is still 21 (`grep`), `packages/git-ipc/src/{contract,validate}.ts` unchanged
   (`git diff --stat`).
5. `go test ./...` touches zero files this phase changed (`git diff --stat -- 'apps/kira-studio/
   internal/**'` is empty).
6. Every file listed in §3 that claims a "byte-identical" guarantee for `DetailPane.vue`/
   `StashDetailPane.vue` is spot-checked by rendering both with `reviewStyled` unset and confirming
   no new markup/class appears.

### 7.2 Tier 3 — needs a human, on a Mac, with VS Code and Kira Studio both running

7. Item 1: a checked-out branch's commit shows a visibly distinct ring in the graph column itself,
   at a real panel width, in both a light and a dark VS Code theme.
8. Item 2: the date column, at its new default width, shows a full absolute timestamp with no clip;
   dragged narrower, it ellipsizes instead of clipping raw.
9. Item 3: the toolbar and context menu read as visually part of the same app as the rest of Kira
   Studio's own chrome — a human, qualitative check, since no visual-regression tier exists (§4.3).
10. Item 4: a long commit message truncates to 4 lines with a working expand/collapse toggle; the
    file tree below it is unaffected.
11. Items 5-7, 11, 12: the review panel's new stacked-compare header, swap button, collapsed filter,
    absence of inline copy buttons (with the context-menu equivalent working), and "Kira Version"
    naming all read correctly in the real sidebar.
12. Item 8: "Open all changes" on a real multi-file commit opens every file as its own persistent
    tab, not just the last one.
13. Item 9: opening a diff for a file deleted since the diffed commit shows the lock badge on its
    tab; opening a diff for a file that still exists today does not.
14. Item 10: expand a commit, click a file inside it — the commit stays expanded.
15. Item 11: collapse the Activity Bar's review view, reveal it again — branch, base, pane, filter,
    and expanded rows are all exactly as left; the back button returns to a previously reviewed
    branch.
16. Items 13-15: file names in the review panel's tree read in the UI font; files show real
    (coarse-category) icons with a small secondary status chip; large diff-stat numbers show as
    "1.2K"-style abbreviations.

### 7.3 The checklist

- [ ] `test:unit` covers `packages/git-ui/src`; three new test files pass.
- [ ] `test:webview` includes and passes the two new D4/D10 geometry/interaction cases.
- [ ] `CONTRACT_VERSION` is 21; `git-ipc` untouched.
- [ ] `DetailPane.vue`/`StashDetailPane.vue` render byte-identically (D7/D13's own guarantee, spot-
      checked).
- [ ] Every one of the fifteen SPEC items has a corresponding `F<N>`/`D<N>` pair above — cross-
      checked against SPEC's own G19 row one more time before commit.
- [ ] No `internal/git*` Go file, no `packages/git-core` file, no `StashList.vue`/`StashDetailPane.vue`/
      `state/stash.ts` file appears in `git diff --stat`.

---

## 8. Calls that want a human eye

### 1. Should a real shared component package be extracted from Kira Studio's design system?

D3 deliberately does not build one — F3 found that today's actual gap is a token-and-ownership
mismatch, not a missing seam, and closing that properly (a genuinely portable button/menu primitive
whose *colours* are supplied by whichever host imports it, `--kira-*` for Kira Studio and `--kv-*`/
`--vscode-*` for this extension) is real, separable design work, not a G19-sized fix. **Recommendation:
not this phase.** If this pattern recurs (G18's own new settings dialog is a plausible next place it
would — worth checking once G18 lands whether it hand-rolled its own dialog chrome too), a dedicated
phase to extract `packages/kira-ui` (or similar) with a documented token-injection contract is the
right shape; doing it piecemeal, one phase at a time, would produce exactly the kind of drift F3
already found in `.kv-toolbar-button`'s own duplicated CSS.

### 2. Is branch-level history the right scope for item 11's "back" button?

D11 scopes "back" to a stack of previously-reviewed `(repoId, branch, base)` targets — not a deeper
undo of every pane switch, filter edit, or expand/collapse. **Recommendation: keep it at this scope.**
A back button that also undoes "I switched from the Files pane to Comments" reads as browser-history
mimicry taken further than a review tool's own users are likely to expect (VS Code's own webview
history model has no precedent for it either), and the persistence half of D11 already means a
pane/filter/expand state a user leaves mid-session survives a hide/reveal on its own — the thing a
"back" button is actually for is undoing "I picked the wrong branch to review," which is exactly
what's scoped here. A reviewer who has used the shipped panel and disagrees should say so; the stack
depth (currently 20) and the exact trigger condition (branch/base change only) are both one-line
changes if the answer is "deeper."

### 3. Should D15's abbreviated counts carry an exact-number tooltip?

D15 leaves the existing `title` attribute path available (`fileTitle`) but does not itself add the
exact raw number to it for the count spans specifically (today's `title` is about rename similarity/
full path, not the add/delete counts). **Recommendation: add it** — `title="1,234 additions"` costs
one line per span and directly answers "wait, how many exactly" without a second click anywhere,
consistent with this app's own existing "the full name always lives in `title`" convention
(`refBadges.ts:154-156`'s own comment, almost verbatim the same situation). Left as an open call
rather than folded into D15 itself only because it is genuinely optional and easy to add or skip at
implementation time without touching the formatter's own logic.

### 4. The new fake-transport fixture for `test:webview` (§4.2) is new scope beyond what G16 built

G16's own harness deliberately used a dead transport — "all the geometry assertions need." D10's
click-through case is the first thing in this test tier to need more than that. **Recommendation:
build it, scoped narrowly** (four hand-written fake responses, not a general-purpose mock RPC
layer) — the alternative (leaving D10 with only a unit-test-shaped guard, which F16/D16 already
established this repo has no tier for) means the actual regression this item is about ships with no
automated guard at all, which is the exact gap G16's own closing prose warned this phase's own class
of bug would fall into without one.

### 5. Cross-session review-panel persistence

D11 explicitly stops at `getState()/setState()`'s own durability boundary (survives hide/reveal, not
a VS Code window reload). **Recommendation: leave it there for G19.** A `context.workspaceState`-
backed version is a real, separable feature (it needs its own staleness/TTL story — a review session
resumed after, say, a week, against a branch that has since been rebased, is a materially different
problem than what D11 solves) closer in shape to G11's own `review.db` design than to a UI polish
item; folding it into this already-large phase risks under-designing it. If the shipped fix in this
phase turns out not to be enough in practice, that is its own follow-up phase's job, not a sign this
plan under-scoped item 11 — the SPEC wording ("closing the review panel... forcing a restart") is,
per F11, most directly about the ordinary hide/reveal case this phase does fix.

### 6. Item 1's indicator: checked-out vs. HEAD-points-to

D1 draws the new graph-column ring exactly where the existing row-bold/badge-dot indicators already
fire — a `branch` decoration with `isHead: true`, or a bare `head` decoration (detached HEAD).
**Recommendation: keep it exactly matched to the existing indicators**, rather than inventing a
second notion of "checked out" — `refBadges.ts`'s own doc comment (`102-108`) already worked through
the detached-HEAD edge case once (rendering a "HEAD" pill with the dot rather than leaving it
undecorated) and this reuses that same, already-settled answer rather than re-opening it. A
reviewer who wants the graph-column ring to behave differently from the row/badge indicators in some
specific case should name it; nothing in F1's own investigation surfaced a reason for the two to
disagree.
