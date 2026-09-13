# P7 — Git graph polish: row/bullet geometry, uncommitted-work click-through, file-tree icon colors

> **What this phase is.** `docs/v1.4/SPEC.md`'s P7 row, three independent hands-on-use findings
> against the shipped git graph (`packages/git-ui`), turned into concrete steps from direct research
> against the real tree plus one external fetch (VS Code's own seti icon theme JSON, quoted in full
> below rather than re-derived). No item depends on another; they are grouped into one phase because
> all three came out of the same review pass over the same surface, not because of a shared
> mechanism. **Session override, this chapter only** (same as P1/P3/P4/P5): plan and implementation
> both done by the orchestrating session directly, research delegated to an Opus agent, never a
> Sonnet implementer subagent.

## 0. Scope map

| Item | User's own wording | Section |
|---|---|---|
| 1 | "Only lines having a chip will be 2 lines the normal ones just one. And the left bullet is aligned to the commit not in the middle." | §1 |
| 2 | "Second I should be able to click and see the uncommitted work in the commit panel." | §2 |
| 3 | "The file icons in the file tree should use the same colors and icons as vscode. For example ts tests are now yellow instead of orange." | §3 |

---

## 1. Row height + bullet alignment

### 1.1 Findings, confirmed against the real files

Every row is a fixed `--kv-row-height` (`theme/density.css`: **36px**), set once as a SlickGrid
**grid-level** option (`CommitGrid.vue`'s `new SlickGrid(..., { rowHeight: rowHeightPx(tokenReader),
... })`) — SlickGrid applies it to every row uniformly; the only per-row hook,
`getItemMetadata`/`rowMetadata` (`columns.ts:290-297`), returns only `cssClasses` today, never a
height.

The 2-line shape is unconditional CSS, not computed: `.kv-cell-message { grid-template-rows: 16px
18px; }` (`CommitGrid.vue:1108-1114`) reserves both the ref/PR-badge track (row 1) and the subject
track (row 2) on **every** row, badged or not — the comment there states the intent explicitly:
"a commit with no badges (most rows) still puts its subject on row 2 — the same baseline every
other row's subject sits on." `columns.ts`'s `messageFormatter` (lines 122-136) already skips
building the `.kv-message-badges-row` **element** for an undecorated row (`buildRefBadges` returns
`null` iff `decorations.length === 0` — confirmed by reading `planBadges`: every `DecorationRef`
kind, including a bare `head` decoration, produces a visible badge via `badgeSpecFor`'s exhaustive
switch, so `decorations.length > 0` is already a complete, DOM-free proxy for "this row renders a
badge strip"), but the CSS grid track stays reserved regardless, which is why every row is the same
height today.

The bullet's y-coordinate is `rowHeight / 2` everywhere in `rowSvg.ts` — `planNode` (line 216,
every node shape: ordinary dot, merge ring, stash ring, HEAD ring, HEAD halo) and four places in
`edgeCommand` (lines 127, 136, 144, 157, every one of them the node's own y, confirmed by reading
each call site's own comment). With `.kv-cell-message`'s content (34px: 16+18) centered inside the
36px row via `.slick-cell`'s `align-items: center`, the subject track's own vertical center sits at
**y=26** (1px top margin + 16px badge track + 9px half-subject), while `rowHeight/2` = **18** — the
bullet sits 8px above the subject's actual center, roughly at the seam between the two tracks. This
is the defect: on the common case (no badges), where the badge track is empty flex space rather
than a rendered element, the bullet still floats 8px above the only text in the row.

Two facts make both requested changes cheap rather than invasive:

- **`enableVariableRowHeight` already ships in the installed SlickGrid fork (5.20.0)**, unused.
  `node_modules/slickgrid/dist/types/models/gridOption.interface.d.ts`: when on, "each row's height
  comes from the `rowHeightProvider` grid option (whose default implementation reads
  `ItemMetadata.height` from the data provider), falling back to the default `rowHeight` whenever
  the provider returns `undefined`." Heights are cached in a prefix-sum row-position index
  (`slick.grid.d.ts`'s `ensureRowPositionIndexer`/`invalidateRowHeights`/`getRowHeight`), not
  averaged — no scroll-position drift to design around.
- **`theme/density.css` already carries an unused `--kv-row-height-compact: 20px` token** (line 17,
  alongside an also-unused `--kv-row-height-comfortable: 26px` — a leftover from an earlier,
  never-finished density pass; `--kv-row-height-comfortable` is untouched by this phase, it belongs
  to whatever that future work turns out to be). No file reads either token today (`grep` across
  `packages/git-ui/src` and `apps/kira-studio-vscode/src` returns nothing but the declaration
  itself). 20px is exactly what a single 18px subject line plus the same 1px top/bottom margins the
  expanded row already uses would need — reused as-is, not re-derived.

### 1.2 Decision — variable row height, badge presence as the sole switch

`RowMetadataContext` (`columns.ts:285-288`) gains the same cheap, DOM-free badge check
`messageFormatter` already effectively makes (`decoration.length > 0`), plus PR-badge presence via
the existing `PrContext` the module already threads through `buildColumns`. `rowMetadata` returns:

- `null` — unchanged fast path — when the row has no selection/HEAD/stash class **and** no badges
  (the common case: undecorated rows fall back to the grid's own default `rowHeight`).
- Otherwise an `ItemMetadata` whose `cssClasses` is exactly as today, and whose `height` is
  `ctx.expandedRowHeight()` (the existing 36px token) **only when the row has a badge**; a
  classed-but-badgeless row (selected, HEAD, stash-with-no-decoration-shown) still omits `height`,
  falling back to the grid default.

The grid's own default `rowHeight` option flips from the expanded token to the **compact** one
(`--kv-row-height-compact`, 20px) — undecorated rows are the common case, so that is what "the
default" should mean now. `CommitGrid.vue`'s `grid.setOptions({...})` theme-change handler updates
the same way and additionally calls `grid.invalidateRowHeights()` — required per that method's own
doc comment whenever the values `rowHeightProvider` reads change without a row-count change (a
runtime density/token change, not scope this phase adds, but this phase does introduce the first
`rowHeightProvider`-relevant token, so the existing handler must not skip this call).

CSS: `.kv-cell-message`'s grid-template-rows becomes conditional, controlled by one modifier class
the formatter already has enough information to add for free (it already computes `badges`/
`prBadge` at that point):

```css
.kv-cell-message { grid-template-rows: 0 18px; }
.kv-cell-message.kv-cell-message--has-badges { grid-template-rows: 16px 18px; }
```

The subject stays `grid-row: 2` unconditionally in both — only the CSS class differs, no JS
restructuring of which element goes where.

### 1.3 Decision — the bullet anchors to the subject line, not the row's midpoint

Both regimes share one invariant: the subject track is always the last (bottom) track, always 18px,
always centered the same way inside whatever the row's own top/bottom margin is. Algebraically, the
subject's vertical center is **always** `rowHeight − compactRowHeight / 2` regardless of how tall
the row actually is: for a compact row (`rowHeight == compactRowHeight`) this reduces to
`compactRowHeight / 2` (today's already-correct single-line case); for an expanded row it evaluates
to `36 − 10 = 26`, matching the subject-track-center computed by hand in §1.1. This holds because
the extra badge track is inserted **above** the subject, never changes the subject's own height or
its distance from the row's bottom edge.

`rowSvg.ts`'s five `rowHeight / 2` node-anchor usages (`planNode`'s `cy`, and the four `edgeCommand`
branches that start or end at "the node's own y") all become a second, explicit `nodeCenterY`
parameter — computed once per row by the caller (`graphColumn.ts`'s formatter, which already knows
both the row's real height via `grid.getRowHeight(row)` and the compact token) rather than
re-derived inside `rowSvg.ts` itself, keeping that module ignorant of which CSS regime produced the
number it's given. `buildRowSvg`/`planEdgePaths`/`edgeCommand`/`planNode` all gain this second
parameter alongside their existing `rowHeight` one (still needed for the SVG's own `height`/
`viewBox` and for the row-boundary values — `-overdraw`, `rowHeight + overdraw` — that are
unaffected by this change). `rowSvg.test.ts`'s five hard-coded `rowHeight / 2` assertions are
rewritten to pass a `nodeCenterY` distinct from `rowHeight / 2` (proving the function actually
consumes the new parameter rather than silently re-deriving it).

`graphColumn.ts`'s `createGraphFormatter` signature changes from a single `rowHeight: () => number`
accessor to `(row: number) => number` (calling `grid.getRowHeight(row)` per row, the natural
per-row read now that height varies) plus a `compactRowHeight: () => number` accessor, from which it
computes `nodeCenterY = total − compactRowHeight() / 2` once per formatter call before handing both
numbers to `buildRowSvg`.

`UncommittedChangesStrip.vue`'s own SVG (`cy="9"` in a fixed 18px box) is untouched — it is already
single-line-only and its own height was never derived from `--kv-row-height`, so `9` already equals
`compactRowHeight / 2` under the same formula, coincidentally already correct. Any visual mismatch
between the strip's fixed 22px CSS height and the grid's new 20px compact row height is real but
pre-existing (the strip predates this phase and was never pixel-matched to the grid's row height in
either regime) — **out of scope**, noted rather than silently left inconsistent.

### 1.4 Implementation surface

- `packages/git-ui/src/theme/readTokens.ts` — add `--kv-row-height-compact` to `TOKEN_NAMES`, add
  `compactRowHeightPx(reader)` mirroring `rowHeightPx` (fallback 20, matching the CSS default).
- `packages/git-ui/src/components/columns.ts` — `RowMetadataContext` gains `expandedRowHeight: ()
  => number` and reuses `PrContext`; `rowMetadata` computes `hasBadges` and sets `height`
  conditionally; `messageFormatter` adds `kv-cell-message--has-badges` to the cell's `className`
  when `badges !== null || prBadge !== null`; `createCommitDataView`'s `CommitDataViewDeps` grows
  the same two accessors, threaded from `CommitGrid.vue`.
- `packages/git-ui/src/components/CommitGrid.vue` — grid construction gains
  `enableVariableRowHeight: true`; both `rowHeight:` sites (construction + theme-change handler)
  read `compactRowHeightPx`; the theme-change handler adds `grid.invalidateRowHeights()`; the
  `.kv-cell-message` CSS rule gains the modifier variant (§1.2); `createGraphFormatter`'s call site
  passes the new two-accessor signature.
- `packages/git-ui/src/graph/graphColumn.ts` — signature change described in §1.3.
- `packages/git-ui/src/graph/rowSvg.ts` — `nodeCenterY` parameter threaded through
  `buildRowSvg`/`planEdgePaths`/`edgeCommand`/`planNode`, replacing all five `rowHeight / 2` reads.
- `packages/git-ui/src/graph/rowSvg.test.ts` — five assertions updated per §1.3.

### 1.5 Testing

Unit-level: `rowSvg.test.ts`'s existing suite, extended for the new parameter; a new
`columns.test.ts`-adjacent (or extending the existing formatter tests, if any exist against
`rowMetadata`) case asserting a decorated row's metadata carries `height` and an undecorated one
returns `null`/omits it. `tests/ui/` already has graph-geometry specs (per P6's own audit of
`tests/ui/`) — extend the relevant one to assert a badge-carrying row's real `getBoundingClientRect`
height differs from a badge-less neighbor's, and that both rows' graph-column SVG node sits within
one pixel of their own message-cell subject line's vertical center (a real, rendered-pixel
assertion, not a unit computation) — this is precisely the failure class G16 already established
`tests/ui/` exists to catch (geometry assertions catching what a DOM/style assertion alone would
miss).

---

## 2. Uncommitted-work click-through to the commit panel

### 2.1 Findings

`UncommittedChangesStrip.vue` is a pinned, non-interactive strip mounted above `<CommitGrid>` in
`App.vue`'s `.kv-graph-region` — `role="status"`, no click handler, no `tabindex`. Its own doc
comment states why, twice: a GitLens-style pseudo-row **inside** the graph was rejected in v1
because "grid row index" and "store row index" are the same untyped integer in ~25 places across
`columns.ts`/`graphColumn.ts`/`layoutStore.ts`/`CommitGrid.vue`/`state/selection.ts`/`App.vue`
(including a persisted scroll-row value) — turning that into a real project just to make one strip
clickable is not this phase's job, and neither constraint is revisited here: **the strip stays a
strip**, mounted exactly where it is today. Separately, the comment already named the actual
blocker for a click action: "`editor.openAllChanges` requires a `sha`, which 'uncommitted' does not
have."

The detail panel (`DetailPane.vue`) composes `CommitMeta.vue` (author/committer/subject/trailers —
none of which a working-tree diff has) and `FileTree.vue` (which only needs a `readonly
FileChange[]`, `@kira/git-ipc`'s existing wire type). `App.vue`'s selection watch (lines ~296-310)
already branches two ways off one `SelectionState` — commit vs. stash, both real graph rows with
real shas (a stash entry, unlike "uncommitted", **is** a real row via P9's own graph walk, so it
reuses `SelectionState` unmodified; "uncommitted" has no row and cannot).

The wire gap: `status.get`'s `StatusSummary.dirtyPaths` is flat `string[]`, capped for display
(`gitpreflight.DirtyPathsDisplayCap`) — nowhere near the `FileChange[]` shape `FileTree.vue` needs
(kind, rename pairing, similarity, add/delete counts, binary flag). `gitsession.RepoEntry.Status`
already discards this by calling `SummarizeStatus` over the **full** `porcelain.StatusResult` its
own `statusAndInProgress` helper produces — that raw result (`Entries []StatusEntry`, uncapped, plus
`Branch.Unborn`) is exactly what a new method needs, and is already computed with **no caching** at
all (`Status`'s own doc comment: every call is a fresh spawn — the working tree changes too often
for a cache to be worth the invalidation-correctness risk, the same reasoning P5 gave for never
caching a blame line).

There is no existing "diff HEAD against the live working file" spawn: `commit.detail`'s own file
list comes from `NumstatArgs`/`NameStatusArgs`, both `git diff-tree` — a tree-to-tree comparison
that cannot reach the working directory at all. `WorktreeDiffArgs` (`diff.go:33-38`) is the one
place plain `git diff` (not `diff-tree`) already exists in this package, but it is single-file and
single-purpose (the drift re-map's own probe). `editor.openDiff`'s own doc comment records a real,
deliberate invariant: "`vscode.diff` is always given two virtual (or empty) URIs, never the live
working file" — stated for *commit* diffs, where both sides are immutable history; it does not
apply to a working-tree diff, which is live by definition and has no other honest way to show it.
`editor.openRangeDiff` is the existing precedent for "a diff request answered entirely inside the
extension, never touching the Go server, for a comparison that isn't one commit's parent/child
pair" — the shape this phase's new working-tree opener follows.

### 2.2 Decision — new `working.detail` request, composed from status + a new working-tree diff pair

New porcelain (`internal/gitclient/porcelain/workingdiff.go`):

```go
// EmptyTreeSHA is git's own well-known empty-tree object id — the "base" side of a working-tree
// diff when HEAD is unborn (no commit to diff against yet), since plain `git diff <rev>` refuses a
// rev that does not exist.
const EmptyTreeSHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

// WorkingNumstatArgs/WorkingNameStatusArgs are NumstatArgs/NameStatusArgs's working-tree twins:
// plain `git diff` (never diff-tree, which cannot reach a working tree at all), combining staged
// and unstaged changes against base in one spawn — base is "HEAD", or EmptyTreeSHA when HEAD is
// unborn (mirrors NumstatArgs' own from == nil → --root case, without a bool/pointer signature
// since there is always exactly one real base string to name here).
func WorkingNumstatArgs(base string) []string {
	return []string{"diff", "--numstat", "-M", "-C", "-z", base}
}
func WorkingNameStatusArgs(base string) []string {
	return []string{"diff", "--name-status", "-M", "-C", "-z", base}
}
```

`ParseNumstatRecords`/`ParseNameStatusRecords`/`CombineFileChanges` are reused unmodified — the `-z`
record framing plain `diff` and `diff-tree` both produce is identical (same underlying diff
machinery), so no new parser is needed, only new argv builders.

New query (`internal/gitsession`, alongside `Status` in `status.go` or a new `working.go` —
decided during implementation by which reads more naturally beside `statusAndInProgress`):

```go
func (e *RepoEntry) WorkingDetail(ctx context.Context) ([]porcelain.FileChange, error) {
	statusResult, _, err := e.statusAndInProgress(ctx)
	if err != nil {
		return nil, err
	}
	base := "HEAD"
	if statusResult.Branch.Unborn {
		base = porcelain.EmptyTreeSHA
	}

	var numstat []porcelain.NumstatEntry
	var nameStatus []porcelain.NameStatusEntry
	var errs [2]error
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); /* WorkingNumstatArgs(base), allRecords, ParseNumstatRecords */ }()
	go func() { defer wg.Done(); /* WorkingNameStatusArgs(base), allRecords, ParseNameStatusRecords */ }()
	wg.Wait()
	// ... error check, mirrors CommitDetail's own three-goroutine pattern at queries.go:169-226

	changes := porcelain.CombineFileChanges(numstat, nameStatus)
	for _, entry := range statusResult.Entries {
		if entry.Kind == "untracked" {
			changes = append(changes, porcelain.FileChange{Kind: porcelain.FileAdded, Path: entry.Path})
		}
	}
	return changes, nil
}
```

Untracked files never appear in a plain `git diff` at all (nothing to diff against) — the same gap
`gitsession/stash.go:259` already has its own answer for (a stash's own untracked bucket is built
identically: `porcelain.FileChange{Kind: porcelain.FileAdded, Path: p}`, no additions/deletions).
This mirrors that exact, already-shipped precedent rather than inventing a second convention;
`FileTree.vue` already renders an `undefined` additions/deletions pair as "+0 −0" via its own `??
0` fallback (`FileTree.vue:529,534`), so no template change is needed there. Whether an unmerged
path's own XY status needs special-casing rather than falling through the same plain `git diff`
(which does emit a `U` name-status code for a conflicted path, `nameStatusKind` already maps it to
`FileUnmerged`) is confirmed empirically against a real conflicted repo during implementation,
mirroring P5's own empirical-git-probe discipline rather than assumed here.

**No cache** — same reasoning as `Status()` itself and as P5's blame line: the working tree changes
on every keystroke a user's editor saves, and `entry.go`'s cache-drop signals (`SignalRefsChanged`)
do not fire on a worktree edit, so a cached answer would be actively wrong far more often than a
`CommitDetail`-style cache (keyed by immutable sha) ever is.

### 2.3 Wire contract

```ts
// packages/git-ipc/src/contract.ts, beside 'commit.detail'
'working.detail': {
  params: { repoId: string };
  result: { readonly files: readonly FileChange[] };
};
```

`CONTRACT_VERSION`/`ContractVersion` moves **34 → 35** (P5 already moved it 33 → 34 earlier this
chapter) — one new Go-served request, additive only, same bump discipline as P5 §4:
`gitrpc/contract.go`'s doc-comment history gains one more entry, `packages/git-ipc/src/validate.ts`
mirrors it, `REQUEST_KEY_MAP` gains `'working.detail': true`, `apps/kira-studio-vscode/src/
proxyHandlers.ts` gains a plain `'working.detail': forward('working.detail')` (no webview caller
needs a thrown-stub shape here — this request is legitimately callable from the webview, exactly
like `commit.detail`). Go side: `gitrpc/wire.go`'s `WorkingDetailParams{RepoID string}`,
`gitrpc/detail.go`'s `handleWorkingDetail` (unmarshal, validate `RepoID` non-empty, `entryFor`,
`entry.WorkingDetail`, wrap as `{Files: files}`), `gitrpc/handlers.go`'s new `case "working.detail"`.

**Second, extension-only method** for the actual diff-open action, following `editor.openRangeDiff`'s
own precedent (answered entirely inside the extension, the Go server never sees it, so it needs no
`CONTRACT_VERSION` bump of its own beyond whatever request-key list change TypeScript's own
exhaustiveness check requires):

```ts
'editor.openWorkingDiff': {
  params: {
    repoId: string;
    path: string;
    originalPath?: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'unmerged';
    pinned?: boolean;
  };
  result: Record<string, never>;
};
```

Handled in `apps/kira-studio-vscode/src/ports/editorIntegration.ts` beside `openRangeDiff`: the left
side is the same virtual `HEAD:path` content provider `editor.openDiff` already uses (empty for
`status === 'added'`, reusing whatever empty-blob handling that path already has), the right side is
`vscode.Uri.file(<absolute path>)` — **the live on-disk file**, a deliberate, first-ever exception to
`editorIntegration.ts`'s own "never a live URI" note, which was written for *commit* diffs (both
sides immutable history) and does not apply here: a working-tree diff is live by definition, and
comparing against anything else would be dishonest. For `status === 'deleted'` (no live file exists
to open on the right), falls back to `vscode.commands.executeCommand('workbench.view.scm')` —
VS Code's own native Source Control view already handles a deleted-but-uncommitted file correctly
and completely; building a bespoke deleted-file diff view for this one edge case is not this
phase's job.

### 2.4 Selection and pane wiring

A working-tree selection is independent of `SelectionState` (no row, no sha) — mirrors
`StashState`'s own already-established pattern of a second, parallel selection class rather than
overloading `SelectionState` with a state it cannot represent. New, minimal class:

```ts
// packages/git-ui/src/state/working.ts
export class WorkingDetailState {
  readonly selected: ShallowRef<boolean> = shallowRef(false);
  readonly files: ShallowRef<readonly FileChange[]> = shallowRef([]);
  select(selected: boolean): void { ... } // selected=true triggers the working.detail request
  setRepoId(repoId: string | undefined): void { ... }
}
```

`App.vue` wiring, additive alongside the existing commit/stash branch:

- The existing `watch(() => selection.sha.value, ...)` gains `workingState.select(false)` in both
  branches — selecting any real commit or stash row always clears a working-tree selection, mirroring
  how selecting a commit already clears `stashState`.
- `UncommittedChangesStrip.vue` gains `role="button"`, `tabindex="0"`, `cursor: pointer`, and a
  click/`Enter`/`Space` handler emitting `select` — `App.vue`'s listener calls
  `workingState.select(true)`, `detailOpen.value = true` (mirroring the existing stash-select
  open-on-narrow-breakpoints behavior at line 1159), and `selection.clear()` (deselects any
  highlighted grid row, which in turn fires the watch above and clears `detailState`/`stashState`
  via their own existing `null`-selection path — no new clearing logic needed there).
- The pane-choosing template logic (currently `selectionIsStash ? StashDetailPane : DetailPane`)
  gains a third, higher-priority branch: `workingState.selected.value ? WorkingDetailPane :
  selectionIsStash ? StashDetailPane : DetailPane`.

New `packages/git-ui/src/components/WorkingDetailPane.vue`: a header ("Uncommitted Changes", with a
count subtitle read from the already-reactive `OpsState.statusSummary` — no second count source)
above a `<FileTree :files="workingState.files.value" ...>`, wired to call `editor.openWorkingDiff` (§2.3)
on a file click rather than `DetailPane.vue`'s `editor.openDiff`. Deliberately **not** a mode of
`DetailPane.vue` itself: that component's other half, `CommitMeta.vue`, has no working-tree
equivalent (no author, no sha, no trailers), so bolting an `undefined`-heavy commit shape onto it
would cost more than a small, dedicated pane.

### 2.5 Explicit non-goals

- The GitLens-style pseudo-row inside the graph — still rejected, for the same ~25-site
  row-index-remapping reason SPEC/§2.1 both restate.
- A bespoke diff view for a deleted-but-uncommitted file — falls back to VS Code's native SCM view
  (§2.3).
- Per-file staging/unstaging/discard actions from the new pane — this phase adds *visibility and
  click-through*, not a working-tree mutation surface; `App.vue`'s existing global "Discard all"/
  stash affordances are untouched.

### 2.6 Testing

Go: `internal/gitclient/porcelain/workingdiff_test.go` (golden-byte fixtures, same discipline as
`blame_test.go` — a working-tree diff parser is squarely "several interacting rules" once untracked/
renamed/unmerged/binary all interact); `internal/gitsession/queries_test.go` gains
`TestWorkingDetail_*` cases (clean tree, staged+unstaged+untracked mix, unborn HEAD, a rename).
TypeScript: `rpc.test.ts`'s `stubHandlers` gains both new request keys;
`WorkingDetailState`/`working.ts` gets its own unit test (mirrors `stashListModel.test.ts`'s
level — pure state transitions, no DOM). `tests/ui/`: a new spec opens a fixture repo with a dirty
working tree, clicks the strip, asserts `WorkingDetailPane`'s file list matches the dirty set (real
DOM assertion, both wire planes mocked, same tier P6's own audit already describes).

---

## 3. File-tree icon colors — match VS Code's own seti theme exactly

### 3.1 Findings — root cause fully located, ground truth fetched

`FileTree.vue`'s `setiIconFor` (`icons/setiFileIcon.ts`) wraps the `seti-icons@0.0.4` npm package
(`packages/git-ui/package.json`), whose bundled `definitions.json` is a **stale upstream snapshot**.
Executing both resolvers side by side against VS Code's own real seti icon theme
(`https://raw.githubusercontent.com/microsoft/vscode/main/extensions/theme-seti/icons/
vs-seti-icon-theme.json`, fetched in full during research) confirms:

| File | This repo renders today | VS Code's own theme | Verdict |
|---|---|---|---|
| `foo.ts` | `#519aba` (blue) | `#519aba` | correct |
| `foo.js` | `#cbcb41` (yellow) | `#cbcb41` | correct |
| `foo.tsx`/`.jsx` | `#519aba` (blue) | `#519aba` | correct |
| **`foo.test.ts` / `.spec.ts`** | **`#cbcb41` (yellow)** | **`#e37933` (orange)** | **wrong** |
| **`foo.test.tsx` / `.spec.tsx`** | **`#cbcb41` (yellow)** | **`#e37933` (orange)** | **wrong** |
| `foo.test.js` / `.spec.js` | `#e37933` (orange) | `#e37933` | correct |

VS Code's own `iconDefinitions` confirm the fix is a **pure color override, never a glyph swap** —
`_typescript`/`_typescript_1` (plain vs. test) share the identical `fontCharacter: "\E099"`, only
`fontColor` differs (`#519aba` vs `#e37933`); same for `_javascript`/`_javascript_1` and
`_react`/`_react_1`. Every other color this repo's own palette uses
(`packages/git-ui/src/icons/setiFileIcon.ts`'s `blue`/`green`/`orange`/`pink`/`purple`/`red`/
`yellow`/`grey`/`grey-light`) already matches VS Code's dark-theme values exactly — this is a
narrow, four-extension fix, not a palette rewrite. VS Code additionally maps four extensions this
repo's package has no entry for at all: `.spec.cjs`/`.test.cjs`/`.spec.mjs`/`.test.mjs` (all →
orange, same `_javascript_1`).

`setiFileIcon.ts`'s existing `GO_TOOLING_FILENAMES` override (lines 75-78) is direct, already-shipped
precedent in this exact file for "patch around a gap in the vendored package's own table" — this
phase adds a sibling override, not a new mechanism.

### 3.2 Decision — an extension-keyed color override, applied after the vendored lookup

```ts
// setiFileIcon.ts, alongside GO_TOOLING_FILENAMES
// VS Code's own vs-seti-icon-theme.json (iconDefinitions/_typescript_1, _react_1, _javascript_1):
// a test/spec file keeps its language's ordinary glyph, colored orange instead of that language's
// ordinary color — seti-icons@0.0.4's own bundled definitions.json is stale here for the
// TypeScript/TSX pair (confirmed wrong: yellow) though it already has the JS pair right (already
// orange) — this override brings all of them, plus the two extensions the package has no entry for
// at all (.cjs/.mjs test/spec), in line with VS Code's own real table.
const TEST_FILE_COLOR_OVERRIDES: ReadonlyMap<string, string> = new Map([
  ['test.ts', PALETTE.orange], ['spec.ts', PALETTE.orange],
  ['test.tsx', PALETTE.orange], ['spec.tsx', PALETTE.orange],
  ['test.cjs', PALETTE.orange], ['spec.cjs', PALETTE.orange],
  ['test.mjs', PALETTE.orange], ['spec.mjs', PALETTE.orange],
]);
```

applied by matching the same longest-suffix-first walk `seti-icons`' own resolver already does
(basename split from the first `.`, tried outward) — a file whose lowercased basename ends with one
of the map's keys gets that color instead of whatever the vendored `themed()` call returned, glyph
untouched. `.test.js`/`.spec.js`/`.test.jsx`/`.spec.jsx` are **not** in the override map — they are
already correct today (confirmed in §3.1's table) and adding them would be a no-op that only risks
drifting from the package's own value later.

`ignore` color (`setiFileIcon.ts:30`, currently a guessed `#6d8086`) — VS Code's own real value for
its ignored/git/npm-ignored icon set is `#41535b`. Corrected in the same palette object, called out
separately in the commit message from the four-extension fix since it is a different, independently
verifiable correction against the same fetched ground truth.

Light-theme parity (VS Code's `_light` icon variants, e.g. `#cc6d2e` for a light-theme test file) is
an explicit **non-goal**: this repo's file tree renders icons as a single flat `background-color`
via a CSS mask and has never had a light/dark icon-color split (`setiFileIcon.ts`'s own `white:
'var(--kv-description-fg)'` is the one place it defers to the host theme, and that stays as the only
one) — adding a second palette gated on the host's theme signal is real, separable work this finding
does not require to fix the reported color bug.

### 3.3 Implementation surface

- `packages/git-ui/src/icons/setiFileIcon.ts` — `TEST_FILE_COLOR_OVERRIDES` map + the suffix-walk
  application (§3.2), `ignore` palette value corrected to `#41535b`.
- `packages/git-ui/src/icons/setiFileIcon.test.ts` (existing file, per the research report) — cases
  added for all four now-fixed extensions, the two new `.cjs`/`.mjs` extensions, and the corrected
  `ignore` color; existing cases for `.test.js`/`.spec.js`/plain `.ts`/`.js` kept as regression
  guards that the fix does not touch what was already correct.

### 3.4 Testing

Unit only — `setiFileIcon.ts` is already a pure function with its own test file, exactly the shape
this fix needs no new test infrastructure for.

---

## 4. Cross-cutting notes

- **No shared files between the three items** beyond the fact that items 1 and 2 both touch
  `App.vue`/`CommitGrid.vue`'s general vicinity — confirmed no line-level overlap: item 1 touches
  `.kv-cell-message`'s CSS and the graph column's formatter wiring; item 2 touches the pane-selection
  watch and template branch. Implemented and committed as one phase (matching SPEC's own framing:
  one review pass, three findings) but each item's own diff is independently revertable.
- **`CONTRACT_VERSION`/`ContractVersion`: 34 → 35**, for `working.detail` alone (§2.3).
  `editor.openWorkingDiff` needs no bump of its own (extension-only, mirrors `editor.openRangeDiff`).
  Item 1 and item 3 touch no wire contract at all.
- **No SQL migration, no new `UiActionKind` member, no new capability** — consistent with every
  other v1.4 phase's own bookkeeping note.

## 5. Verification plan

`bun run typecheck`, `bunx biome check .`, `go build ./...`, the full relevant Go/TS unit suites
(`internal/gitclient/porcelain`, `internal/gitsession`, `internal/gitrpc`, `packages/git-ui`,
`packages/git-ipc`), and a manual pass in the running app: scroll the graph and visually confirm
undecorated rows are single-line and decorated rows are two-line with the bullet sitting on the
subject line in both (item 1); make a mix of staged/unstaged/untracked edits, click the strip, and
confirm the panel shows the right file list with working diffs opening correctly, including the
unborn-HEAD case in a fresh repo (item 2); open the file tree over a `.test.ts`/`.spec.tsx` pair and
confirm orange, side by side with real VS Code if available (item 3).
